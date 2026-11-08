/**
 * ForgeERP — routing, work centres, shift calendars and finite capacity.
 *
 * The manufacturing module already had a *sequence* (tasks with `seq`, a
 * predecessor guard) but no idea which machine an operation needs or when the
 * machine is free. This module adds the missing master data and one honest
 * scheduler:
 *
 *  - **Work centres** are machines/cells with a parallel capacity, a daily
 *    fallback availability and a cost per hour.
 *  - **Shift calendars** say when a centre is staffed (shifts + holidays);
 *    `capacityWindow` turns that into real working minutes.
 *  - **Routing** hangs ordered operations off a BOM *revision*. Approving a
 *    revision therefore freezes how the part is made, and work orders snapshot
 *    the routing into tasks (`plannedMinutes`, `workCenterId`).
 *  - **Finite scheduling** places those tasks on their centre's calendar, one
 *    after another (respecting capacity and route precedence), and reports the
 *    delay against the work order's committed end date. It reports; it does not
 *    rewrite the plan behind the planner's back.
 *  - **Downtime** rows (breakdown, changeover, power …) feed the availability
 *    and performance halves of OEE in `src/lib/oee.ts`.
 *
 * Everything here is additive master data: nothing posts to the stock or
 * general ledger, and no existing task changes its quantity or cost.
 */
import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError } from './accounting'
import { r2, fyCode } from './erp'
import { OPERATIONS } from './manufacturing'
import { tenantCompany } from './tenant'

type Tx = Prisma.TransactionClient

const MINUTE = 60_000
const DAY_MIN = 1440
/** How far ahead the finite scheduler looks before calling a job late. */
export const SCHEDULE_HORIZON_DAYS = 120
export const DOWNTIME_REASONS = [
  'BREAKDOWN',
  'CHANGEOVER',
  'NO_MATERIAL',
  'NO_OPERATOR',
  'POWER',
  'MAINTENANCE',
  'QUALITY',
  'OTHER',
] as const
export type DowntimeReason = (typeof DOWNTIME_REASONS)[number]
/** Reasons that legitimately count as planned (excluded from availability loss). */
const PLANNED_REASONS = new Set(['MAINTENANCE'])

const dayStart = (d: Date | string): Date => {
  const dt = typeof d === 'string' ? new Date(d) : new Date(d.getTime())
  if (Number.isNaN(dt.getTime())) throw new BusinessError('Invalid date — use YYYY-MM-DD', 400)
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
}
const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000)
export const dayKey = (d: Date): string => d.toISOString().slice(0, 10)

// ===========================================================================
// Work centres
// ===========================================================================

export interface WorkCenterInput {
  code: string
  name: string
  type?: 'MACHINE' | 'CELL' | 'MANUAL'
  machineNo?: string | null
  parallelCapacity?: number
  dailyHours?: number
  costPerHour?: number
  active?: boolean
  notes?: string | null
}

export async function listWorkCenters(includeInactive = true) {
  const centers = await db.workCenter.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ code: 'asc' }],
    include: {
      calendar: { include: { shifts: { orderBy: { startMin: 'asc' } }, holidays: { orderBy: { date: 'asc' } } } },
      _count: { select: { operations: true, tasks: true, downtimes: true } },
    },
  })
  const open = await db.machineDowntime.groupBy({
    by: ['workCenterId'],
    where: { endedAt: null },
    _count: true,
  })
  const downNow = new Set(open.map((row) => row.workCenterId))
  return centers.map((c) => ({
    ...c,
    downNow: downNow.has(c.id),
    plannedMinutesPerDay: capacityMinutesFor(c, 1),
  }))
}

export async function createWorkCenter(input: WorkCenterInput) {
  const code = input.code?.trim()
  if (!code) throw new BusinessError('Work centre code is required')
  if (!input.name?.trim()) throw new BusinessError('Work centre name is required')
  const parallel = input.parallelCapacity ?? 1
  if (parallel < 1 || parallel > 50) throw new BusinessError('Parallel capacity must be between 1 and 50')
  const hours = input.dailyHours ?? 8
  if (hours < 0 || hours > 24) throw new BusinessError('Daily hours must be between 0 and 24')
  if ((input.costPerHour ?? 0) < 0) throw new BusinessError('Cost per hour cannot be negative')
  return db.workCenter.create({
    data: {
      code,
      name: input.name.trim(),
      type: input.type ?? 'MACHINE',
      machineNo: input.machineNo?.trim() || null,
      parallelCapacity: parallel,
      dailyHours: hours,
      costPerHour: input.costPerHour ?? 0,
      active: input.active ?? true,
      notes: input.notes ?? null,
    },
  })
}

export async function updateWorkCenter(id: string, input: Partial<WorkCenterInput>) {
  const center = await db.workCenter.findUnique({ where: { id } })
  if (!center) throw new BusinessError('Work centre not found', 404)
  if (input.parallelCapacity !== undefined && (input.parallelCapacity < 1 || input.parallelCapacity > 50)) {
    throw new BusinessError('Parallel capacity must be between 1 and 50')
  }
  if (input.dailyHours !== undefined && (input.dailyHours < 0 || input.dailyHours > 24)) {
    throw new BusinessError('Daily hours must be between 0 and 24')
  }
  return db.workCenter.update({
    where: { id },
    data: {
      code: input.code?.trim() || undefined,
      name: input.name?.trim() || undefined,
      type: input.type,
      machineNo: input.machineNo === undefined ? undefined : input.machineNo?.trim() || null,
      parallelCapacity: input.parallelCapacity,
      dailyHours: input.dailyHours,
      costPerHour: input.costPerHour,
      active: input.active,
      notes: input.notes === undefined ? undefined : input.notes,
    },
  })
}

/** Retire a centre. Refuses while operations or live tasks still need it. */
export async function deleteWorkCenter(id: string) {
  return db.$transaction(async (tx) => {
    const center = await tx.workCenter.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!center) throw new BusinessError('Work centre not found', 404)
    const liveTasks = await tx.productionTask.count({
      where: { workCenterId: id, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] } },
    })
    if (liveTasks > 0) throw new BusinessError(`${liveTasks} open task(s) still run on ${center.name} — finish or reassign them first`, 409)
    const routing = await tx.routingOperation.count({ where: { workCenterId: id } })
    if (routing > 0) throw new BusinessError(`${routing} routing operation(s) reference ${center.name} — retire the centre instead`, 409)
    await tx.workCenter.delete({ where: { id } })
    return { deleted: true }
  })
}

// ===========================================================================
// Shift calendar
// ===========================================================================

export interface ShiftInput {
  name?: string
  startMin: number
  durationMin: number
  active?: boolean
}

/**
 * Working minutes a centre offers on one day, from its calendar. No calendar
 * means the fallback (`dailyHours` × parallel capacity). A holiday yields 0 and
 * a working week outside `workDays` yields 0 — both are real capacity losses and
 * must not silently fall back to the daily default.
 */
export function capacityMinutesFor(
  center: { dailyHours: number; parallelCapacity: number; calendar?: { workDays: string; shifts: { startMin: number; durationMin: number; active: boolean }[]; holidays: { date: Date }[] } | null },
  days = 1
): number {
  const cal = center.calendar
  if (!cal) return r2(center.dailyHours * 60 * center.parallelCapacity * days)
  const shifts = cal.shifts.filter((s) => s.active && s.durationMin > 0)
  const perDay = shifts.reduce((sum, s) => sum + s.durationMin, 0)
  return r2(perDay * center.parallelCapacity * days)
}

/** Capacity minutes for one centre on one specific date (holiday/weekday aware). */
export function capacityMinutesOn(
  center: { dailyHours: number; parallelCapacity: number; calendar?: { workDays: string; shifts: { startMin: number; durationMin: number; active: boolean }[]; holidays: { date: Date }[] } | null },
  date: Date
): number {
  const cal = center.calendar
  if (!cal) return r2(center.dailyHours * 60 * center.parallelCapacity)
  const day = dayKey(date)
  if (cal.holidays.some((h) => dayKey(h.date) === day)) return 0
  const weekdays = cal.workDays
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  if (weekdays.length && !weekdays.includes(date.getUTCDay())) return 0
  const perDay = cal.shifts.filter((s) => s.active && s.durationMin > 0).reduce((sum, s) => sum + s.durationMin, 0)
  return r2(perDay * center.parallelCapacity)
}

export async function getCalendar(workCenterId: string) {
  const center = await db.workCenter.findUnique({
    where: { id: workCenterId },
    include: { calendar: { include: { shifts: { orderBy: { startMin: 'asc' } }, holidays: { orderBy: { date: 'asc' } } } } },
  })
  if (!center) throw new BusinessError('Work centre not found', 404)
  return {
    workCenter: { id: center.id, code: center.code, name: center.name, dailyHours: center.dailyHours, parallelCapacity: center.parallelCapacity },
    workDays: center.calendar?.workDays ?? '1,2,3,4,5,6',
    shifts: center.calendar?.shifts ?? [],
    holidays: center.calendar?.holidays ?? [],
    hasCalendar: !!center.calendar,
  }
}

/**
 * Replace a centre's calendar in one transaction: work week, shifts and
 * holidays together, so capacity can never be read half-updated.
 */
export async function saveCalendar(
  workCenterId: string,
  input: { workDays?: string; shifts: ShiftInput[]; holidays?: { date: string | Date; reason?: string | null }[] }
) {
  return db.$transaction(async (tx) => {
    const center = await tx.workCenter.findUnique({ where: { id: workCenterId }, select: { id: true, name: true } })
    if (!center) throw new BusinessError('Work centre not found', 404)

    const shifts = input.shifts ?? []
    if (shifts.length > 7) throw new BusinessError('A day cannot have more than 7 shifts')
    const seen = new Set<number>()
    for (const s of shifts) {
      if (!Number.isInteger(s.startMin) || s.startMin < 0 || s.startMin >= DAY_MIN) {
        throw new BusinessError('Shift start must be a minute of the day (0–1439)')
      }
      if (!Number.isInteger(s.durationMin) || s.durationMin <= 0 || s.durationMin > 24 * 60) {
        throw new BusinessError('Shift duration must be between 1 and 1440 minutes')
      }
      for (let m = s.startMin; m < s.startMin + s.durationMin; m += 60) {
        const slot = m % DAY_MIN
        if (seen.has(slot)) throw new BusinessError('Shifts overlap — a minute of the day can belong to only one shift')
        seen.add(slot)
      }
    }
    const workDays = input.workDays ?? '1,2,3,4,5,6'
    const parsedDays = workDays.split(',').map((d) => Number(d.trim()))
    if (!parsedDays.length || parsedDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new BusinessError('Working week must be a CSV of weekday numbers 0–6 (0 = Sunday)')
    }
    const holidays = input.holidays ?? []
    for (const h of holidays) dayStart(h.date) // validates

    const calendar = await tx.shiftCalendar.upsert({
      where: { companyId_workCenterId: { companyId: (await tenantId(tx)), workCenterId } },
      create: { companyId: await tenantId(tx), workCenterId, workDays: [...new Set(parsedDays)].join(',') },
      update: { workDays: [...new Set(parsedDays)].join(',') },
    })
    await tx.shift.deleteMany({ where: { calendarId: calendar.id } })
    await tx.shiftHoliday.deleteMany({ where: { calendarId: calendar.id } })
    if (shifts.length) {
      await tx.shift.createMany({
        data: shifts.map((s) => ({
          calendarId: calendar.id,
          name: s.name?.trim() || 'SHIFT',
          startMin: s.startMin,
          durationMin: s.durationMin,
          active: s.active ?? true,
        })),
      })
    }
    if (holidays.length) {
      await tx.shiftHoliday.createMany({
        data: holidays.map((h) => ({ calendarId: calendar.id, date: dayStart(h.date), reason: h.reason?.trim() || null })),
        skipDuplicates: true,
      })
    }
    return tx.shiftCalendar.findUnique({
      where: { id: calendar.id },
      include: { shifts: { orderBy: { startMin: 'asc' } }, holidays: { orderBy: { date: 'asc' } } },
    })
  })
}

/** The tenant id for a nested write (the extension fills it on create only). */
async function tenantId(tx: Tx): Promise<string> {
  const company = await tenantCompany(tx)
  if (!company) throw new BusinessError('Company profile is not set up yet', 409)
  return company.id
}

// ===========================================================================
// Routing (per BOM revision)
// ===========================================================================

export interface RoutingOperationInput {
  seq: number
  operation: string
  workCenterId: string
  runMinutesPerUnit?: number
  setupMinutes?: number
  queueMinutes?: number
  moveMinutes?: number
  inspectionMinutes?: number
  parallel?: boolean
  notes?: string | null
}

export async function listRouting(bomId: string) {
  const bom = await db.bom.findUnique({
    where: { id: bomId },
    select: { id: true, bomNo: true, revision: true, status: true, itemId: true, productName: true },
  })
  if (!bom) throw new BusinessError('BOM not found', 404)
  const operations = await db.routingOperation.findMany({
    where: { bomId },
    orderBy: [{ seq: 'asc' }],
    include: { workCenter: { select: { id: true, code: true, name: true, type: true, costPerHour: true } } },
  })
  return { bom, operations }
}

/**
 * Replace a BOM revision's routing. Only a DRAFT revision may change its route:
 * once approved, the process is frozen exactly like the material lines, and a
 * change is a new revision (`reviseBom`).
 */
export async function saveRouting(bomId: string, operations: RoutingOperationInput[]) {
  return db.$transaction(async (tx) => {
    const bom = await tx.bom.findUnique({ where: { id: bomId }, select: { id: true, bomNo: true, status: true } })
    if (!bom) throw new BusinessError('BOM not found', 404)
    if (bom.status !== 'DRAFT') {
      throw new BusinessError(`${bom.bomNo} is ${bom.status} — the route of an approved revision is frozen; create a revision to change it`, 409)
    }
    if (!operations.length) throw new BusinessError('A routing needs at least one operation')
    if (operations.length > 50) throw new BusinessError('A routing cannot have more than 50 operations')
    const seqs = new Set<number>()
    const centerIds = [...new Set(operations.map((o) => o.workCenterId))]
    const centers = await tx.workCenter.findMany({ where: { id: { in: centerIds } }, select: { id: true, active: true, name: true } })
    const centerMap = new Map(centers.map((c) => [c.id, c]))
    for (const op of operations) {
      if (!Number.isInteger(op.seq) || op.seq < 1) throw new BusinessError('Operation sequence must be a whole number from 1')
      if (seqs.has(op.seq)) throw new BusinessError(`Sequence ${op.seq} is used twice — each step needs its own number`)
      seqs.add(op.seq)
      const options = OPERATIONS as readonly { key: string }[]
      if (!options.some((o) => o.key === op.operation)) throw new BusinessError(`Unknown operation "${op.operation}"`)
      const center = centerMap.get(op.workCenterId)
      if (!center) throw new BusinessError('Work centre not found', 404)
      if (!center.active) throw new BusinessError(`Work centre "${center.name}" is inactive`)
      for (const [label, value] of [
        ['run minutes per unit', op.runMinutesPerUnit ?? 0],
        ['setup minutes', op.setupMinutes ?? 0],
        ['queue minutes', op.queueMinutes ?? 0],
        ['move minutes', op.moveMinutes ?? 0],
        ['inspection minutes', op.inspectionMinutes ?? 0],
      ] as const) {
        if (value < 0 || !Number.isFinite(value)) throw new BusinessError(`${label} cannot be negative`)
        if (value > 100_000) throw new BusinessError(`${label} looks wrong (limit 100,000)`)
      }
    }
    const companyId = await tenantId(tx)
    await tx.routingOperation.deleteMany({ where: { bomId } })
    await tx.routingOperation.createMany({
      data: operations
        .sort((a, b) => a.seq - b.seq)
        .map((op) => ({
          companyId,
          bomId,
          seq: op.seq,
          operation: op.operation,
          workCenterId: op.workCenterId,
          runMinutesPerUnit: op.runMinutesPerUnit ?? 0,
          setupMinutes: op.setupMinutes ?? 0,
          queueMinutes: op.queueMinutes ?? 0,
          moveMinutes: op.moveMinutes ?? 0,
          inspectionMinutes: op.inspectionMinutes ?? 0,
          parallel: op.parallel ?? false,
          notes: op.notes ?? null,
        })),
    })
    return tx.routingOperation.findMany({ where: { bomId }, orderBy: { seq: 'asc' } })
  })
}

/** Planned minutes for one routing operation at a given batch size. */
export function operationMinutes(
  op: { runMinutesPerUnit: number; setupMinutes: number; queueMinutes: number; moveMinutes: number; inspectionMinutes: number },
  batchQty: number
): number {
  const run = Math.max(0, batchQty) * op.runMinutesPerUnit
  return r2(setup(op) + run + op.inspectionMinutes)
  function setup(o: typeof op) {
    // Setup and queue/move are per batch, not per unit; queue+move are waiting
    // time for capacity purposes but real elapsed time for the schedule.
    return o.setupMinutes + o.queueMinutes + o.moveMinutes
  }
}

// ===========================================================================
// Downtime capture
// ===========================================================================

export interface DowntimeInput {
  workCenterId: string
  startedAt: string | Date
  endedAt?: string | Date | null
  reason: DowntimeReason
  planned?: boolean
  notes?: string | null
}

export async function listDowntime(filters?: { workCenterId?: string; from?: string; to?: string; openOnly?: boolean }) {
  const where: Prisma.MachineDowntimeWhereInput = {}
  if (filters?.workCenterId) where.workCenterId = filters.workCenterId
  if (filters?.openOnly) where.endedAt = null
  if (filters?.from || filters?.to) {
    where.startedAt = {
      ...(filters?.from ? { gte: dayStart(filters.from) } : {}),
      ...(filters?.to ? { lte: addDays(dayStart(filters.to), 1) } : {}),
    }
  }
  const rows = await db.machineDowntime.findMany({
    where,
    orderBy: [{ startedAt: 'desc' }],
    take: 500,
    include: { workCenter: { select: { id: true, code: true, name: true } } },
  })
  const now = Date.now()
  return rows.map((r) => ({
    ...r,
    minutes: r2(((r.endedAt?.getTime() ?? now) - r.startedAt.getTime()) / MINUTE),
    open: !r.endedAt,
  }))
}

/**
 * Record a stoppage. `endedAt` may be omitted for "still down"; closing it later
 * (`closeDowntime`) is the normal shop-floor flow.
 */
export async function recordDowntime(input: DowntimeInput, actor?: string) {
  return db.$transaction(async (tx) => {
    const center = await tx.workCenter.findUnique({ where: { id: input.workCenterId }, select: { id: true, active: true, name: true } })
    if (!center) throw new BusinessError('Work centre not found', 404)
    if (!DOWNTIME_REASONS.includes(input.reason)) throw new BusinessError(`Unknown downtime reason "${input.reason}"`)
    const startedAt = new Date(input.startedAt)
    if (Number.isNaN(startedAt.getTime())) throw new BusinessError('Invalid downtime start')
    if (startedAt.getTime() > Date.now() + 5 * MINUTE) throw new BusinessError('Downtime cannot start in the future')
    const endedAt = input.endedAt ? new Date(input.endedAt) : null
    if (endedAt) {
      if (Number.isNaN(endedAt.getTime())) throw new BusinessError('Invalid downtime end')
      if (endedAt.getTime() <= startedAt.getTime()) throw new BusinessError('Downtime end must be after its start')
      if (endedAt.getTime() > Date.now() + 5 * MINUTE) throw new BusinessError('Downtime cannot end in the future')
    }
    const overlapping = await tx.machineDowntime.findFirst({
      where: {
        workCenterId: center.id,
        OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }],
        startedAt: { lt: endedAt ?? new Date(Date.now() + 365 * 86_400_000) },
      },
      select: { id: true, reason: true, startedAt: true },
    })
    if (overlapping) {
      throw new BusinessError(
        `${center.name} already has downtime from ${overlapping.startedAt.toISOString().slice(0, 16).replace('T', ' ')} (${overlapping.reason}) — close it first`,
        409
      )
    }
    return tx.machineDowntime.create({
      data: {
        companyId: await tenantId(tx),
        workCenterId: center.id,
        startedAt,
        endedAt,
        reason: input.reason,
        planned: input.planned ?? PLANNED_REASONS.has(input.reason),
        notes: input.notes?.trim() || null,
        createdBy: actor,
      },
    })
  })
}

export async function closeDowntime(id: string, endedAt?: string | Date) {
  return db.$transaction(async (tx) => {
    const row = await tx.machineDowntime.findUnique({ where: { id } })
    if (!row) throw new BusinessError('Downtime record not found', 404)
    if (row.endedAt) throw new BusinessError('This downtime is already closed', 409)
    const end = endedAt ? new Date(endedAt) : new Date()
    if (Number.isNaN(end.getTime())) throw new BusinessError('Invalid downtime end')
    if (end.getTime() < row.startedAt.getTime()) throw new BusinessError('Downtime end must be after its start')
    return tx.machineDowntime.update({ where: { id }, data: { endedAt: end } })
  })
}

// ===========================================================================
// Finite-capacity scheduling
// ===========================================================================

export interface ScheduledTask {
  taskId: string
  taskNo: string
  woId: string
  woNo: string
  projectNo: string
  operation: string
  seq: number
  workCenterId: string
  workCenter: string
  minutes: number
  start: Date
  end: Date
}

type CenterWithCalendar = {
  id: string
  code: string
  name: string
  dailyHours: number
  parallelCapacity: number
  active: boolean
  calendar: { workDays: string; shifts: { startMin: number; durationMin: number; active: boolean }[]; holidays: { date: Date }[] } | null
}

/**
 * Place work on its centre's calendar.
 *
 * Rules (deliberately conservative and explainable):
 *  - a lane is one parallel slot on a centre; a task occupies exactly one lane
 *    for its whole planned duration (no pre-emption);
 *  - within a work order, sequence order is respected (a later sequence cannot
 *    start before an earlier one finishes, except `parallel` sequences);
 *  - a task never starts before the work order's start date, and never before
 *    `from`;
 *  - only working minutes count: shift windows and holidays from the centre's
 *    calendar, else `dailyHours` per weekday.
 *
 * Returns the placements plus per-work-order lateness against the committed end
 * date, so the planner sees which promise breaks — the plan itself is not
 * mutated (that is a scheduling decision, not a read).
 */
export async function finiteSchedule(fromInput?: string | Date, horizonDays = SCHEDULE_HORIZON_DAYS) {
  const from = fromInput ? dayStart(fromInput) : dayStart(new Date())
  const centers = (await db.workCenter.findMany({
    where: { active: true },
    include: { calendar: { include: { shifts: { orderBy: { startMin: 'asc' } }, holidays: true } } },
  })) as unknown as CenterWithCalendar[]
  const centerMap = new Map(centers.map((c) => [c.id, c]))

  const tasks = await db.productionTask.findMany({
    where: {
      status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] },
      workCenterId: { not: null },
      workOrder: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
    },
    include: {
      workOrder: { select: { id: true, woNo: true, startDate: true, endDate: true, date: true, project: { select: { projectNo: true } } } },
    },
  })

  // Queue: earliest committed finish first (EDD), then priority-agnostic but
  // stable by work order and sequence so a route is placed consistently.
  const rows = tasks
    .map((t) => ({
      id: t.id,
      taskNo: t.taskNo,
      woId: t.workOrderId,
      woNo: t.workOrder.woNo,
      projectNo: t.workOrder.project.projectNo,
      notBefore: new Date(Math.max(
        from.getTime(),
        (t.workOrder.startDate ?? t.workOrder.date).getTime()
      )),
      due: t.workOrder.endDate ?? null,
      seq: t.seq,
      operation: t.operation,
      workCenterId: t.workCenterId!,
      minutes: Math.max(1, r2(t.plannedMinutes > 0 ? t.plannedMinutes : fallbackMinutes(t))),
    }))
    .sort((a, b) => {
      const ad = a.due?.getTime() ?? Number.MAX_SAFE_INTEGER
      const bd = b.due?.getTime() ?? Number.MAX_SAFE_INTEGER
      return ad - bd || a.woNo.localeCompare(b.woNo) || a.seq - b.seq
    })

  const horizonEnd = addDays(from, horizonDays)
  // Lane free-time per centre; route-precedence per work order.
  const lanes = new Map<string, Date[]>()
  const woCursor = new Map<string, Date>()
  const placements: ScheduledTask[] = []
  const unschedulable: { taskNo: string; woNo: string; reason: string }[] = []

  for (const row of rows) {
    const center = centerMap.get(row.workCenterId)
    if (!center) {
      unschedulable.push({ taskNo: row.taskNo, woNo: row.woNo, reason: 'work centre is inactive or missing' })
      continue
    }
    const laneTimes = lanes.get(center.id) ?? Array.from({ length: Math.max(1, center.parallelCapacity) }, () => from)
    const earliest = new Date(Math.max(row.notBefore.getTime(), woCursor.get(row.woId)?.getTime() ?? 0))
    let best: { index: number; start: Date; end: Date } | null = null
    for (let i = 0; i < laneTimes.length; i += 1) {
      const start = nextWorkingStart(center, new Date(Math.max(laneTimes[i].getTime(), earliest.getTime())))
      if (!start) continue
      const end = addWorkingMinutes(center, start, row.minutes)
      if (!end) continue
      if (end.getTime() > horizonEnd.getTime()) continue
      if (!best || start.getTime() < best.start.getTime()) best = { index: i, start, end }
    }
    if (!best) {
      unschedulable.push({
        taskNo: row.taskNo,
        woNo: row.woNo,
        reason: center.calendar ? `no free ${center.name} capacity inside ${horizonDays} days` : 'work centre has no capacity configured',
      })
      continue
    }
    laneTimes[best.index] = best.end
    lanes.set(center.id, laneTimes)
    woCursor.set(row.woId, new Date(Math.max(woCursor.get(row.woId)?.getTime() ?? 0, best.end.getTime())))
    placements.push({
      taskId: row.id,
      taskNo: row.taskNo,
      woId: row.woId,
      woNo: row.woNo,
      projectNo: row.projectNo,
      operation: row.operation,
      seq: row.seq,
      workCenterId: center.id,
      workCenter: `${center.code} — ${center.name}`,
      minutes: row.minutes,
      start: best.start,
      end: best.end,
    })
  }

  // Lateness per work order: latest planned finish for the order vs its promise.
  const perWo = new Map<string, { woNo: string; projectNo: string; due: Date | null; finish: Date; minutes: number }>()
  for (const p of placements) {
    const row = rows.find((r) => r.id === p.taskId)!
    const existing = perWo.get(row.woId)
    perWo.set(row.woId, {
      woNo: row.woNo,
      projectNo: row.projectNo,
      due: row.due,
      finish: new Date(Math.max(existing?.finish.getTime() ?? 0, p.end.getTime())),
      minutes: r2((existing?.minutes ?? 0) + p.minutes),
    })
  }
  const lateWorkOrders = [...perWo.values()]
    .filter((w) => w.due && w.finish.getTime() > w.due.getTime())
    .map((w) => ({
      woNo: w.woNo,
      projectNo: w.projectNo,
      due: w.due!,
      plannedFinish: w.finish,
      lateDays: Math.ceil((w.finish.getTime() - w.due!.getTime()) / 86_400_000),
    }))
    .sort((a, b) => b.lateDays - a.lateDays)

  // Load per centre inside the horizon versus its calendar capacity.
  const load = centers.map((c) => {
    const centreTasks = placements.filter((p) => p.workCenterId === c.id)
    let capacity = 0
    for (let d = 0; d < horizonDays; d += 1) capacity += capacityMinutesOn(c, addDays(from, d))
    const planned = r2(centreTasks.reduce((s, p) => s + p.minutes, 0))
    return {
      workCenterId: c.id,
      workCenter: `${c.code} — ${c.name}`,
      tasks: centreTasks.length,
      plannedMinutes: planned,
      capacityMinutes: r2(capacity),
      utilisationPct: capacity > 0 ? r2((planned / capacity) * 100) : 0,
    }
  })

  return {
    from,
    horizonDays,
    placements: placements.sort((a, b) => a.start.getTime() - b.start.getTime()),
    unschedulable,
    lateWorkOrders,
    load: load.sort((a, b) => b.utilisationPct - a.utilisationPct),
    workCentersWithoutCalendar: centers.filter((c) => !c.calendar).map((c) => `${c.code} — ${c.name}`),
  }
}

/** Fallback duration for a task created before routing existed. */
function fallbackMinutes(task: { hours: number; plannedQty: number }): number {
  if (task.hours > 0) return task.hours * 60
  return task.plannedQty > 0 ? 60 : 30 // one hour for a batch, half an hour for an ad-hoc step
}

/** Minutes of real capacity on one calendar day (0 on a holiday/non-working day). */
function shiftWindows(center: CenterWithCalendar, day: Date): { start: Date; end: Date }[] {
  const cap = capacityMinutesOn(center, day)
  if (cap <= 0) return []
  const base = dayStart(day).getTime()
  if (!center.calendar) {
    return [{ start: new Date(base + 9 * 60 * MINUTE), end: new Date(base + 9 * 60 * MINUTE + (center.dailyHours * 60 * MINUTE * center.parallelCapacity)) }]
  }
  return center.calendar.shifts
    .filter((s) => s.active && s.durationMin > 0)
    .map((s) => ({
      start: new Date(base + s.startMin * MINUTE),
      end: new Date(base + (s.startMin + s.durationMin) * MINUTE),
    }))
}

/** First moment ≥ `at` that falls inside a shift window (searches 400 days). */
function nextWorkingStart(center: CenterWithCalendar, at: Date): Date | null {
  let cursor = at
  for (let i = 0; i < 400; i += 1) {
    const windows = shiftWindows(center, cursor)
    for (const w of windows) {
      if (cursor.getTime() < w.start.getTime()) return w.start
      if (cursor.getTime() < w.end.getTime()) return cursor
    }
    cursor = dayStart(addDays(cursor, 1))
  }
  return null
}

/** Add working minutes to a start inside shift windows. */
function addWorkingMinutes(center: CenterWithCalendar, start: Date, minutes: number): Date | null {
  let remaining = minutes
  let cursor = start
  for (let i = 0; i < 400 && remaining > 0; i += 1) {
    const windows = shiftWindows(center, cursor)
    for (const w of windows) {
      if (w.end.getTime() <= cursor.getTime()) continue
      const from = Math.max(cursor.getTime(), w.start.getTime())
      const available = (w.end.getTime() - from) / MINUTE
      if (available <= 0) continue
      if (available >= remaining) return new Date(from + remaining * MINUTE)
      remaining -= available
      cursor = w.end
    }
    cursor = dayStart(addDays(cursor, 1))
  }
  return null
}

/**
 * Create the work order's operation tasks from the BOM revision's routing.
 * Called inside `createWorkOrderTx` so a work order never exists without the
 * process that makes it (when a routing is defined). Quantities are the same
 * BOM-derived planned quantity the material lines use; task numbers come from
 * the shared counter so they stay FY-aware and unique per company.
 *
 * Returns the created tasks; an empty array when the BOM has no routing.
 */
export async function generateTasksFromRoutingTx(
  tx: Tx,
  input: { workOrderId: string; bomId: string; quantity: number; dueDate?: Date | null; prefix?: string; only?: number[] }
) {
  const routing = await tx.routingOperation.findMany({
    where: { bomId: input.bomId, ...(input.only ? { seq: { in: input.only } } : {}) },
    orderBy: { seq: 'asc' },
    include: { workCenter: { select: { id: true, machineNo: true, active: true, name: true } } },
  })
  if (!routing.length) return []
  const inactive = routing.find((r) => !r.workCenter.active)
  if (inactive) {
    throw new BusinessError(`Routing operation ${inactive.seq} runs on inactive work centre "${inactive.workCenter.name}"`, 409)
  }
  const companyId = await tenantId(tx)
  const display = `${input.prefix ?? 'TASK'}-${fyCode(new Date())}`
  const created: { seq: number; operation: string; taskNo: string; workCenterId: string; plannedMinutes: number }[] = []
  for (const op of routing) {
    const counter = await tx.counter.upsert({
      where: { key: `${companyId}:${display}` },
      create: { key: `${companyId}:${display}`, value: 1 },
      update: { value: { increment: 1 } },
    })
    const taskNo = `${display}-${String(counter.value).padStart(3, '0')}`
    const minutes = operationMinutes(op, input.quantity)
    await tx.productionTask.create({
      data: {
        companyId,
        taskNo,
        workOrderId: input.workOrderId,
        seq: op.seq,
        operation: op.operation,
        workCenterId: op.workCenterId,
        machineNo: op.workCenter.machineNo,
        plannedMinutes: minutes,
        plannedQty: input.quantity,
        dueDate: input.dueDate ?? null,
        notes: op.notes,
        status: 'PENDING',
      },
    })
    created.push({ seq: op.seq, operation: op.operation, taskNo, workCenterId: op.workCenterId, plannedMinutes: minutes })
  }
  return created
}
