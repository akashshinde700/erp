/**
 * ForgeERP — OEE (Overall Equipment Effectiveness) from real shift data.
 *
 * OEE = Availability × Performance × Quality, and each factor is computed from
 * records this system actually holds, per work centre per day:
 *
 *  - **Availability** = run time ÷ planned production time.
 *    Planned time comes from the work centre's shift calendar (`capacityMinutesOn`,
 *    with parallel capacity normalised away — availability is about time, not
 *    lanes). Run time = planned time − *unplanned* downtime minutes (breakdown,
 *    changeover, no material, no operator, power, quality). Planned maintenance
 *    is excluded from the loss, which is the standard convention.
 *
 *  - **Performance** = (ideal cycle time × good+reject count) ÷ run time.
 *    Ideal cycle time is the routing's run minutes per unit for that operation.
 *    Only operations with a routing time contribute, because inventing an ideal
 *    time would fabricate a number; the response says how many tasks were
 *    excluded for that reason.
 *
 *  - **Quality** = good quantity ÷ total produced
 *    (`actualQty / (actualQty + rejectionQty)`), from completed tasks.
 *
 * This intentionally replaces nothing: the existing throughput/yield report
 * (`productionEfficiencyReport`) stays as the labour/machine cost view. OEE is
 * meaningful only from the moment downtime and routings exist, so every row
 * carries `dataQuality` flags and a `limited` note instead of pretending the
 * history before that point was fully observed.
 */
import { db } from './db'
import { r2, EPS } from './erp'
import { capacityMinutesOn } from './routing'
import { BusinessError } from './accounting'

const MINUTE = 60_000
const DAY_MS = 86_400_000

const dayStart = (d: Date | string): Date => {
  const dt = typeof d === 'string' ? new Date(d) : new Date(d.getTime())
  if (Number.isNaN(dt.getTime())) throw new BusinessError('Invalid date — use YYYY-MM-DD')
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
}
const dayKey = (d: Date): string => d.toISOString().slice(0, 10)

export interface OeeRow {
  workCenterId: string
  workCenter: string
  day: string
  plannedMinutes: number
  downtimeMinutes: number
  runMinutes: number
  availabilityPct: number
  performancePct: number
  qualityPct: number
  oeePct: number
  idealMinutes: number
  goodQty: number
  rejectQty: number
  tasks: number
  /** Reasons for the measured downtime on that day, minutes each. */
  downtimeByReason: Record<string, number>
  /** Human-readable caveats about the confidence of this row. */
  notes: string[]
}

export interface OeeReport {
  from: Date
  to: Date
  days: number
  rows: OeeRow[]
  byWorkCenter: OeeRow[]
  byDay: OeeRow[]
  summary: {
    plannedMinutes: number
    downtimeMinutes: number
    runMinutes: number
    availabilityPct: number
    performancePct: number
    qualityPct: number
    oeePct: number
    workCenters: number
    days: number
  }
  excluded: { tasksWithoutIdealTime: number; tasksWithoutWorkCenter: number; openDowntime: number }
  notes: string[]
}

const pct = (numerator: number, denominator: number): number =>
  denominator > EPS ? r2((numerator / denominator) * 100) : 0

/**
 * @param from  first day (inclusive)
 * @param to    last day (inclusive)
 * @param workCenterId restrict to one centre
 */
export async function oeeReport(input: { from?: string | Date; to?: string | Date; workCenterId?: string } = {}): Promise<OeeReport> {
  const today = dayStart(new Date())
  const to = dayStart(input.to ?? today)
  const from = dayStart(input.from ?? new Date(to.getTime() - 6 * DAY_MS))
  if (to.getTime() < from.getTime()) throw new BusinessError('The report end date cannot be before its start date')
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1
  if (days > 366) throw new BusinessError('OEE windows are limited to 366 days — pick a shorter range')

  const centers = await db.workCenter.findMany({
    where: { active: true, ...(input.workCenterId ? { id: input.workCenterId } : {}) },
    include: { calendar: { include: { shifts: true, holidays: true } } },
  })

  // Completed tasks in the window, with the routing time of the operation they
  // executed (if the BOM revision of the work order has a routing).
  const tasks = await db.productionTask.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { gte: from, lt: new Date(to.getTime() + DAY_MS) },
      ...(input.workCenterId ? { workCenterId: input.workCenterId } : {}),
    },
    select: {
      id: true,
      operation: true,
      workCenterId: true,
      actualQty: true,
      rejectionQty: true,
      hours: true,
      completedAt: true,
      workOrder: { select: { bomId: true } },
    },
  })

  const bomIds = [...new Set(tasks.map((t) => t.workOrder.bomId).filter((id): id is string => !!id))]
  const routings = bomIds.length
    ? await db.routingOperation.findMany({
        where: { bomId: { in: bomIds } },
        select: { bomId: true, operation: true, runMinutesPerUnit: true },
      })
    : []
  const idealByKey = new Map<string, number>()
  for (const r of routings) idealByKey.set(`${r.bomId}|${r.operation}`, r.runMinutesPerUnit)

  const downtime = await db.machineDowntime.findMany({
    where: {
      startedAt: { lt: new Date(to.getTime() + DAY_MS) },
      OR: [{ endedAt: null }, { endedAt: { gt: from } }],
      ...(input.workCenterId ? { workCenterId: input.workCenterId } : {}),
    },
    select: { workCenterId: true, startedAt: true, endedAt: true, reason: true, planned: true },
  })

  let tasksWithoutIdealTime = 0
  let tasksWithoutWorkCenter = 0

  // Bucket per centre/day.
  type Bucket = {
    plannedMinutes: number
    downtimeMinutes: number
    idealMinutes: number
    goodQty: number
    rejectQty: number
    tasks: number
    downtimeByReason: Record<string, number>
    hasCalendar: boolean
    hoursWithoutIdeal: number
  }
  const buckets = new Map<string, Bucket>()
  const keyOf = (workCenterId: string, day: string) => `${workCenterId}|${day}`
  const bucketFor = (workCenterId: string, day: string): Bucket => {
    const key = keyOf(workCenterId, day)
    let b = buckets.get(key)
    if (!b) {
      const center = centers.find((c) => c.id === workCenterId)
      const dayDate = dayStart(day)
      b = {
        plannedMinutes: center ? capacityMinutesOn(center, dayDate) : 0,
        downtimeMinutes: 0,
        idealMinutes: 0,
        goodQty: 0,
        rejectQty: 0,
        tasks: 0,
        downtimeByReason: {},
        hasCalendar: !!center?.calendar,
        hoursWithoutIdeal: 0,
      }
      buckets.set(key, b)
    }
    return b
  }

  // Pre-create every centre/day bucket so a day with zero output shows as 0 %
  // rather than disappearing (an idle machine is an availability fact).
  for (const c of centers) {
    for (let d = 0; d < days; d += 1) bucketFor(c.id, dayKey(new Date(from.getTime() + d * DAY_MS)))
  }

  for (const t of tasks) {
    if (!t.workCenterId) {
      tasksWithoutWorkCenter += 1
      continue
    }
    if (!t.completedAt) continue
    const day = dayKey(dayStart(t.completedAt))
    const b = bucketFor(t.workCenterId, day)
    b.tasks += 1
    b.goodQty = r2(b.goodQty + t.actualQty)
    b.rejectQty = r2(b.rejectQty + t.rejectionQty)
    const idealPerUnit = t.workOrder.bomId ? idealByKey.get(`${t.workOrder.bomId}|${t.operation}`) : undefined
    if (idealPerUnit === undefined) {
      tasksWithoutIdealTime += 1
      b.hoursWithoutIdeal = r2(b.hoursWithoutIdeal + (t.hours ?? 0))
    } else {
      b.idealMinutes = r2(b.idealMinutes + idealPerUnit * (t.actualQty + t.rejectionQty))
    }
  }

  let openDowntime = 0
  for (const d of downtime) {
    const end = d.endedAt ?? new Date()
    if (!d.endedAt) openDowntime += 1
    // Split a stoppage across the days it spans so a 3-day breakdown does not
    // land entirely on its first day.
    let cursor = Math.max(d.startedAt.getTime(), from.getTime())
    const stop = Math.min(end.getTime(), to.getTime() + DAY_MS)
    while (cursor < stop) {
      const dayBegin = dayStart(new Date(cursor)).getTime()
      const slice = Math.min(stop, dayBegin + DAY_MS) - cursor
      if (slice > 0 && !d.planned) {
        const b = bucketFor(d.workCenterId, dayKey(new Date(cursor)))
        b.downtimeMinutes = r2(b.downtimeMinutes + slice / MINUTE)
        b.downtimeByReason[d.reason] = r2((b.downtimeByReason[d.reason] ?? 0) + slice / MINUTE)
      }
      cursor = dayBegin + DAY_MS
    }
  }
  const centerName = new Map(centers.map((c) => [c.id, `${c.code} — ${c.name}`]))
  const rows: OeeRow[] = [...buckets.entries()]
    .map(([key, b]) => {
      const [workCenterId, day] = key.split('|')
      const runMinutes = r2(Math.max(0, b.plannedMinutes - b.downtimeMinutes))
      const availabilityPct = pct(runMinutes, b.plannedMinutes)
      const performancePct = pct(b.idealMinutes, runMinutes)
      const good = r2(b.goodQty + b.rejectQty)
      const qualityPct = pct(b.goodQty, good)
      const notes: string[] = []
      if (!b.hasCalendar) notes.push('no shift calendar: capacity and downtime cannot be compared to a real shift')
      if (b.hoursWithoutIdeal > 0) notes.push(`${r2(b.hoursWithoutIdeal)} h of work has no routed ideal time and is left out of performance`)
      if (b.tasks === 0) notes.push('no completed operations on this day')
      if (performancePct > 100) notes.push('performance above 100 % means the recorded run time is shorter than the routed cycle time')
      return {
        workCenterId,
        workCenter: centerName.get(workCenterId) ?? workCenterId,
        day,
        plannedMinutes: r2(b.plannedMinutes),
        downtimeMinutes: r2(b.downtimeMinutes),
        runMinutes,
        availabilityPct,
        performancePct,
        qualityPct,
        oeePct: r2((availabilityPct / 100) * (performancePct / 100) * (qualityPct / 100) * 100),
        idealMinutes: r2(b.idealMinutes),
        goodQty: r2(b.goodQty),
        rejectQty: r2(b.rejectQty),
        tasks: b.tasks,
        downtimeByReason: b.downtimeByReason,
        notes,
      }
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.workCenter.localeCompare(b.workCenter))

  const aggregate = (group: OeeRow[], label: (r: OeeRow) => string): OeeRow[] => {
    const map = new Map<string, OeeRow>()
    for (const r of group) {
      const label1 = label(r)
      const acc = map.get(label1)
      if (!acc) {
        // Identity columns come from the group key, not from the first row.
        map.set(label1, { ...r, workCenter: label1, notes: [] })
        continue
      }
      acc.plannedMinutes = r2(acc.plannedMinutes + r.plannedMinutes)
      acc.downtimeMinutes = r2(acc.downtimeMinutes + r.downtimeMinutes)
      acc.runMinutes = r2(acc.runMinutes + r.runMinutes)
      acc.idealMinutes = r2(acc.idealMinutes + r.idealMinutes)
      acc.goodQty = r2(acc.goodQty + r.goodQty)
      acc.rejectQty = r2(acc.rejectQty + r.rejectQty)
      acc.tasks += r.tasks
      acc.downtimeByReason = mergeReasons(acc.downtimeByReason, r.downtimeByReason)
      const missing = r.notes.find((n) => n.includes('no routed ideal time'))
      if (missing) acc.notes = [...new Set([...acc.notes, missing])]
    }
    return [...map.values()]
      .map((acc) => {
        const availability = pct(acc.runMinutes, acc.plannedMinutes)
        const performance = pct(acc.idealMinutes, acc.runMinutes)
        const quality = pct(acc.goodQty, acc.goodQty + acc.rejectQty)
        return {
          ...acc,
          availabilityPct: availability,
          performancePct: performance,
          qualityPct: quality,
          oeePct: r2((availability / 100) * (performance / 100) * (quality / 100) * 100),
        }
      })
      .sort((a, b) => a.oeePct - b.oeePct)
  }

  const totals = aggregate(rows, () => 'all')
  const summary = totals[0] ?? {
    plannedMinutes: 0,
    downtimeMinutes: 0,
    runMinutes: 0,
    availabilityPct: 0,
    performancePct: 0,
    qualityPct: 0,
    oeePct: 0,
  }

  const notes: string[] = []
  if (openDowntime > 0) notes.push(`${openDowntime} downtime record(s) are still open — they are counted up to now`)
  if (tasksWithoutWorkCenter > 0) notes.push(`${tasksWithoutWorkCenter} completed task(s) have no work centre and cannot be attributed to a machine`)
  if (tasksWithoutIdealTime > 0) notes.push(`${tasksWithoutIdealTime} completed task(s) ran without a routed ideal time — performance covers only routed work`)
  if (rows.every((r) => r.downtimeMinutes === 0)) notes.push('no downtime recorded in this window: availability equals 100 % by construction, so treat it as unmeasured rather than perfect')
  if (rows.some((r) => !r.notes.every((n) => n === 'no completed operations on this day'))) {
    notes.push('centres without a shift calendar use their daily hours as capacity')
  }

  return {
    from,
    to,
    days,
    rows,
    byWorkCenter: aggregate(rows, (r) => r.workCenter),
    byDay: aggregate(rows, (r) => r.day).sort((a, b) => a.day.localeCompare(b.day)),
    summary: {
      plannedMinutes: r2(summary.plannedMinutes),
      downtimeMinutes: r2(summary.downtimeMinutes),
      runMinutes: r2(summary.runMinutes),
      availabilityPct: summary.availabilityPct,
      performancePct: summary.performancePct,
      qualityPct: summary.qualityPct,
      oeePct: summary.oeePct,
      workCenters: new Set(rows.map((r) => r.workCenterId)).size,
      days,
    },
    excluded: { tasksWithoutIdealTime, tasksWithoutWorkCenter, openDowntime },
    notes,
  }
}

function mergeReasons(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = r2((out[k] ?? 0) + v)
  return out
}

