/**
 * ForgeERP — Material Requirements Planning (MRP).
 *
 * What this module does, in order:
 *  1. independent demand: open quantity on APPROVED / PART_DISPATCHED sales
 *     orders, dated by the order's delivery date;
 *  2. dependent demand: component lines of released (OPEN / IN_PROGRESS) work
 *     orders, net of material already issued to completed tasks;
 *  3. explosion: every requirement is pushed through the effective (APPROVED,
 *     in-date, highest-revision) BOM of its item, including wastage, and
 *     recursively through sub-assemblies (cycle-guarded);
 *  4. netting: own on-hand stock (JOBWORK_IN excluded), open work-order output,
 *     approved unreceived POs and approved un-ordered requisitions, consumed
 *     earliest-need-first and only when the supply is dated on or before the
 *     requirement;
 *  5. suggestion: MAKE (a BOM exists) or BUY (purchase), with the net quantity
 *     and need-by date.
 *
 * Invariants:
 *  - a run is a SNAPSHOT: lines are persisted, never silently recomputed;
 *  - nothing posts until a user explicitly converts selected lines into
 *    documents (`createDocumentsFromMrp`), and the only things that can be
 *    created are a DRAFT purchase requisition and OPEN work orders — neither
 *    moves stock or posts a ledger entry by itself;
 *  - reservations/ATP are NOT yet modelled: netting reduces planning supply
 *    but does not commit stock to a sales order (see docs/MRP_AND_BOM_REVISIONS.md).
 */
import { Prisma } from '@prisma/client'
import { db } from './db'
import { r2, fyCode, EPS } from './erp'
import { BusinessError } from './accounting'
import { tenantCompany } from './tenant'
import { effectiveBomMap, createWorkOrderTx, type EffectiveBom } from './manufacturing'
import { createPurchaseRequisitionTx } from './procurement'

type Tx = Prisma.TransactionClient
export { BusinessError }

/** Deepest BOM level the explosion follows (protects against pathological data). */
const MAX_LEVEL = 6
/** Hard stop for the work queue — a BOM cycle that slips past the path guard. */
const MAX_EVENTS = 20_000
/** How many pegging notes are kept per line. */
const MAX_PEGGING = 6
const DAY_MS = 86_400_000

const dayStart = (d: Date | string): Date => {
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) throw new BusinessError('Invalid date — use YYYY-MM-DD', 400)
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
}
const dayKey = (d: Date): string => d.toISOString().slice(0, 10)

export const MRP_DEFAULT_HORIZON = 30

export interface MrpItemLite {
  id: string
  code: string
  name: string
  uom: string
  isStockItem: boolean
  isService: boolean
}

interface SupplyEntry {
  qty: number
  used: number
  date: Date
  docNo: string
}

interface SupplyState {
  onHand: number
  onHandUsed: number
  inbound: SupplyEntry[] // approved PO / approved PR, dated
  workOrders: SupplyEntry[] // open WO output of this item, dated
}

export interface MrpLineDraft {
  itemId: string
  level: number
  needBy: Date
  grossQty: number
  onHandQty: number
  incomingQty: number
  woSupplyQty: number
  netQty: number
  suggestion: 'BUY' | 'MAKE' | 'NONE'
  bomNo: string | null
  pegging: string
}

export interface MrpPlan {
  asOf: Date
  horizonDays: number
  lines: MrpLineDraft[]
  items: Record<string, MrpItemLite>
  warnings: string[]
  salesOrderCount: number
  workOrderCount: number
  requirementCount: number
  suggestionCount: number
  shortageItems: number
}

interface DemandEvent {
  itemId: string
  qty: number
  needBy: Date
  level: number
  pegging: string
  path: string[]
}

interface Aggregate {
  itemId: string
  level: number
  needBy: Date
  grossQty: number
  onHandQty: number
  incomingQty: number
  woSupplyQty: number
  netQty: number
  suggestion: 'BUY' | 'MAKE' | 'NONE'
  bomNo: string | null
  pegging: string[]
}

const addPeg = (list: string[], note: string) => {
  if (list.length < MAX_PEGGING && !list.includes(note)) list.push(note)
}

/**
 * Pure planning calculation over an existing transaction/client.
 * Returns the exploded, netted plan; writes nothing.
 */
export async function computeMrp(
  tx: Tx,
  input: { asOf?: Date | string; horizonDays?: number } = {}
): Promise<MrpPlan> {
  const today = dayStart(new Date())
  const asOf = input.asOf ? dayStart(input.asOf) : today
  const rawHorizon = input.horizonDays ?? MRP_DEFAULT_HORIZON
  if (!Number.isFinite(rawHorizon) || rawHorizon < 1 || rawHorizon > 365) {
    throw new BusinessError('Planning horizon must be between 1 and 365 days')
  }
  const horizonDays = Math.trunc(rawHorizon)
  const horizonEnd = new Date(asOf.getTime() + horizonDays * DAY_MS)

  // ---- demand documents ---------------------------------------------------
  const salesOrders = await tx.salesOrder.findMany({
    where: { status: { in: ['APPROVED', 'PART_DISPATCHED'] } },
    orderBy: [{ deliveryDate: 'asc' }, { date: 'asc' }],
    include: {
      party: { select: { name: true } },
      lines: { include: { item: true } },
    },
  })

  const workOrders = await tx.workOrder.findMany({
    where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
    orderBy: [{ endDate: 'asc' }, { date: 'asc' }],
    include: {
      bom: { select: { id: true, bomNo: true, revision: true, itemId: true } },
      outputItem: { select: { id: true, code: true, name: true, uom: true } },
      lines: { include: { item: true } },
      tasks: { where: { status: 'COMPLETED', materialItemId: { not: null } }, select: { materialItemId: true, materialQty: true } },
    },
  })

  // ---- supply -------------------------------------------------------------
  const stockRows = await tx.stockLedger.groupBy({
    by: ['itemId'],
    where: { isCancelled: false, voucherType: { not: 'JOBWORK_IN' } },
    _sum: { qtyIn: true, qtyOut: true },
  })
  const onHand = new Map<string, number>()
  for (const row of stockRows) {
    const qty = r2((row._sum.qtyIn ?? 0) - (row._sum.qtyOut ?? 0))
    if (qty > EPS) onHand.set(row.itemId, qty)
  }

  const poLines = await tx.purchaseOrderLine.findMany({
    where: { purchaseOrder: { status: { in: ['APPROVED', 'PART_RECEIVED'] } } },
    include: { purchaseOrder: { select: { poNo: true, expectedDate: true, date: true } } },
  })
  const prLines = await tx.purchaseRequisitionLine.findMany({
    where: { requisition: { status: 'APPROVED' } },
    include: { requisition: { select: { reqNo: true, requiredBy: true, date: true } } },
  })

  const supply = new Map<string, SupplyState>()
  const stateFor = (itemId: string): SupplyState => {
    let state = supply.get(itemId)
    if (!state) {
      state = { onHand: onHand.get(itemId) ?? 0, onHandUsed: 0, inbound: [], workOrders: [] }
      supply.set(itemId, state)
    }
    return state
  }
  for (const [itemId, qty] of onHand) stateFor(itemId).onHand = qty

  for (const line of poLines) {
    const outstanding = r2(Math.max(0, line.qty - line.receivedQty))
    if (outstanding <= EPS) continue
    stateFor(line.itemId).inbound.push({
      qty: outstanding,
      used: 0,
      date: dayStart(line.purchaseOrder.expectedDate ?? line.purchaseOrder.date),
      docNo: line.purchaseOrder.poNo,
    })
  }
  for (const line of prLines) {
    const outstanding = r2(Math.max(0, line.qty - line.orderedQty))
    if (outstanding <= EPS) continue
    stateFor(line.itemId).inbound.push({
      qty: outstanding,
      used: 0,
      date: dayStart(line.requisition.requiredBy ?? line.requisition.date),
      docNo: line.requisition.reqNo,
    })
  }

  const warnings: string[] = []
  for (const wo of workOrders) {
    const outputItemId = wo.outputItemId ?? wo.bom?.itemId ?? null
    const qty = r2(wo.outputQty ?? 1)
    if (!outputItemId) {
      warnings.push(`${wo.woNo} has no output item, so its planned output cannot be netted as supply`)
      continue
    }
    if (qty <= EPS) continue
    stateFor(outputItemId).workOrders.push({
      qty,
      used: 0,
      date: dayStart(wo.endDate ?? wo.startDate ?? wo.date),
      docNo: wo.woNo,
    })
  }
  for (const state of supply.values()) {
    state.inbound.sort((a, b) => a.date.getTime() - b.date.getTime())
    state.workOrders.sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  // ---- engineering data ---------------------------------------------------
  const boms = await effectiveBomMap(tx, asOf)
  const unlinked = await tx.bom.findMany({
    where: { status: 'APPROVED', itemId: null },
    select: { bomNo: true, productName: true },
  })
  for (const bom of unlinked) {
    warnings.push(`${bom.bomNo} (${bom.productName}) has no linked output item — MRP cannot explode it`)
  }

  // ---- independent demand -------------------------------------------------
  const events: DemandEvent[] = []
  let salesOrderCount = 0
  let outsideHorizon = 0
  for (const order of salesOrders) {
    let counted = false
    for (const line of order.lines) {
      if (line.item.isService) continue
      const open = r2(line.qty - line.dispatchedQty)
      if (open <= EPS) continue
      const rawNeedBy = dayStart(order.deliveryDate ?? order.date)
      if (rawNeedBy.getTime() > horizonEnd.getTime()) {
        outsideHorizon++
        continue
      }
      const needBy = rawNeedBy.getTime() < asOf.getTime() ? asOf : rawNeedBy
      events.push({
        itemId: line.itemId,
        qty: open,
        needBy,
        level: 0,
        pegging: `SO ${order.orderNo} · ${order.party.name}`,
        path: [],
      })
      counted = true
    }
    if (counted) salesOrderCount++
  }
  if (outsideHorizon > 0) {
    warnings.push(`${outsideHorizon} sales-order line(s) are due after ${dayKey(horizonEnd)} and were left out of this horizon`)
  }

  // ---- released work orders: dependent demand (net of issued material) ----
  let workOrderCount = 0
  for (const wo of workOrders) {
    const issued = new Map<string, number>()
    for (const task of wo.tasks) {
      if (!task.materialItemId) continue
      issued.set(task.materialItemId, (issued.get(task.materialItemId) ?? 0) + task.materialQty)
    }
    // Aggregate BOM lines per item first so an issue is deducted exactly once.
    const planned = new Map<string, { qty: number; name: string }>()
    for (const line of wo.lines) {
      const row = planned.get(line.itemId) ?? { qty: 0, name: line.item.name }
      row.qty = r2(row.qty + line.plannedQty)
      planned.set(line.itemId, row)
    }
    let counted = false
    for (const [itemId, row] of planned) {
      const remaining = r2(row.qty - (issued.get(itemId) ?? 0))
      if (remaining <= EPS) continue
      events.push({
        itemId,
        qty: remaining,
        needBy: dayStart(wo.endDate ?? wo.startDate ?? wo.date),
        level: 1,
        pegging: `WO ${wo.woNo} (released)`,
        path: [],
      })
      counted = true
    }
    if (counted) workOrderCount++
  }

  // ---- explosion + netting ------------------------------------------------
  const itemIds = new Set<string>(events.map((e) => e.itemId))
  for (const bom of boms.values()) {
    for (const line of bom.lines) itemIds.add(line.itemId)
    itemIds.add(bom.itemId)
  }
  const itemRows = await tx.item.findMany({
    where: { id: { in: [...itemIds] } },
    select: { id: true, code: true, name: true, uom: true, isStockItem: true, isService: true },
  })
  const items: Record<string, MrpItemLite> = Object.fromEntries(itemRows.map((i) => [i.id, i]))

  const aggregates = new Map<string, Aggregate>()
  const cycleWarned = new Set<string>()
  const queue = events.sort(byEventOrder)
  let processed = 0

  while (queue.length) {
    if (++processed > MAX_EVENTS) {
      throw new BusinessError('MRP explosion exceeded the planning limit — check the BOMs for a cycle', 409)
    }
    const event = queue.shift()!
    if (event.qty <= EPS) continue
    const item = items[event.itemId]
    if (!item) continue

    const key = `${event.itemId}|${dayKey(event.needBy)}`
    const agg = aggregates.get(key) ?? {
      itemId: event.itemId,
      level: event.level,
      needBy: event.needBy,
      grossQty: 0,
      onHandQty: 0,
      incomingQty: 0,
      woSupplyQty: 0,
      netQty: 0,
      suggestion: 'NONE',
      bomNo: null,
      pegging: [],
    }
    agg.level = Math.min(agg.level, event.level)
    agg.grossQty = r2(agg.grossQty + event.qty)
    addPeg(agg.pegging, event.pegging)

    const state = stateFor(event.itemId)
    let remaining = event.qty

    // 1) own stock (always available, never customer-owned JOBWORK_IN)
    const fromStock = Math.min(remaining, Math.max(0, state.onHand - state.onHandUsed))
    state.onHandUsed = r2(state.onHandUsed + fromStock)
    agg.onHandQty = r2(agg.onHandQty + fromStock)
    remaining = r2(remaining - fromStock)

    // 2) work orders already producing this item (dated)
    if (remaining > EPS) {
      for (const entry of state.workOrders) {
        if (remaining <= EPS) break
        if (entry.date.getTime() > event.needBy.getTime()) continue
        const take = Math.min(remaining, Math.max(0, entry.qty - entry.used))
        if (take <= EPS) continue
        entry.used = r2(entry.used + take)
        agg.woSupplyQty = r2(agg.woSupplyQty + take)
        remaining = r2(remaining - take)
      }
    }

    // 3) approved inbound purchases / requisitions (dated)
    if (remaining > EPS) {
      for (const entry of state.inbound) {
        if (remaining <= EPS) break
        if (entry.date.getTime() > event.needBy.getTime()) continue
        const take = Math.min(remaining, Math.max(0, entry.qty - entry.used))
        if (take <= EPS) continue
        entry.used = r2(entry.used + take)
        agg.incomingQty = r2(agg.incomingQty + take)
        remaining = r2(remaining - take)
      }
    }

    aggregates.set(key, agg)
    if (remaining <= EPS) continue

    const bom: EffectiveBom | undefined = boms.get(event.itemId)
    const isMakeable = !!bom && !item.isService && event.level < MAX_LEVEL
    const cyclic = !!bom && event.path.includes(event.itemId)

    if (cyclic) {
      // A self-referencing BOM is a data error: show the unfilled quantity so a
      // planner sees it, but never fabricate a buy suggestion for it.
      agg.suggestion = 'NONE'
      agg.netQty = r2(agg.netQty + remaining)
      if (!cycleWarned.has(event.itemId)) {
        cycleWarned.add(event.itemId)
        warnings.push(`BOM cycle detected around ${item.name} (${item.code}) — explosion stopped at that branch`)
      }
    } else if (isMakeable) {
      agg.suggestion = 'MAKE'
      agg.bomNo = bom!.bomNo
      const nextPath = [...event.path, event.itemId]
      for (const line of bom!.lines) {
        queue.push({
          itemId: line.itemId,
          qty: r2(remaining * line.grossQty),
          needBy: event.needBy,
          level: agg.level + 1,
          // keep the root (driving SO / WO) so a component pegs back to its order
          pegging: `${event.pegging} → ${bom!.bomNo} rev ${bom!.revision} × ${event.qty} ${item.uom}`,
          path: nextPath,
        })
      }
    } else {
      agg.suggestion = item.isService ? 'NONE' : 'BUY'
      agg.bomNo = null
    }
    agg.netQty = r2(agg.netQty + remaining)
    queue.sort(byEventOrder)
  }

  const lines: MrpLineDraft[] = [...aggregates.values()]
    .filter((a) => a.grossQty > EPS)
    .sort((a, b) => a.needBy.getTime() - b.needBy.getTime() || a.level - b.level || (items[a.itemId]?.code ?? '').localeCompare(items[b.itemId]?.code ?? ''))
    .map((a) => ({
      itemId: a.itemId,
      level: a.level,
      needBy: a.needBy,
      grossQty: a.grossQty,
      onHandQty: a.onHandQty,
      incomingQty: a.incomingQty,
      woSupplyQty: a.woSupplyQty,
      netQty: a.netQty,
      suggestion: a.suggestion,
      bomNo: a.bomNo,
      pegging: JSON.stringify(a.pegging),
    }))

  const shortage = new Set(lines.filter((l) => l.netQty > EPS).map((l) => l.itemId))
  return {
    asOf,
    horizonDays,
    lines,
    items,
    warnings,
    salesOrderCount,
    workOrderCount,
    requirementCount: lines.length,
    suggestionCount: lines.filter((l) => l.netQty > EPS).length,
    shortageItems: shortage.size,
  }
}

function byEventOrder(a: DemandEvent, b: DemandEvent): number {
  return a.needBy.getTime() - b.needBy.getTime() || a.level - b.level || a.itemId.localeCompare(b.itemId)
}

/** FY-aware MRP document number: MRP-2526-001 (per organisation). */
async function nextRunNo(tx: Tx, date: Date): Promise<string> {
  const company = await tenantCompany(tx)
  if (!company) throw new BusinessError('Company profile is not set up yet', 409)
  const display = `MRP-${fyCode(date)}`
  const counter = await tx.counter.upsert({
    where: { key: `${company.id}:${display}` },
    create: { key: `${company.id}:${display}`, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${display}-${String(counter.value).padStart(3, '0')}`
}

/** Persist a fresh calculation as an immutable snapshot. */
export async function createMrpRun(input: { asOf?: Date | string; horizonDays?: number; notes?: string | null; createdBy?: string }) {
  return db.$transaction(async (tx) => {
    const company = await tenantCompany(tx)
    if (!company) throw new BusinessError('Company profile is not set up yet', 409)
    // Long horizons can exceed Prisma's default 5 s interactive-transaction
    // budget on the first run of a large dataset, so give the planner room.
    const plan = await computeMrp(tx, input)
    const notes = [input.notes?.trim(), ...plan.warnings].filter(Boolean).join('\n') || null
    return tx.mrpRun.create({
      data: {
        companyId: company.id,
        runNo: await nextRunNo(tx, plan.asOf),
        asOf: plan.asOf,
        horizonDays: plan.horizonDays,
        status: 'DRAFT',
        salesOrderCount: plan.salesOrderCount,
        workOrderCount: plan.workOrderCount,
        requirementCount: plan.requirementCount,
        suggestionCount: plan.suggestionCount,
        shortageItems: plan.shortageItems,
        createdBy: input.createdBy,
        notes,
        lines: {
          createMany: {
            data: plan.lines.map((line) => ({
              itemId: line.itemId,
              level: line.level,
              needBy: line.needBy,
              grossQty: line.grossQty,
              onHandQty: line.onHandQty,
              incomingQty: line.incomingQty,
              woSupplyQty: line.woSupplyQty,
              netQty: line.netQty,
              suggestion: line.suggestion,
              bomNo: line.bomNo,
              pegging: line.pegging,
            })),
          },
        },
      },
      include: { lines: true },
    })
  }, { timeout: 120_000, maxWait: 20_000 })
}

export async function listMrpRuns(limit = 30) {
  return db.mrpRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: { _count: { select: { lines: true } } },
  })
}

export async function getMrpRun(id: string) {
  const run = await db.mrpRun.findUnique({
    where: { id },
    include: {
      lines: {
        include: { item: { select: { id: true, code: true, name: true, uom: true, isStockItem: true } } },
        orderBy: [{ needBy: 'asc' }, { level: 'asc' }],
      },
    },
  })
  if (!run) throw new BusinessError('MRP run not found', 404)
  const warnings = (run.notes ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('BOM') || line.includes('could not') || line.includes('cycle') || line.includes('horizon') || line.includes('no output item'))
  return { ...run, warnings, allowDocuments: run.status === 'DRAFT' || run.status === 'APPROVED' }
}

/**
 * Convert selected suggestions into real documents — the only posting step.
 * One DRAFT purchase requisition for every BUY line, one work order per MAKE
 * line. All-or-nothing: a single transaction, nothing created on failure.
 */
export async function createDocumentsFromMrp(
  id: string,
  input: {
    lineIds: string[]
    projectId?: string | null
    department?: string | null
    actor?: string
  }
) {
  return db.$transaction(async (tx) => {
    const run = await tx.mrpRun.findUnique({
      where: { id },
      include: { lines: { include: { item: { select: { id: true, code: true, name: true, uom: true } } } } },
    })
    if (!run) throw new BusinessError('MRP run not found', 404)
    if (run.status === 'CLOSED') throw new BusinessError('This MRP run is closed — create a fresh run', 409)
    if (!input.lineIds?.length) throw new BusinessError('Select at least one suggestion')

    const newer = await tx.mrpRun.findFirst({
      where: { createdAt: { gt: run.createdAt }, status: { not: 'CLOSED' } },
      select: { runNo: true },
    })
    if (newer) {
      throw new BusinessError(`${newer.runNo} is newer than ${run.runNo} — approve documents from the latest plan`, 409)
    }

    const wanted = new Set(input.lineIds)
    const selected = run.lines.filter((line) => wanted.has(line.id))
    if (selected.length !== wanted.size) throw new BusinessError('Some selected suggestions do not belong to this run', 400)
    for (const line of selected) {
      if (line.createdDocNo) throw new BusinessError(`${line.item.name} already produced ${line.createdDocNo}`)
      if (line.netQty <= EPS) throw new BusinessError(`${line.item.name} has no net requirement to order`)
      if (line.suggestion === 'NONE') throw new BusinessError(`${line.item.name} has no buy/make suggestion`)
    }

    const buys = selected.filter((line) => line.suggestion === 'BUY')
    const makes = selected.filter((line) => line.suggestion === 'MAKE')

    // ---- purchase requisition (DRAFT: still needs submit + approve) --------
    let requisition: Awaited<ReturnType<typeof createPurchaseRequisitionTx>> | null = null
    if (buys.length) {
      const merged = new Map<string, { itemId: string; qty: number; remarks: string[] }>()
      for (const line of buys) {
        const row = merged.get(line.itemId) ?? { itemId: line.itemId, qty: 0, remarks: [] }
        row.qty = r2(row.qty + line.netQty)
        row.remarks.push(`${dayKey(line.needBy)} · ${line.item.name}`)
        merged.set(line.itemId, row)
      }
      const requiredBy = new Date(Math.min(...buys.map((line) => line.needBy.getTime())))
      requisition = await createPurchaseRequisitionTx(tx, {
        date: run.asOf,
        requiredBy,
        department: input.department ?? 'PLANNING',
        purpose: `MRP ${run.runNo} — planned purchase`,
        createdBy: input.actor,
        lines: [...merged.values()].map((row) => ({
          itemId: row.itemId,
          qty: row.qty,
          remarks: `MRP ${run.runNo} · need by ${row.remarks[0]?.split(' · ')[0] ?? dayKey(requiredBy)}`,
        })),
      })
    }

    // ---- work orders (one per MAKE line, quantity from the plan) ----------
    const workOrders: { lineId: string; wo: Awaited<ReturnType<typeof createWorkOrderTx>> }[] = []
    if (makes.length) {
      // No project = stock production. A project BOM still runs under its own
      // project (createWorkOrderTx refuses a project BOM without one).
      const project = input.projectId ? await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true, status: true } }) : null
      if (input.projectId && !project) throw new BusinessError('Project not found', 404)
      if (project && (project.status === 'COMPLETED' || project.status === 'CANCELLED')) {
        throw new BusinessError(`Project is ${project.status} — planned work orders need an active project`, 409)
      }
      const boms = await effectiveBomMap(tx, run.asOf)
      for (const line of makes) {
        const bom = boms.get(line.itemId)
        if (!bom) throw new BusinessError(`No effective BOM for ${line.item.name} — recompute the MRP run`, 409)
        const wo = await createWorkOrderTx(tx, {
          projectId: project?.id ?? bom.projectId ?? null,
          bomId: bom.id,
          outputItemId: line.itemId,
          outputQty: line.netQty,
          date: run.asOf,
          startDate: run.asOf,
          endDate: line.needBy,
          priority: 'NORMAL',
          notes: `MRP ${run.runNo} — planned order for ${line.item.name}`,
        })
        workOrders.push({ lineId: line.id, wo })
      }
    }

    const prNo = requisition?.reqNo ?? null
    for (const line of selected) {
      const made = workOrders.find((row) => row.lineId === line.id)
      await tx.mrpLine.update({
        where: { id: line.id },
        data: made
          ? { createdDocType: 'WO', createdDocNo: made.wo.woNo }
          : { createdDocType: 'PR', createdDocNo: prNo },
      })
    }

    const updated = await tx.mrpRun.update({
      where: { id: run.id },
      data: { status: 'APPROVED', approvedBy: input.actor, approvedAt: new Date() },
    })

    return {
      run: updated,
      requisition,
      workOrders: workOrders.map((row) => row.wo),
    }
  }, { timeout: 120_000, maxWait: 20_000 })
}

/** Retire a plan (no documents are created or cancelled by closing it). */
export async function closeMrpRun(id: string, actor?: string) {
  return db.$transaction(async (tx) => {
    const run = await tx.mrpRun.findUnique({ where: { id } })
    if (!run) throw new BusinessError('MRP run not found', 404)
    if (run.status === 'CLOSED') throw new BusinessError('This MRP run is already closed')
    return tx.mrpRun.update({
      where: { id },
      data: { status: 'CLOSED', approvedBy: run.approvedBy ?? actor, approvedAt: run.approvedAt ?? new Date() },
    })
  })
}
