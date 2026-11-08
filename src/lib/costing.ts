/**
 * Manufacturing cost roll-up: standard cost of a revision vs actual cost of a
 * work order, including absorbed factory overhead and an overhead *true-up*
 * that keeps WIP and the finished-goods receipt in agreement.
 *
 * The three money buckets are deliberately separate, because they answer
 * different questions:
 *
 *   material  — what was actually issued (moving average at issue date)
 *   labour    — hours × the rate the worker was costed at
 *   overhead  — a percentage of prime cost, decided by policy not by a bill
 *
 * Only the first two are externally evidenced. Overhead is an *allocation*, so
 * it is accrued to a liability (OVHA, "overhead absorbed") that no bank account
 * ever pays; the credit is reversed (contram) when an accountant wants the
 * period to show actual spend instead. That is why the rate lives on the
 * company and not on the work order: changing it is a policy change, and past
 * postings are never rewritten.
 *
 * Operations completed *before* a rate was set carry overheadCost = 0. The
 * work order therefore absorbs the true-up at costing time — one equalising
 * amount on its latest operation — so that Σ task buckets always equals the
 * work-order total, and WIP settles to zero when the order closes.
 */
import { Prisma } from '@prisma/client'
import { db } from './db'
import { AccountCode, BusinessError, assertPeriodOpen, booksLock, postGl } from './accounting'
import { EPS, r2 } from './erp'
import { bomUnitsPerSet } from './bom-basis'

type Tx = Prisma.TransactionClient

/** Where the absorbed overhead sits in the ledger. Accrued, never paid. */
export const OVERHEAD_ACCOUNT = 'OVHA' satisfies AccountCode

/** Hard ceiling on the absorption rate — beyond this a typo is far likelier than policy. */
export const MAX_OVERHEAD_RATE_PCT = 100

export interface TaskCostRow {
  id: string
  taskNo: string
  seq: number
  operation: string
  materialCost: number
  labourCost: number
  overheadCost: number
  hours: number
  actualQty: number
  rejectionQty: number
  status: string
}

export interface WorkOrderCost {
  workOrderId: string
  woNo: string
  materialCost: number
  labourCost: number
  overheadCost: number
  primeCost: number
  actualCost: number
  /** Rate in force now (0 when absorption is off). */
  overheadRatePct: number
  /** Overhead that a rate change left unabsorbed on already-completed tasks. */
  overheadTrueUp: number
  /** Operations completed (not cancelled) and the ones still open. */
  tasksDone: number
  tasksOpen: number
  /** Internal consistency: the per-task buckets must add up to the header. */
  reconciles: boolean
}

/**
 * Pure calculation, shared by the posting path and the report so a preview can
 * never disagree with what a completion writes.
 */
export function costRollUp(input: {
  tasks: TaskCostRow[]
  overheadRatePct: number
  recordedOverhead?: number | null
}): { cost: WorkOrderCost; rows: (TaskCostRow & { overheadShare: number })[] } {
  const active = input.tasks.filter((t) => t.status !== 'CANCELLED')
  const done = active.filter((t) => t.status === 'COMPLETED')
  const materialCost = r2(active.reduce((s, t) => s + t.materialCost, 0))
  const labourCost = r2(active.reduce((s, t) => s + t.labourCost, 0))
  const primeCost = r2(materialCost + labourCost)
  // What the current rate says this order should have absorbed per task.
  const expectedOverhead = r2(primeCost * (input.overheadRatePct / 100))
  const recorded = r2(input.recordedOverhead ?? active.reduce((s, t) => s + t.overheadCost, 0))
  return {
    cost: {
      workOrderId: '',
      woNo: '',
      materialCost,
      labourCost,
      overheadCost: recorded,
      primeCost,
      actualCost: r2(primeCost + recorded),
      overheadRatePct: input.overheadRatePct,
      overheadTrueUp: r2(expectedOverhead - recorded),
      tasksDone: done.length,
      tasksOpen: active.length - done.length,
      reconciles:
        Math.abs(r2(done.reduce((s, t) => s + t.materialCost + t.labourCost + t.overheadCost, 0)) - r2(materialCost + labourCost + recorded)) < 0.01,
    },
    rows: active.map((t) => ({
      ...t,
      overheadShare: primeCost > EPS ? r2(recorded * ((t.materialCost + t.labourCost) / primeCost)) : 0,
    })),
  }
}

/** Company absorption rate (0 when unset — absorption off). */
export async function overheadRatePct(client: Tx | typeof db = db): Promise<number> {
  const company = await client.company.findFirst({ select: { overheadRatePct: true } })
  return company?.overheadRatePct ?? 0
}

/**
 * Cost one work order as it stands. Read-only: used by the UI, the reports and
 * the receipt preview.
 */
export async function workOrderCost(workOrderId: string): Promise<WorkOrderCost> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      woNo: true,
      overheadCost: true,
      tasks: {
        select: {
          id: true, taskNo: true, seq: true, operation: true, materialCost: true,
          labourCost: true, overheadCost: true, hours: true, actualQty: true,
          rejectionQty: true, status: true,
        },
      },
    },
  })
  if (!wo) throw new BusinessError('Work order not found', 404)
  const rate = await overheadRatePct()
  const { cost } = costRollUp({ tasks: wo.tasks, overheadRatePct: rate, recordedOverhead: wo.overheadCost })
  return { ...cost, workOrderId: wo.id, woNo: wo.woNo }
}

/**
 * Absorb overhead for a just-completed operation and keep the work-order total
 * in step. Called inside `completeTask`'s transaction, after material and
 * labour are known.
 *
 * `date` must be the task's completion date: the posting is period-guarded, so
 * completing a job into a closed period fails here rather than silently
 * dropping the absorbed amount.
 */
export async function absorbTaskOverheadTx(
  tx: Tx,
  input: {
    taskId: string
    taskNo: string
    materialCost: number
    labourCost: number
    /** Target date for the accrual (normally the completion date). */
    date: Date
  }
): Promise<{ overheadCost: number; workOrderOverhead: number; trueUp: number; date: Date }> {
  const task = await tx.productionTask.findUnique({
    where: { id: input.taskId },
    select: {
      workOrderId: true,
      overheadCost: true,
      workOrder: {
        select: {
          woNo: true,
          overheadCost: true,
          tasks: { select: { id: true, seq: true, materialCost: true, labourCost: true, overheadCost: true, status: true } },
        },
      },
    },
  })
  if (!task) throw new BusinessError('Task not found', 404)
  const rate = await overheadRatePct(tx)
  const prime = r2(input.materialCost + input.labourCost)
  const overheadCost = rate > 0 ? r2(prime * (rate / 100)) : 0
  // The task's stored overhead is what was accrued earlier for this row (0 on a
  // first completion — retries are blocked upstream by the status claim).
  const delta = r2(overheadCost - task.overheadCost)
  const others = r2(
    task.workOrder.tasks
      .filter((t) => t.id !== input.taskId && t.status !== 'CANCELLED')
      .reduce((s, t) => s + t.overheadCost, 0)
  )
  const workOrderOverhead = r2(Math.max(0, others + overheadCost))

  // Absorbed overhead must land in an open period. If the completion date is
  // already locked, accrue in the first open day instead of failing the shop
  // floor; the amount is then dated where it could legally be posted and the
  // caller reports both dates.
  const lock = await booksLock(tx)
  let date = input.date
  if (lock && date <= lock) {
    date = new Date(new Date(lock.getTime() + 24 * 60 * 60_000).toISOString().slice(0, 10) + 'T00:00:00.000Z')
    await assertPeriodOpen(tx, date)
  }

  if (Math.abs(delta) > EPS) {
    const voucherNo = task.workOrder.woNo
    const debitShare = r2(Math.max(0, delta))
    const creditShare = r2(Math.max(0, -delta))
    const rows: Parameters<typeof postGl>[2] = [
      { account: 'WIP', debit: debitShare, credit: creditShare, remarks: `Overhead absorbed at ${rate}% on ${input.taskNo}` },
    ]
    if (debitShare > EPS) rows.push({ account: OVERHEAD_ACCOUNT, credit: debitShare, remarks: `Overhead absorbed at ${rate}% on ${input.taskNo}` })
    if (creditShare > EPS) rows.push({ account: OVERHEAD_ACCOUNT, debit: creditShare, remarks: `Overhead reversal on ${input.taskNo}` })
    await postGl(tx, { date, voucherType: 'MFG_OVERHEAD', voucherNo }, rows)
  }

  await tx.productionTask.update({ where: { id: input.taskId }, data: { overheadCost } })
  await tx.workOrder.update({ where: { id: task.workOrderId }, data: { overheadCost: workOrderOverhead } })
  // `task.workOrder.tasks` was re-read AFTER completeTask wrote this task's
  // material/labour, so it already includes them — do not add `prime` again.
  const expected = r2(
    task.workOrder.tasks
      .filter((t) => t.status !== 'CANCELLED')
      .reduce((s, t) => s + t.materialCost + t.labourCost, 0) * (rate / 100)
  )
  return { overheadCost, workOrderOverhead, trueUp: r2(expected - workOrderOverhead), date }
}

/**
 * Bring one work order's absorbed overhead up to the current rate: a rate
 * change (or a rate set after work started) leaves the order under- or
 * over-absorbed, and WIP then cannot settle against the finished-goods
 * receipt. The equalising amount is posted once, against the latest operation,
 * and the per-task buckets are restated in proportion to prime cost so every
 * total in the books, the reports and the UI agrees.
 *
 * Accountant-facing and idempotent: running it again posts nothing when the
 * order already matches the rate.
 */
export async function trueUpWorkOrderOverhead(workOrderId: string): Promise<WorkOrderCost & { posted: number; date: string | null }> {
  return db.$transaction(async (tx) => {
    const wo = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true, woNo: true, status: true, overheadCost: true,
        tasks: {
          select: {
            id: true, taskNo: true, seq: true, operation: true, materialCost: true,
            labourCost: true, overheadCost: true, hours: true, actualQty: true,
            rejectionQty: true, status: true, completedAt: true,
          },
        },
      },
    })
    if (!wo) throw new BusinessError('Work order not found', 404)
    if (wo.status === 'CANCELLED') throw new BusinessError('Cancelled work orders are not re-costed', 409)
    const rate = await overheadRatePct(tx)
    const done = wo.tasks.filter((t) => t.status === 'COMPLETED')
    if (!done.length) throw new BusinessError('Nothing to true up: no operation on this order has been completed', 409)
    const prime = r2(done.reduce((s, t) => s + t.materialCost + t.labourCost, 0))
    const target = r2(prime * (rate / 100))
    const delta = r2(target - wo.overheadCost)

    // Post first: a locked period must block the whole true-up, not half of it.
    let date: Date | null = null
    /** Task id → restated overhead, so the returned roll-up matches the books. */
    const restated = new Map<string, number>()
    if (Math.abs(delta) > EPS) {
      const last = [...done].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0]
      date = last.completedAt ?? new Date()
      await assertPeriodOpen(tx, date)
      const rows: Parameters<typeof postGl>[2] = [
        { account: 'WIP', debit: r2(Math.max(0, delta)), credit: r2(Math.max(0, -delta)), remarks: `Overhead true-up at ${rate}% on ${wo.woNo}` },
      ]
      if (delta > EPS) rows.push({ account: OVERHEAD_ACCOUNT, credit: delta, remarks: `Overhead true-up at ${rate}% on ${wo.woNo}` })
      else rows.push({ account: OVERHEAD_ACCOUNT, debit: -delta, remarks: `Overhead true-up at ${rate}% on ${wo.woNo}` })
      await postGl(tx, { date, voucherType: 'MFG_OVERHEAD_TRUEUP', voucherNo: wo.woNo }, rows)

      // Restate the task buckets pro rata so Σ task = header exactly. The last
      // row takes the rounding remainder — otherwise Σ tasks drifts from the
      // header by a paisa and WIP never settles cleanly.
      let allocated = 0
      const ordered = [...done].sort((a, b) => a.seq - b.seq)
      for (const [index, task] of ordered.entries()) {
        const share = index === ordered.length - 1 ? r2(target - allocated) : prime > EPS ? r2(target * ((task.materialCost + task.labourCost) / prime)) : 0
        allocated = r2(allocated + share)
        restated.set(task.id, share)
        if (Math.abs(share - task.overheadCost) > EPS) {
          await tx.productionTask.update({ where: { id: task.id }, data: { overheadCost: share } })
        }
      }
    }
    await tx.workOrder.update({ where: { id: wo.id }, data: { overheadCost: target } })

    const { cost } = costRollUp({
      tasks: wo.tasks.map((t) => ({ ...t, overheadCost: restated.get(t.id) ?? t.overheadCost })),
      overheadRatePct: rate,
      recordedOverhead: target,
    })
    return { ...cost, workOrderId: wo.id, woNo: wo.woNo, posted: delta, date: date ? date.toISOString().slice(0, 10) : null }
  })
}

/**
 * Standard cost of one output unit for a BOM revision: material at the line
 * rates plus routed labour at each operation's work-centre cost per hour.
 * `overheadRatePct` is optional — when passed, absorbed overhead per unit is
 * returned too, so the BOM screen can show all-in standard cost.
 */
export interface StandardCost {
  materialCost: number
  labourCost: number
  overheadCost: number
  standardCost: number
  minutesPerUnit: number
  /** Operations that have no work-centre cost rate — labour is understated. */
  unpricedOperations: string[]
  /** True when the revision has no routing at all. */
  noRouting: boolean
}

export async function bomStandardCost(
  bomId: string,
  options?: { overheadRatePct?: number; client?: Tx | typeof db }
): Promise<StandardCost> {
  const client = options?.client ?? db
  const bom = await client.bom.findUnique({
    where: { id: bomId },
    select: {
      bomNo: true,
      lineBasis: true,
      batchQty: true,
      items: { select: { qty: true, wastagePct: true, rate: true, estCost: true } },
      routing: { select: { operation: true, runMinutesPerUnit: true, setupMinutes: true, workCenter: { select: { costPerHour: true } } } },
    },
  })
  if (!bom) throw new BusinessError('BOM not found', 404)
  // per ONE output unit: a BATCH revision's lines make batchQty units
  const materialCost = r2(bom.items.reduce((s, i) => s + i.estCost, 0) / bomUnitsPerSet(bom))
  let labourCost = 0
  let minutesPerUnit = 0
  const unpriced: string[] = []
  for (const op of bom.routing) {
    const minutes = op.setupMinutes + op.runMinutesPerUnit
    minutesPerUnit = r2(minutesPerUnit + minutes)
    const rate = op.workCenter?.costPerHour ?? 0
    if (rate <= 0) unpriced.push(op.operation)
    labourCost = r2(labourCost + (minutes / 60) * rate)
  }
  const ratePct = options?.overheadRatePct ?? 0
  const overheadCost = r2((materialCost + labourCost) * (ratePct / 100))
  return {
    materialCost,
    labourCost,
    overheadCost,
    standardCost: r2(materialCost + labourCost + overheadCost),
    minutesPerUnit,
    unpricedOperations: unpriced,
    noRouting: bom.routing.length === 0,
  }
}

/** Persist the standard labour/minutes snapshot on a revision (on approval). */
export async function freezeStandardCostTx(tx: Tx, bomId: string): Promise<StandardCost> {
  const standard = await bomStandardCost(bomId, { client: tx })
  await tx.bom.update({
    where: { id: bomId },
    data: { standardLabourCost: standard.labourCost, standardMinutes: standard.minutesPerUnit },
  })
  return standard
}

/**
 * Work-order expected-vs-actual roll-up for the UI and reports: the standard is
 * what the revision says one unit costs, pro-rated to how much was produced.
 */
export async function workOrderCostVariance(workOrderId: string) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true, woNo: true, outputQty: true, status: true, overheadCost: true,
      bom: { select: { bomNo: true, revision: true, standardLabourCost: true, standardMinutes: true, lineBasis: true, batchQty: true, items: { select: { estCost: true } } } },
      tasks: { select: { id: true, taskNo: true, seq: true, operation: true, materialCost: true, labourCost: true, overheadCost: true, hours: true, actualQty: true, rejectionQty: true, status: true } },
      productionReceipts: { where: { status: 'POSTED' }, select: { acceptedQty: true } },
    },
  })
  if (!wo) throw new BusinessError('Work order not found', 404)
  const rate = await overheadRatePct()
  const { cost: roll, rows } = costRollUp({ tasks: wo.tasks, overheadRatePct: rate, recordedOverhead: wo.overheadCost })
  const standardMaterial = r2((wo.bom?.items.reduce((s, i) => s + i.estCost, 0) ?? 0) / bomUnitsPerSet(wo.bom))
  const standardLabour = r2(wo.bom?.standardLabourCost ?? 0)
  const standardOverhead = r2((standardMaterial + standardLabour) * (rate / 100))
  const standardPerUnit = r2(standardMaterial + standardLabour + standardOverhead)
  const accepted = r2(wo.productionReceipts.reduce((s, r) => s + r.acceptedQty, 0))
  // Compare like with like: the standard for ONE unit against the actual cost
  // of the operations completed so far, scaled by units accepted.
  const standardForOutput = r2(standardPerUnit * accepted)
  return {
    workOrderId: wo.id,
    woNo: wo.woNo,
    status: wo.status,
    bomNo: wo.bom?.bomNo ?? null,
    revision: wo.bom?.revision ?? null,
    outputQty: wo.outputQty,
    acceptedQty: accepted,
    hasRouting: (wo.bom?.standardMinutes ?? 0) > 0,
    standard: { material: standardMaterial, labour: standardLabour, overhead: standardOverhead, perUnit: standardPerUnit, forOutput: standardForOutput },
    actual: { material: roll.materialCost, labour: roll.labourCost, overhead: roll.overheadCost, total: roll.actualCost },
    variance: {
      material: r2(roll.materialCost - standardForOutput * (standardPerUnit > EPS ? standardMaterial / standardPerUnit : 0)),
      labour: r2(roll.labourCost - standardForOutput * (standardPerUnit > EPS ? standardLabour / standardPerUnit : 0)),
      total: r2(roll.actualCost - standardForOutput),
      pct: standardForOutput > EPS ? r2(((roll.actualCost - standardForOutput) / standardForOutput) * 100) : null,
    },
    overheadRatePct: rate,
    overheadTrueUp: roll.overheadTrueUp,
    tasks: rows,
    notes: [
      ...(wo.bom ? [] : ['No BOM on this work order — there is no standard to compare against']),
      ...(standardForOutput <= EPS ? ['Nothing has been received yet, so the standard for the produced quantity is zero'] : []),
      ...(roll.overheadTrueUp > EPS || roll.overheadTrueUp < -EPS ? [`Absorbed overhead differs from the current rate by ${roll.overheadTrueUp} — run the true-up to restate it`] : []),
    ],
  }
}
