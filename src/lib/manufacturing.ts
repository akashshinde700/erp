/**
 * ForgeERP — Manufacturing services (Project → BOM → Work Order → Tasks).
 *
 * Absolute-ERP-style fabrication flow, built on the same three invariants as
 * the rest of the books:
 *  1. every posting is ONE prisma.$transaction (task completion writes the
 *     task AND its material-issue stock ledger row atomically);
 *  2. ledgers stay append-only — COMPLETED tasks are final (the stock issue
 *     cannot be orphaned), cancellations only touch documents;
 *  3. numbering is atomic via Counter (PRJ global; BOM/WO/TASK FY-aware).
 * All state-machine guards (approve → generate WO → assign → start → complete
 * → complete WO → complete project) run SERVER-side; client input untrusted.
 */
import { db } from './db'
import { Prisma } from '@prisma/client'
import { r2, fyCode, EPS } from './erp'
import { isValidDateString } from './validation'
import { BusinessError, postGl } from './accounting'
import { consumeLotsFefoTx } from './traceability'
import { tenantCompany } from './tenant'

type Tx = Prisma.TransactionClient

export { BusinessError }

// ---------- constants ----------

export const OPERATIONS: { key: string; label: string }[] = [
  { key: 'CUTTING', label: 'Material Cutting' },
  { key: 'CNC_LASER', label: 'CNC / Laser Cutting' },
  { key: 'BENDING', label: 'Bending' },
  { key: 'DRILLING', label: 'Drilling' },
  { key: 'WELDING', label: 'Welding' },
  { key: 'GRINDING', label: 'Grinding' },
  { key: 'ASSEMBLY', label: 'Assembly' },
  { key: 'PAINTING', label: 'Painting / Powder Coating' },
  { key: 'FINISHING', label: 'Final Finishing' },
  { key: 'OTHER', label: 'Other' },
]

export const OPERATION_LABEL: Record<string, string> = Object.fromEntries(
  OPERATIONS.map((o) => [o.key, o.label])
)

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
export const TASK_ACTIVE = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] as const

/** Over-production tolerance for task completion (planned vs actual+rejection). */
const TASK_TOLERANCE = 1.1

const iso = (d?: string | Date | null): Date => {
  if (d === undefined || d === null || d === '') return new Date()
  if (typeof d === 'string' && !isValidDateString(d)) throw new BusinessError('Invalid date — use YYYY-MM-DD', 400)
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) throw new BusinessError('Invalid date — use YYYY-MM-DD', 400)
  return dt
}

// ---------- numbering ----------

/** FY-aware gapless doc number: BOM-2526-001 */
async function orgKey(tx: Tx, key: string): Promise<string> {
  const company = await tenantCompany(tx)
  if (!company) throw new BusinessError('Company profile is not set up yet', 409)
  return `${company.id}:${key}` // per-organisation series
}

async function nextDocNo(tx: Tx, prefix: string, date: Date): Promise<string> {
  const fy = fyCode(date)
  const display = `${prefix}-${fy}`
  const key = await orgKey(tx, display)
  const counter = await tx.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${display}-${String(counter.value).padStart(3, '0')}`
}

/** Global sequential project number: PRJ-0001 (projects span FYs). */
async function nextProjectNo(tx: Tx): Promise<string> {
  const key = await orgKey(tx, 'PRJ')
  const counter = await tx.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `PRJ-${String(counter.value).padStart(4, '0')}`
}

// ---------- stock helpers ----------

async function stockAvail(tx: Tx, itemId: string, warehouseId?: string): Promise<number> {
  // OWN stock only — JOBWORK_IN rows are customer-owned material (rate 0) and
  // must never satisfy a manufacturing consumption requirement.
  const rows = await tx.stockLedger.findMany({
    where: warehouseId
      ? { itemId, warehouseId, isCancelled: false, voucherType: { not: 'JOBWORK_IN' } }
      : { itemId, isCancelled: false, voucherType: { not: 'JOBWORK_IN' } },
    select: { qtyIn: true, qtyOut: true },
  })
  return r2(rows.reduce((s, r) => s + r.qtyIn - r.qtyOut, 0))
}

async function avgCost(tx: Tx, itemId: string, warehouseId: string): Promise<number> {
  // Weighted average over OWN receipts only (JW customer material is rate 0
  // and would dilute the issue valuation).
  const rows = await tx.stockLedger.findMany({
    where: { itemId, warehouseId, isCancelled: false, voucherType: { not: 'JOBWORK_IN' } },
    select: { qtyIn: true, rate: true },
  })
  let qty = 0
  let value = 0
  for (const r of rows) {
    qty += r.qtyIn
    value += r.qtyIn * r.rate
  }
  return qty > EPS ? r2(value / qty) : 0
}

async function defaultWarehouseId(tx: Tx): Promise<string> {
  const w = await tx.warehouse.findFirst({ where: { code: 'MAIN' } })
  if (w) return w.id
  const any = await tx.warehouse.findFirst({ orderBy: { code: 'asc' } })
  if (!any) throw new BusinessError('No warehouse defined. Create one in Masters first.', 409)
  return any.id
}

// ---------- employees ----------

export interface EmployeeInput {
  code?: string
  name: string
  role?: string
  skill?: string | null
  machineNo?: string | null
  shift?: string
  hourlyRate?: number
  phone?: string | null
  active?: boolean
}

export async function listEmployees() {
  return db.employee.findMany({
    orderBy: { code: 'asc' },
    include: { _count: { select: { tasks: true } } },
  })
}

export async function createEmployee(input: EmployeeInput) {
  return db.$transaction(async (tx) => {
    const code = (input.code ?? '').trim().toUpperCase()
    if (!code) throw new BusinessError('Employee code is required')
    if (!input.name?.trim()) throw new BusinessError('Employee name is required')
    const dup = await tx.employee.findFirst({ where: { code } })
    if (dup) throw new BusinessError(`Employee code "${code}" already exists`, 409)
    return tx.employee.create({
      data: {
        code,
        name: input.name.trim(),
        role: input.role ?? 'WORKER',
        skill: input.skill ?? null,
        machineNo: input.machineNo ?? null,
        shift: input.shift ?? 'GENERAL',
        hourlyRate: r2(input.hourlyRate ?? 0),
        phone: input.phone ?? null,
        active: input.active ?? true,
      },
    })
  })
}

export async function updateEmployee(id: string, input: Partial<EmployeeInput>) {
  return db.$transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id } })
    if (!emp) throw new BusinessError('Employee not found', 404)
    const data: Prisma.EmployeeUpdateInput = { name: input.name?.trim() || emp.name }
    if (input.role !== undefined) data.role = input.role
    if (input.skill !== undefined) data.skill = input.skill
    if (input.machineNo !== undefined) data.machineNo = input.machineNo
    if (input.shift !== undefined) data.shift = input.shift
    if (input.hourlyRate !== undefined) data.hourlyRate = r2(input.hourlyRate)
    if (input.phone !== undefined) data.phone = input.phone
    if (input.active !== undefined) data.active = input.active
    return tx.employee.update({ where: { id }, data })
  })
}

export async function deleteEmployee(id: string) {
  return db.$transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id }, include: { _count: { select: { tasks: true } } } })
    if (!emp) throw new BusinessError('Employee not found', 404)
    if (emp._count.tasks > 0) {
      // Tasks reference this worker — deactivate instead of orphaning history.
      throw new BusinessError(
        `"${emp.name}" has ${emp._count.tasks} task(s) on record — deactivate instead of deleting`,
        409
      )
    }
    await tx.employee.delete({ where: { id } })
    return { id }
  })
}

// ---------- projects ----------

const projectInclude = {
  party: { select: { id: true, code: true, name: true, city: true } },
  boms: { select: { id: true, status: true } },
  workOrders: {
    include: {
      tasks: { select: { status: true, labourCost: true, materialCost: true } },
    },
  },
} satisfies Prisma.ProjectInclude

type ProjectWithStats = Prisma.ProjectGetPayload<{ include: typeof projectInclude }> & {
  stats: {
    bomCount: number
    woCount: number
    taskTotal: number
    taskDone: number
    progressPct: number
    actualCost: number
    labourCost: number
    materialCost: number
  }
}

function withStats(p: Prisma.ProjectGetPayload<{ include: typeof projectInclude }>): ProjectWithStats {
  const tasks = p.workOrders.flatMap((w) => w.tasks)
  const taskTotal = tasks.filter((t) => t.status !== 'CANCELLED').length
  const taskDone = tasks.filter((t) => t.status === 'COMPLETED').length
  const actualCost = r2(tasks.reduce((s, t) => s + t.labourCost + t.materialCost, 0))
  const labourCost = r2(tasks.reduce((s, t) => s + t.labourCost, 0))
  const materialCost = r2(tasks.reduce((s, t) => s + t.materialCost, 0))
  return {
    ...p,
    stats: {
      bomCount: p.boms.filter((b) => b.status !== 'CANCELLED').length,
      woCount: p.workOrders.filter((w) => w.status !== 'CANCELLED').length,
      taskTotal,
      taskDone,
      progressPct: taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0,
      actualCost,
      labourCost,
      materialCost,
    },
  }
}

export async function listProjects() {
  const rows = await db.project.findMany({ orderBy: { createdAt: 'desc' }, include: projectInclude })
  return rows.map(withStats)
}

export async function getProjectDetail(id: string) {
  const p = await db.project.findUnique({
    where: { id },
    include: {
      party: true,
      boms: {
        orderBy: { createdAt: 'asc' },
        include: { items: { include: { item: { select: { id: true, code: true, name: true, uom: true, costRate: true } } } } },
      },
      workOrders: {
        orderBy: { createdAt: 'asc' },
        include: {
          lines: { include: { item: { select: { code: true, name: true, uom: true } } } },
          tasks: { orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }], include: { employee: { select: { id: true, code: true, name: true, machineNo: true } } } },
        },
      },
    },
  })
  if (!p) throw new BusinessError('Project not found', 404)

  // MRP-style stock check per BOM line (gross requirement vs available stock).
  const tx = db as unknown as Tx
  const boms = await Promise.all(
    p.boms.map(async (b) => {
      const items = await Promise.all(
        b.items.map(async (bi) => {
          const avail = await stockAvail(tx, bi.itemId)
          const grossQty = r2(bi.qty * (1 + bi.wastagePct / 100))
          return { ...bi, avail, grossQty, shortage: r2(Math.max(0, grossQty - avail)) }
        })
      )
      return { ...b, items }
    })
  )

  const tasks = p.workOrders.flatMap((w) => w.tasks)
  const taskTotal = tasks.filter((t) => t.status !== 'CANCELLED').length
  const taskDone = tasks.filter((t) => t.status === 'COMPLETED').length
  const labourCost = r2(tasks.reduce((s, t) => s + t.labourCost, 0))
  const materialCost = r2(tasks.reduce((s, t) => s + t.materialCost, 0))

  return {
    ...p,
    boms,
    stats: {
      bomCount: p.boms.filter((b) => b.status !== 'CANCELLED').length,
      woCount: p.workOrders.filter((w) => w.status !== 'CANCELLED').length,
      taskTotal,
      taskDone,
      progressPct: taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0,
      labourCost,
      materialCost,
      actualCost: r2(labourCost + materialCost),
      estCost: p.estCost,
      // Project-wise P&L view: contract value vs cost so far
      budget: p.budget,
      margin: r2(p.budget - labourCost - materialCost),
      pendingTasks: taskTotal - taskDone,
    },
  }
}

export interface ProjectInput {
  name: string
  partyId: string
  manager?: string | null
  location?: string | null
  startDate: string | Date
  endDate?: string | Date | null
  budget?: number
  documents?: string | null
  notes?: string | null
}

export async function createProject(input: ProjectInput) {
  return db.$transaction(async (tx) => {
    if (!input.name?.trim()) throw new BusinessError('Project name is required')
    const party = await tx.party.findUnique({ where: { id: input.partyId } })
    if (!party) throw new BusinessError('Customer not found', 404)
    if (!party.types.includes('CUSTOMER')) {
      throw new BusinessError(`Party "${party.name}" is not flagged as a CUSTOMER — pick a customer party`)
    }
    const start = iso(input.startDate)
    const end = input.endDate ? iso(input.endDate) : null
    if (end && end.getTime() < start.getTime()) {
      throw new BusinessError('Planned end date cannot be before the start date')
    }
    const projectNo = await nextProjectNo(tx)
    return tx.project.create({
      data: {
        projectNo,
        name: input.name.trim(),
        partyId: party.id,
        manager: input.manager ?? null,
        location: input.location ?? null,
        startDate: start,
        endDate: end,
        budget: r2(input.budget ?? 0),
        documents: input.documents ?? null,
        notes: input.notes ?? null,
      },
    })
  })
}

export async function updateProject(id: string, input: Partial<ProjectInput> & { status?: string }) {
  return db.$transaction(async (tx) => {
    const p = await tx.project.findUnique({ where: { id } })
    if (!p) throw new BusinessError('Project not found', 404)
    if (p.status === 'COMPLETED') throw new BusinessError('Completed projects are frozen (append-only history)')
    const data: Prisma.ProjectUpdateInput = {}
    if (input.name !== undefined && input.name.trim()) data.name = input.name.trim()
    if (input.manager !== undefined) data.manager = input.manager
    if (input.location !== undefined) data.location = input.location
    if (input.startDate !== undefined) data.startDate = iso(input.startDate)
    if (input.endDate !== undefined) data.endDate = input.endDate ? iso(input.endDate) : null
    const start = (data.startDate as Date | undefined) ?? p.startDate
    const end = (data.endDate as Date | undefined) ?? p.endDate
    if (start && end && (end as Date).getTime() < (start as Date).getTime()) {
      throw new BusinessError('Planned end date cannot be before the start date')
    }
    if (input.budget !== undefined) data.budget = r2(input.budget)
    if (input.documents !== undefined) data.documents = input.documents
    if (input.notes !== undefined) data.notes = input.notes
    return tx.project.update({ where: { id }, data })
  })
}

/** PENDING → RUNNING (explicit project start). */
export async function startProject(id: string) {
  return db.$transaction(async (tx) => {
    const p = await tx.project.findUnique({ where: { id } })
    if (!p) throw new BusinessError('Project not found', 404)
    if (p.status !== 'PENDING') throw new BusinessError(`Only PENDING projects can start (current: ${p.status})`)
    return tx.project.update({ where: { id }, data: { status: 'RUNNING' } })
  })
}

/**
 * The project completion process: every non-cancelled work order must be
 * COMPLETED first — the guard that makes "completed" mean something.
 */
export async function completeProject(id: string) {
  return db.$transaction(async (tx) => {
    const p = await tx.project.findUnique({ where: { id }, include: { workOrders: { select: { status: true } } } })
    if (!p) throw new BusinessError('Project not found', 404)
    if (p.status !== 'RUNNING') {
      throw new BusinessError(`Only RUNNING projects can be completed (current: ${p.status}). Start the project first.`)
    }
    const active = p.workOrders.filter((w) => w.status !== 'CANCELLED')
    if (active.length === 0) {
      throw new BusinessError('A project cannot be completed without at least one completed work order')
    }
    const open = active.filter((w) => w.status !== 'COMPLETED')
    if (open.length > 0) {
      throw new BusinessError(
        `${open.length} work order(s) still open — complete or cancel them before completing the project`
      )
    }
    return tx.project.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } })
  })
}

export async function cancelProject(id: string) {
  return db.$transaction(async (tx) => {
    const p = await tx.project.findUnique({
      where: { id },
      include: { workOrders: { select: { id: true, status: true, tasks: { select: { status: true } } } } },
    })
    if (!p) throw new BusinessError('Project not found', 404)
    if (p.status === 'COMPLETED') throw new BusinessError('Completed projects cannot be cancelled')
    if (p.status === 'CANCELLED') throw new BusinessError('Project is already cancelled')
    const hasProduction = p.workOrders.some((w) => w.tasks.some((t) => t.status === 'COMPLETED'))
    if (hasProduction) {
      throw new BusinessError('Production has started on this project (completed tasks exist) — it cannot be cancelled', 409)
    }
    // Cascade-cancel dangling WOs/tasks (none wrote stock: no COMPLETED tasks).
    for (const w of p.workOrders) {
      if (w.status !== 'CANCELLED') {
        await tx.productionTask.updateMany({
          where: { workOrderId: w.id, status: { in: [...TASK_ACTIVE] } },
          data: { status: 'CANCELLED' },
        })
        await tx.workOrder.update({ where: { id: w.id }, data: { status: 'CANCELLED' } })
      }
    }
    return tx.project.update({ where: { id }, data: { status: 'CANCELLED' } })
  })
}

// ---------- BOMs ----------

export interface BomLineInput {
  itemId: string
  grade?: string | null
  thickness?: number
  length?: number
  width?: number
  qty: number
  uom: string
  wastagePct?: number
  rate?: number
  drawingRef?: string | null
  remarks?: string | null
}

export interface BomInput {
  projectId: string
  productName: string
  drawingRef?: string | null
  notes?: string | null
  lines: BomLineInput[]
}

function computeBomLine(l: BomLineInput, costRate: number): Omit<Prisma.BomItemCreateWithoutBomInput, 'item'> {
  const qty = l.qty
  const wastagePct = l.wastagePct ?? 0
  const rate = l.rate && l.rate > 0 ? l.rate : costRate
  const estCost = r2(qty * (1 + wastagePct / 100) * rate)
  return {
    grade: l.grade ?? null,
    thickness: r2(l.thickness ?? 0),
    length: r2(l.length ?? 0),
    width: r2(l.width ?? 0),
    qty,
    uom: l.uom,
    wastagePct,
    rate,
    estCost,
    drawingRef: l.drawingRef ?? null,
    remarks: l.remarks ?? null,
  }
}

/** Recompute project.estCost = Σ approved BOM estCost (call inside a tx after mutation). */
async function refreshProjectEstCost(tx: Tx, projectId: string) {
  const boms = await tx.bom.findMany({
    where: { projectId, status: 'APPROVED' },
    select: { items: { select: { estCost: true } } },
  })
  const est = r2(boms.reduce((s, b) => s + b.items.reduce((x, i) => x + i.estCost, 0), 0))
  await tx.project.update({ where: { id: projectId }, data: { estCost: est } })
  return est
}

export async function listBoms(projectId?: string) {
  const rows = await db.bom.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      project: { select: { id: true, projectNo: true, name: true, status: true } },
      items: { include: { item: { select: { code: true, name: true, uom: true } } } },
      _count: { select: { workOrders: true } },
    },
  })
  // Totals + MRP stock availability per line
  const tx = db as unknown as Tx
  return Promise.all(
    rows.map(async (b) => ({
      ...b,
      totalEstCost: r2(b.items.reduce((s, i) => s + i.estCost, 0)),
      items: await Promise.all(
        b.items.map(async (i) => {
          const avail = await stockAvail(tx, i.itemId)
          const grossQty = r2(i.qty * (1 + i.wastagePct / 100))
          return { ...i, avail, grossQty, shortage: r2(Math.max(0, grossQty - avail)) }
        })
      ),
    }))
  )
}

export async function createBom(input: BomInput) {
  return db.$transaction(async (tx) => {
    if (!input.lines?.length) throw new BusinessError('BOM needs at least one material line')
    const project = await tx.project.findUnique({ where: { id: input.projectId } })
    if (!project) throw new BusinessError('Project not found', 404)
    if (project.status === 'COMPLETED' || project.status === 'CANCELLED') {
      throw new BusinessError(`Project is ${project.status} — BOMs can only be added to active projects`)
    }
    if (!input.productName?.trim()) throw new BusinessError('Product / assembly name is required')

    const items = await tx.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } })
    const itemMap = new Map(items.map((i) => [i.id, i]))
    for (const l of input.lines) {
      const it = itemMap.get(l.itemId)
      if (!it) throw new BusinessError(`Item ${l.itemId} not found`, 404)
      if (!(l.qty > 0)) throw new BusinessError(`Quantity must be positive for "${it.name}"`)
      if ((l.wastagePct ?? 0) < 0 || (l.wastagePct ?? 0) > 50) throw new BusinessError(`Wastage % must be 0–50 for "${it.name}"`)
      if ((l.rate ?? 0) < 0) throw new BusinessError(`Rate cannot be negative for "${it.name}"`)
    }

    const date = new Date()
    const bomNo = await nextDocNo(tx, 'BOM', date)
    const bom = await tx.bom.create({
      data: {
        bomNo,
        projectId: project.id,
        productName: input.productName.trim(),
        drawingRef: input.drawingRef ?? null,
        notes: input.notes ?? null,
        items: {
          create: input.lines.map((l) => ({
            ...computeBomLine(l, itemMap.get(l.itemId)!.costRate),
            item: { connect: { id: l.itemId } },
          })),
        },
      },
      include: { items: true },
    })
    return bom
  })
}

export async function updateBom(id: string, input: Partial<BomInput> & { lines: BomLineInput[] }) {
  return db.$transaction(async (tx) => {
    const bom = await tx.bom.findUnique({ where: { id }, include: { items: true } })
    if (!bom) throw new BusinessError('BOM not found', 404)
    if (bom.status !== 'DRAFT') throw new BusinessError('Only DRAFT BOMs can be edited')
    if (!input.lines?.length) throw new BusinessError('BOM needs at least one material line')

    const items = await tx.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } })
    const itemMap = new Map(items.map((i) => [i.id, i]))
    for (const l of input.lines) {
      const it = itemMap.get(l.itemId)
      if (!it) throw new BusinessError(`Item ${l.itemId} not found`, 404)
      if (!(l.qty > 0)) throw new BusinessError(`Quantity must be positive for "${it.name}"`)
      if ((l.wastagePct ?? 0) < 0 || (l.wastagePct ?? 0) > 50) throw new BusinessError(`Wastage % must be 0–50 for "${it.name}"`)
      if ((l.rate ?? 0) < 0) throw new BusinessError(`Rate cannot be negative for "${it.name}"`)
    }

    await tx.bomItem.deleteMany({ where: { bomId: id } })
    return tx.bom.update({
      where: { id },
      data: {
        productName: input.productName?.trim() || bom.productName,
        drawingRef: input.drawingRef ?? null,
        notes: input.notes ?? null,
        items: {
          create: input.lines.map((l) => ({
            ...computeBomLine(l, itemMap.get(l.itemId)!.costRate),
            item: { connect: { id: l.itemId } },
          })),
        },
      },
      include: { items: true },
    })
  })
}

/** DRAFT → APPROVED. Approval recalculates the project's estimated cost.
 *  A BOM cannot be approved on a terminal project (COMPLETED/CANCELLED) —
 *  its estimate would never feed a work order. */
export async function approveBom(id: string) {
  return db.$transaction(async (tx) => {
    const bom = await tx.bom.findUnique({
      where: { id },
      include: { items: { select: { estCost: true } }, project: { select: { status: true } } },
    })
    if (!bom) throw new BusinessError('BOM not found', 404)
    if (bom.status !== 'DRAFT') throw new BusinessError(`Only DRAFT BOMs can be approved (current: ${bom.status})`)
    if (bom.items.length === 0) throw new BusinessError('Cannot approve an empty BOM')
    if (bom.project.status === 'COMPLETED' || bom.project.status === 'CANCELLED') {
      throw new BusinessError(`Project is ${bom.project.status} — its BOMs can no longer be approved`)
    }
    const est = r2(bom.items.reduce((s, i) => s + i.estCost, 0))
    const updated = await tx.bom.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date() } })
    await refreshProjectEstCost(tx, bom.projectId)
    return { ...updated, estCost: est }
  })
}

export async function cancelBom(id: string) {
  return db.$transaction(async (tx) => {
    const bom = await tx.bom.findUnique({
      where: { id },
      include: { workOrders: { select: { id: true, status: true } } },
    })
    if (!bom) throw new BusinessError('BOM not found', 404)
    if (bom.status === 'CANCELLED') throw new BusinessError('BOM is already cancelled')
    const activeWo = bom.workOrders.find((w) => w.status === 'OPEN' || w.status === 'IN_PROGRESS')
    if (activeWo) throw new BusinessError('An active work order was generated from this BOM — cancel it first')
    const updated = await tx.bom.update({ where: { id }, data: { status: 'CANCELLED' } })
    await refreshProjectEstCost(tx, bom.projectId)
    return updated
  })
}

// ---------- work orders ----------

export interface WoLineInput {
  itemId: string
  description?: string | null
  plannedQty: number
  uom: string
  bomItemId?: string | null
}

export interface WorkOrderInput {
  projectId: string
  bomId?: string | null
  date?: string | Date
  startDate?: string | Date | null
  endDate?: string | Date | null
  priority?: string
  notes?: string | null
  lines?: WoLineInput[] // optional when bomId given (lines pulled from BOM)
}

export async function listWorkOrders(projectId?: string) {
  const rows = await db.workOrder.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      project: { select: { id: true, projectNo: true, name: true, status: true } },
      bom: { select: { id: true, bomNo: true, productName: true } },
      lines: { include: { item: { select: { code: true, name: true, uom: true } } } },
      tasks: {
        orderBy: [{ seq: 'asc' }, { createdAt: 'asc' }],
        include: { employee: { select: { id: true, code: true, name: true } } },
      },
    },
  })
  return rows.map((w) => {
    const active = w.tasks.filter((t) => t.status !== 'CANCELLED')
    const done = active.filter((t) => t.status === 'COMPLETED').length
    return {
      ...w,
      stats: {
        taskTotal: active.length,
        taskDone: done,
        progressPct: active.length > 0 ? Math.round((done / active.length) * 100) : 0,
        labourCost: r2(active.reduce((s, t) => s + t.labourCost, 0)),
        materialCost: r2(active.reduce((s, t) => s + t.materialCost, 0)),
      },
    }
  })
}

export async function createWorkOrder(input: WorkOrderInput) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: input.projectId } })
    if (!project) throw new BusinessError('Project not found', 404)
    if (project.status === 'COMPLETED' || project.status === 'CANCELLED') {
      throw new BusinessError(`Project is ${project.status} — work orders need an active project`)
    }

    let lines: WoLineInput[] = input.lines ?? []
    let bomId: string | null = null

    if (input.bomId) {
      const bom = await tx.bom.findUnique({ where: { id: input.bomId }, include: { items: true } })
      if (!bom) throw new BusinessError('BOM not found', 404)
      if (bom.projectId !== project.id) throw new BusinessError('BOM belongs to a different project', 400)
      if (bom.status !== 'APPROVED') throw new BusinessError('Only APPROVED BOMs can generate work orders')
      // The current BOM has one fixed output/material quantity (there is no
      // production-batch multiplier yet). A second live WO from the same BOM
      // would silently duplicate material demand and is almost always a
      // double-click/user error. Completed/cancelled history does not block a
      // later repeat order.
      const duplicate = await tx.workOrder.findFirst({
        where: { bomId: bom.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        select: { woNo: true },
      })
      if (duplicate) {
        throw new BusinessError(
          `${duplicate.woNo} is already active for ${bom.bomNo} — use that work order instead of duplicating demand`,
          409
        )
      }
      bomId = bom.id
      // WO quantity = BOM net + wastage allowance (the fabrication gross-up).
      lines = bom.items.map((bi) => ({
        itemId: bi.itemId,
        description: bom.productName,
        plannedQty: r2(bi.qty * (1 + bi.wastagePct / 100)),
        uom: bi.uom,
        bomItemId: bi.id,
      }))
    }

    if (!lines.length) throw new BusinessError('Work order needs lines (pick a BOM or add lines manually)')

    const items = await tx.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) } } })
    const itemMap = new Map(items.map((i) => [i.id, i]))
    for (const l of lines) {
      const it = itemMap.get(l.itemId)
      if (!it) throw new BusinessError(`Item ${l.itemId} not found`, 404)
      if (!(l.plannedQty > 0)) throw new BusinessError(`Planned quantity must be positive for "${it.name}"`)
    }

    const date = iso(input.date)
    const startDate = input.startDate ? iso(input.startDate) : null
    const endDate = input.endDate ? iso(input.endDate) : null
    if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
      throw new BusinessError('Planned end date cannot be before the start date')
    }
    const woNo = await nextDocNo(tx, 'WO', date)
    const wo = await tx.workOrder.create({
      data: {
        woNo,
        projectId: project.id,
        bomId,
        date,
        startDate,
        endDate,
        priority: input.priority ?? 'NORMAL',
        notes: input.notes ?? null,
        lines: {
          create: lines.map((l) => ({
            // Nested writes need relation syntax for the optional BOM link
            ...(l.bomItemId ? { bomItem: { connect: { id: l.bomItemId } } } : {}),
            description: l.description ?? null,
            plannedQty: l.plannedQty,
            uom: l.uom,
            item: { connect: { id: l.itemId } },
          })),
        },
      },
      include: { lines: true },
    })

    // First work order kicks a PENDING project into RUNNING (the plan started).
    if (project.status === 'PENDING') {
      await tx.project.update({ where: { id: project.id }, data: { status: 'RUNNING' } })
    }
    return wo
  })
}

export async function updateWorkOrder(id: string, input: Partial<WorkOrderInput>) {
  return db.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id } })
    if (!wo) throw new BusinessError('Work order not found', 404)
    if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') {
      throw new BusinessError(`Work order is ${wo.status} — schedule can no longer change`)
    }
    const data: Prisma.WorkOrderUpdateInput = {}
    if (input.startDate !== undefined) data.startDate = input.startDate ? iso(input.startDate) : null
    if (input.endDate !== undefined) data.endDate = input.endDate ? iso(input.endDate) : null
    const start = (data.startDate as Date | null | undefined) ?? wo.startDate
    const end = (data.endDate as Date | null | undefined) ?? wo.endDate
    if (start && end && end.getTime() < start.getTime()) {
      throw new BusinessError('Planned end date cannot be before the start date')
    }
    if (input.priority !== undefined) data.priority = input.priority
    if (input.notes !== undefined) data.notes = input.notes
    return tx.workOrder.update({ where: { id }, data })
  })
}

/** WO completes only when every non-cancelled task is COMPLETED. */
export async function completeWorkOrder(id: string) {
  return db.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id }, include: { tasks: { select: { status: true, materialCost: true, labourCost: true } }, productionReceipts: { where: { status: 'POSTED' }, select: { acceptedQty: true, actualCost: true } } } })
    if (!wo) throw new BusinessError('Work order not found', 404)
    if (wo.status !== 'OPEN' && wo.status !== 'IN_PROGRESS') {
      throw new BusinessError(`Work order is ${wo.status}`)
    }
    const active = wo.tasks.filter((t) => t.status !== 'CANCELLED')
    if (active.length === 0) {
      throw new BusinessError('A work order cannot be completed without at least one completed production task')
    }
    const open = active.filter((t) => t.status !== 'COMPLETED')
    if (open.length > 0) {
      throw new BusinessError(`${open.length} task(s) still pending on this work order — complete them first`)
    }
    if (wo.productionReceipts.length === 0 || wo.productionReceipts.reduce((sum, receipt) => sum + receipt.acceptedQty, 0) <= EPS) {
      throw new BusinessError('Receive QC-accepted finished goods before closing this work order')
    }
    const actualCost = r2(active.reduce((sum, task) => sum + task.materialCost + task.labourCost, 0))
    const settledCost = r2(wo.productionReceipts.reduce((sum, receipt) => sum + receipt.actualCost, 0))
    if (Math.abs(actualCost - settledCost) > 0.01) {
      throw new BusinessError(`WIP is not fully settled: actual cost ${actualCost}, settled ${settledCost}`)
    }
    return tx.workOrder.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } })
  })
}

export async function cancelWorkOrder(id: string) {
  return db.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id }, include: { tasks: { select: { status: true } } } })
    if (!wo) throw new BusinessError('Work order not found', 404)
    if (wo.status !== 'OPEN' && wo.status !== 'IN_PROGRESS') throw new BusinessError(`Work order is ${wo.status}`)
    if (wo.tasks.some((t) => t.status === 'COMPLETED')) {
      throw new BusinessError('Tasks were already completed on this work order — it cannot be cancelled', 409)
    }
    // No COMPLETED tasks → no stock ledger rows → safe cascade cancel.
    await tx.productionTask.updateMany({
      where: { workOrderId: id, status: { in: [...TASK_ACTIVE] } },
      data: { status: 'CANCELLED' },
    })
    return tx.workOrder.update({ where: { id }, data: { status: 'CANCELLED' } })
  })
}

// ---------- production tasks (job cards) ----------

export interface TaskInput {
  workOrderId: string
  operation: string
  seq?: number
  employeeId?: string | null
  machineNo?: string | null
  plannedQty: number
  dueDate?: string | Date | null
  notes?: string | null
}

export const TASK_LIST_LIMIT = 500
export async function listTasks(filters?: { status?: string; workOrderId?: string; employeeId?: string; projectId?: string; limit?: number }) {
  const where: Prisma.ProductionTaskWhereInput = {}
  if (filters?.status === 'active') where.status = { in: [...TASK_ACTIVE] }
  else if (filters?.status) where.status = filters.status
  if (filters?.workOrderId) where.workOrderId = filters.workOrderId
  if (filters?.employeeId) where.employeeId = filters.employeeId
  if (filters?.projectId) where.workOrder = { projectId: filters.projectId }
  return db.productionTask.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    // Newest first, bounded: full history is reached by filtering (status / WO).
    take: Math.min(1000, Math.max(1, filters?.limit ?? TASK_LIST_LIMIT)),
    include: {
      employee: { select: { id: true, code: true, name: true, machineNo: true, shift: true } },
      materialItem: { select: { id: true, code: true, name: true, uom: true } },
      workOrder: {
        select: {
          id: true,
          woNo: true,
          status: true,
          priority: true,
          projectId: true,
          project: { select: { id: true, projectNo: true, name: true, status: true } },
        },
      },
    },
  })
}

export async function createTask(input: TaskInput) {
  return db.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({ where: { id: input.workOrderId } })
    if (!wo) throw new BusinessError('Work order not found', 404)
    if (wo.status !== 'OPEN' && wo.status !== 'IN_PROGRESS') {
      throw new BusinessError(`Work order is ${wo.status} — tasks need an active work order`)
    }
    if (!OPERATION_LABEL[input.operation]) throw new BusinessError(`Unknown operation "${input.operation}"`)
    if (!(input.plannedQty > 0)) throw new BusinessError('Planned quantity must be positive')

    let employeeId: string | null = null
    let machineNo = input.machineNo ?? null
    let labourRate = 0
    if (input.employeeId) {
      const emp = await tx.employee.findUnique({ where: { id: input.employeeId } })
      if (!emp) throw new BusinessError('Employee not found', 404)
      if (!emp.active) throw new BusinessError(`Employee "${emp.name}" is inactive`)
      employeeId = emp.id
      machineNo = machineNo ?? emp.machineNo
      labourRate = emp.hourlyRate
    }

    const taskNo = await nextDocNo(tx, 'TASK', new Date())
    const task = await tx.productionTask.create({
      data: {
        taskNo,
        workOrderId: wo.id,
        seq: input.seq ?? 0,
        operation: input.operation,
        employeeId,
        machineNo,
        labourRate,
        plannedQty: input.plannedQty,
        dueDate: input.dueDate ? iso(input.dueDate) : null,
        notes: input.notes ?? null,
        status: employeeId ? 'ASSIGNED' : 'PENDING',
      },
    })
    if (wo.status === 'OPEN') {
      await tx.workOrder.update({ where: { id: wo.id }, data: { status: 'IN_PROGRESS' } })
    }
    return task
  })
}

/** Task assigning (and re-assigning): worker + machine + due date. */
export async function assignTask(
  id: string,
  input: { employeeId: string; machineNo?: string | null; dueDate?: string | Date | null }
) {
  return db.$transaction(async (tx) => {
    const task = await tx.productionTask.findUnique({ where: { id } })
    if (!task) throw new BusinessError('Task not found', 404)
    if (task.status !== 'PENDING' && task.status !== 'ASSIGNED') {
      throw new BusinessError(`Task is ${task.status} — only pending/assigned tasks can be (re)assigned`)
    }
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId } })
    if (!emp) throw new BusinessError('Employee not found', 404)
    if (!emp.active) throw new BusinessError(`Employee "${emp.name}" is inactive`)

    const machineNo = input.machineNo ?? emp.machineNo ?? task.machineNo
    return tx.productionTask.update({
      where: { id },
      data: {
        employeeId: emp.id,
        machineNo,
        labourRate: emp.hourlyRate, // snapshot the worker's rate at assignment
        dueDate: input.dueDate ? iso(input.dueDate) : task.dueDate,
        status: 'ASSIGNED',
      },
    })
  })
}

export async function startTask(id: string) {
  return db.$transaction(async (tx) => {
    const task = await tx.productionTask.findUnique({ where: { id } })
    if (!task) throw new BusinessError('Task not found', 404)
    if (task.status === 'PENDING') throw new BusinessError('Assign the task to a worker before starting it')
    if (task.status !== 'ASSIGNED') throw new BusinessError(`Task is ${task.status}`)

    // Routing dependency: lower sequence operations must finish first. Tasks
    // with the same sequence are parallel and may run together; cancelled
    // predecessors do not block the route.
    const predecessor = await tx.productionTask.findFirst({
      where: {
        workOrderId: task.workOrderId,
        seq: { lt: task.seq },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      orderBy: { seq: 'asc' },
      select: { taskNo: true, seq: true, operation: true, status: true },
    })
    if (predecessor) {
      throw new BusinessError(
        `Complete predecessor ${predecessor.taskNo} (sequence ${predecessor.seq}, ${OPERATION_LABEL[predecessor.operation] ?? predecessor.operation}) before starting this task`,
        409
      )
    }
    return tx.productionTask.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    })
  })
}

export interface CompleteTaskInput {
  actualQty: number
  rejectionQty?: number
  hours?: number
  labourRate?: number
  materialItemId?: string | null
  materialQty?: number
  notes?: string | null
  completedAt?: string | Date
}

/**
 * Completing a task is the ONE place manufacturing touches the ledgers:
 * material consumption writes an append-only MFG_ISSUE row to the stock
 * ledger (availability-guarded, valued at moving average) inside the SAME
 * transaction as the task update. Completed tasks are final.
 */
export async function completeTask(id: string, input: CompleteTaskInput) {
  return db.$transaction(async (tx) => {
    const task = await tx.productionTask.findUnique({ where: { id }, include: { materialItem: true } })
    if (!task) throw new BusinessError('Task not found', 404)
    if (task.status !== 'IN_PROGRESS') {
      if (task.status === 'ASSIGNED') {
        throw new BusinessError('Start the task before recording production completion')
      }
      throw new BusinessError(`Task is ${task.status}`)
    }
    // Claim the row with a conditional UPDATE inside this transaction: on a
    // multi-user DB two simultaneous "complete" requests cannot both read
    // IN_PROGRESS and then each write a MFG_ISSUE stock row (double material
    // consumption). The loser sees count 0 after the winner commits.
    const claimed = await tx.productionTask.updateMany({
      where: { id, status: 'IN_PROGRESS' },
      data: { status: 'IN_PROGRESS' },
    })
    if (claimed.count !== 1) {
      throw new BusinessError('This task was completed or cancelled by another user — refresh and try again', 409)
    }
    if (!(input.actualQty > 0)) throw new BusinessError('Actual quantity must be positive')
    const rejectionQty = input.rejectionQty ?? 0
    if (rejectionQty < 0) throw new BusinessError('Rejection quantity cannot be negative')
    if (task.plannedQty > 0 && input.actualQty + rejectionQty > task.plannedQty * TASK_TOLERANCE + EPS) {
      throw new BusinessError(
        `Over-production: actual ${input.actualQty} + rejection ${rejectionQty} exceeds planned ${task.plannedQty} (10% tolerance)`
      )
    }
    const hours = input.hours ?? 0
    if (hours < 0 || hours > 24 * 30) throw new BusinessError('Production hours look wrong')
    const labourRate = input.labourRate && input.labourRate > 0 ? input.labourRate : task.labourRate
    const labourCost = r2(hours * labourRate)
    const completedAt = iso(input.completedAt)

    // ---- material consumption → stock ledger (atomic with this task) ----
    let materialItemId: string | null = task.materialItemId
    let materialQty = task.materialQty
    let materialCost = task.materialCost
    if (input.materialItemId || (input.materialQty && input.materialQty > 0)) {
      const itemId = input.materialItemId ?? task.materialItemId
      const qty = input.materialQty ?? 0
      if (!itemId) throw new BusinessError('Pick the material item being consumed')
      if (!(qty > 0)) throw new BusinessError('Material consumption quantity must be positive')
      const mat = await tx.item.findUnique({ where: { id: itemId } })
      if (!mat) throw new BusinessError('Material item not found', 404)
      if (!mat.isStockItem) throw new BusinessError(`"${mat.name}" is not a stock item`)
      const warehouseId = await defaultWarehouseId(tx)
      const avail = await stockAvail(tx, itemId, warehouseId)
      if (avail + EPS < qty) {
        throw new BusinessError(
          `Insufficient stock for "${mat.name}": available ${avail} ${mat.uom}, consumption ${qty} ${mat.uom} — receive material first (GRN/Purchase)`
        )
      }
      await consumeLotsFefoTx(tx, { itemId, warehouseId, qty, voucherType: 'MFG_ISSUE', voucherNo: task.taskNo, referenceId: task.id })
      const rate = await avgCost(tx, itemId, warehouseId)
      materialItemId = itemId
      materialQty = qty
      materialCost = r2(qty * rate)
      await tx.stockLedger.create({
        data: {
          postingDate: completedAt,
          voucherType: 'MFG_ISSUE',
          voucherNo: task.taskNo,
          itemId,
          warehouseId,
          qtyIn: 0,
          qtyOut: qty,
          rate,
          remarks: `Consumed on ${task.taskNo} (${OPERATION_LABEL[task.operation] ?? task.operation})`,
        },
      })
    }

    const wipCost = r2(materialCost + labourCost)
    if (wipCost > EPS) {
      await postGl(tx, { date: completedAt, voucherType: 'MFG_TASK', voucherNo: task.taskNo }, [
        { account: 'WIP', debit: wipCost, remarks: `Material/labour absorbed on ${task.taskNo}` },
        { account: 'STKV', credit: materialCost, remarks: materialCost > EPS ? `Material issued on ${task.taskNo}` : null },
        { account: 'LABP', credit: labourCost, remarks: labourCost > EPS ? `Labour absorbed on ${task.taskNo}` : null },
      ])
    }

    return tx.productionTask.update({
      where: { id },
      data: {
        actualQty: input.actualQty,
        rejectionQty,
        hours,
        labourRate,
        labourCost,
        materialItemId,
        materialQty,
        materialCost,
        status: 'COMPLETED',
        startedAt: task.startedAt ?? completedAt,
        completedAt,
        notes: input.notes ?? task.notes,
      },
    })
  })
}

export async function cancelTask(id: string) {
  return db.$transaction(async (tx) => {
    const task = await tx.productionTask.findUnique({ where: { id } })
    if (!task) throw new BusinessError('Task not found', 404)
    if (task.status === 'COMPLETED') {
      throw new BusinessError('Completed tasks are final (material was consumed) — they cannot be cancelled', 409)
    }
    if (task.status === 'CANCELLED') throw new BusinessError('Task is already cancelled')
    return tx.productionTask.update({ where: { id }, data: { status: 'CANCELLED' } })
  })
}

// ---------- task-wise pending report ----------

export async function pendingTasksReport() {
  const tasks = await db.productionTask.findMany({
    where: { status: { in: [...TASK_ACTIVE] } },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    include: {
      employee: { select: { id: true, code: true, name: true, shift: true } },
      workOrder: {
        select: {
          id: true,
          woNo: true,
          priority: true,
          status: true,
          endDate: true,
          project: { select: { id: true, projectNo: true, name: true, status: true } },
        },
      },
    },
  })
  // Date-only comparison: due dates are date-only values stored at UTC
  // midnight, so a task due TODAY must not flag overdue at 00:00 UTC (05:30
  // IST) — it becomes overdue only from the NEXT day onwards.
  const todayUtc = new Date().toISOString().slice(0, 10)
  const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
  const rows = tasks.map((t) => ({
    ...t,
    overdue: dayOf(t.dueDate) !== null && dayOf(t.dueDate)! < todayUtc,
    woOverdue: dayOf(t.workOrder.endDate) !== null && dayOf(t.workOrder.endDate)! < todayUtc,
  }))
  return {
    rows,
    summary: {
      total: rows.length,
      overdue: rows.filter((r) => r.overdue).length,
      unassigned: rows.filter((r) => !r.employeeId).length,
      inProgress: rows.filter((r) => r.status === 'IN_PROGRESS').length,
    },
  }
}

// ---------- consolidated material plan ----------

/**
 * Net material demand for active company-owned production.
 *
 * This intentionally excludes JOBWORK_IN stock. Customer jobwork and own
 * manufacturing are adjacent shop-floor workflows, not duplicate inventory:
 * customer-owned material may never satisfy a project WO shortage.
 */
export async function materialPlanReport() {
  const workOrders = await db.workOrder.findMany({
    where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
    orderBy: [{ priority: 'desc' }, { endDate: 'asc' }],
    include: {
      project: { select: { projectNo: true, name: true } },
      lines: { include: { item: { select: { id: true, code: true, name: true, uom: true, reorderLevel: true } } } },
      tasks: {
        where: { status: 'COMPLETED', materialItemId: { not: null } },
        select: { materialItemId: true, materialQty: true },
      },
    },
  })

  const demand = new Map<string, {
    item: { id: string; code: string; name: string; uom: string; reorderLevel: number }
    requiredQty: number
    issuedQty: number
    workOrders: { id: string; woNo: string; projectNo: string; projectName: string; dueDate: Date | null; requiredQty: number }[]
  }>()

  for (const wo of workOrders) {
    const issuedByItem = new Map<string, number>()
    for (const task of wo.tasks) {
      if (task.materialItemId) issuedByItem.set(task.materialItemId, (issuedByItem.get(task.materialItemId) ?? 0) + task.materialQty)
    }
    // A BOM can legitimately contain the same catalog item on several lines
    // (different drawing/grade notes). Aggregate those lines per WO first so
    // completed task issues are subtracted exactly once, not once per line.
    const plannedByItem = new Map<string, { item: typeof wo.lines[number]['item']; qty: number }>()
    for (const line of wo.lines) {
      const planned = plannedByItem.get(line.itemId) ?? { item: line.item, qty: 0 }
      planned.qty = r2(planned.qty + line.plannedQty)
      plannedByItem.set(line.itemId, planned)
    }
    for (const [itemId, planned] of plannedByItem) {
      const row: {
        item: { id: string; code: string; name: string; uom: string; reorderLevel: number }
        requiredQty: number
        issuedQty: number
        workOrders: { id: string; woNo: string; projectNo: string; projectName: string; dueDate: Date | null; requiredQty: number }[]
      } = demand.get(itemId) ?? { item: planned.item, requiredQty: 0, issuedQty: 0, workOrders: [] }
      row.requiredQty = r2(row.requiredQty + planned.qty)
      row.issuedQty = r2(row.issuedQty + (issuedByItem.get(itemId) ?? 0))
      row.workOrders.push({
        id: wo.id,
        woNo: wo.woNo,
        projectNo: wo.project.projectNo,
        projectName: wo.project.name,
        dueDate: wo.endDate,
        requiredQty: planned.qty,
      })
      demand.set(itemId, row)
    }
  }

  const tx = db as unknown as Tx
  const rows = await Promise.all([...demand.values()].map(async (row) => {
    const availableQty = await stockAvail(tx, row.item.id)
    const remainingQty = r2(Math.max(0, row.requiredQty - row.issuedQty))
    const shortageQty = r2(Math.max(0, remainingQty - availableQty))
    return { ...row, remainingQty, availableQty, shortageQty }
  }))
  rows.sort((a, b) => (b.shortageQty - a.shortageQty) || a.item.code.localeCompare(b.item.code))

  const customerMaterial = await db.jobworkInwardItem.aggregate({
    where: { inward: { status: { in: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] } } },
    _sum: { qty: true, processedQty: true },
  })
  const customerReceived = r2(customerMaterial._sum.qty ?? 0)
  const customerProcessed = r2(customerMaterial._sum.processedQty ?? 0)

  return {
    rows,
    summary: {
      activeWorkOrders: workOrders.length,
      materialItems: rows.length,
      shortageItems: rows.filter((r) => r.shortageQty > EPS).length,
      totalShortageQty: r2(rows.reduce((sum, r) => sum + r.shortageQty, 0)),
      customerMaterialQty: r2(Math.max(0, customerReceived - customerProcessed)),
    },
    ownershipRule: 'Company production demand uses company-owned stock only; customer JOBWORK_IN material is reported separately and never netted against shortages.',
  }
}

/** Module dashboard stats (KPIs for the manufacturing tab). */
export async function manufacturingStats() {
  const [projects, taskAgg, woAgg] = await Promise.all([
    db.project.groupBy({ by: ['status'], _count: true }),
    db.productionTask.groupBy({ by: ['status'], _count: true }),
    db.workOrder.groupBy({ by: ['status'], _count: true }),
  ])
  const count = (rows: { status: string; _count: number }[], s: string) =>
    rows.find((r) => r.status === s)?._count ?? 0
  const [pendingProjects, runningProjects, completedProjects] = [
    count(projects, 'PENDING'),
    count(projects, 'RUNNING'),
    count(projects, 'COMPLETED'),
  ]
  const [pendingTasks, assignedTasks, inProgressTasks] = [
    count(taskAgg, 'PENDING'),
    count(taskAgg, 'ASSIGNED'),
    count(taskAgg, 'IN_PROGRESS'),
  ]
  const [openWos, inProgressWos, completedWos] = [
    count(woAgg, 'OPEN'),
    count(woAgg, 'IN_PROGRESS'),
    count(woAgg, 'COMPLETED'),
  ]
  return {
    projects: { total: pendingProjects + runningProjects + completedProjects, pending: pendingProjects, running: runningProjects, completed: completedProjects },
    workOrders: { open: openWos, inProgress: inProgressWos, completed: completedWos },
    tasks: { pending: pendingTasks, assigned: assignedTasks, inProgress: inProgressTasks },
  }
}
