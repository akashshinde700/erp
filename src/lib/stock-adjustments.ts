/**
 * ForgeERP — stock adjustments with a reason code and maker-checker approval.
 *
 * A request changes nothing. Approval posts the stock movement (voucher
 * ADJUST) and its value to the GL (Stock vs Stock Adjustment) in one
 * transaction. The approver must be a different user from the requester
 * unless the approver is the OWNER. Decreases are valued at the warehouse
 * weighted-average cost, may not drive stock negative, and draw from
 * batches FEFO so lot balances stay within stock. Cancelling an approved
 * adjustment posts mirrored reversals (append-only).
 */
import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError, assertPeriodOpen, cancelGlForVoucher, postGl } from './accounting'
import { EPS, fyCode, r2 } from './erp'
import { tenantCompany } from './tenant'
import { cancelLotMovementsTx, consumeLotsFefoTx } from './traceability'

type Tx = Prisma.TransactionClient
type Actor = { role: string; email: string | null } | null

export const ADJUSTMENT_REASONS = ['PHYSICAL_COUNT', 'DAMAGE', 'EXPIRY', 'THEFT_LOSS', 'FOUND', 'SCRAP', 'OTHER'] as const
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]
/** Reasons that can only reduce stock. */
const DECREASE_ONLY = new Set<AdjustmentReason>(['DAMAGE', 'EXPIRY', 'THEFT_LOSS', 'SCRAP'])

async function org(tx: Tx) {
  const company = await tenantCompany(tx)
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  return company
}

async function avgCost(tx: Tx, itemId: string, warehouseId: string): Promise<number> {
  const rows = await tx.stockLedger.findMany({ where: { itemId, warehouseId, isCancelled: false, voucherType: { not: 'JOBWORK_IN' } }, select: { qtyIn: true, rate: true } })
  let q = 0, v = 0
  for (const r of rows) { q += r.qtyIn; v += r.qtyIn * r.rate }
  return q > EPS ? r2(v / q) : 0
}

async function onHand(tx: Tx, itemId: string, warehouseId: string): Promise<number> {
  const s = await tx.stockLedger.aggregate({ where: { itemId, warehouseId, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
  return r2((s._sum.qtyIn ?? 0) - (s._sum.qtyOut ?? 0))
}

export interface AdjustmentInput {
  date: Date
  warehouseId: string
  reasonCode: AdjustmentReason
  notes?: string
  lines: { itemId: string; qtyChange: number; rate?: number }[]
  requestedBy?: string
}

export async function requestAdjustment(input: AdjustmentInput) {
  if (!input.lines.length) throw new BusinessError('Add at least one item')
  if (input.reasonCode === 'OTHER' && !input.notes?.trim()) throw new BusinessError('Explain the adjustment when the reason is OTHER')
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    await assertPeriodOpen(tx, input.date)
    const wh = await tx.warehouse.findFirst({ where: { id: input.warehouseId } })
    if (!wh) throw new BusinessError('Warehouse not found', 404)
    if (new Set(input.lines.map((l) => l.itemId)).size !== input.lines.length) throw new BusinessError('An item may appear only once per adjustment')
    for (const [i, l] of input.lines.entries()) {
      if (!Number.isFinite(l.qtyChange) || Math.abs(l.qtyChange) < EPS) throw new BusinessError(`Line ${i + 1}: quantity change cannot be zero`)
      if (DECREASE_ONLY.has(input.reasonCode) && l.qtyChange > 0) throw new BusinessError(`Line ${i + 1}: ${input.reasonCode.replace('_', ' ').toLowerCase()} can only reduce stock`)
      if (input.reasonCode === 'FOUND' && l.qtyChange < 0) throw new BusinessError(`Line ${i + 1}: FOUND can only increase stock`)
      const item = await tx.item.findFirst({ where: { id: l.itemId } })
      if (!item) throw new BusinessError(`Line ${i + 1}: item not found`, 404)
      if (await tx.stockLedger.findFirst({ where: { itemId: l.itemId, warehouseId: wh.id, voucherType: 'JOBWORK_IN' }, select: { id: true } })) {
        throw new BusinessError(`Line ${i + 1}: ${item.code} in ${wh.code} includes customer jobwork material; adjust it through the jobwork documents`, 409)
      }
      if (l.qtyChange < 0) {
        const have = await onHand(tx, l.itemId, wh.id)
        if (have + l.qtyChange < -EPS) throw new BusinessError(`Line ${i + 1}: ${item.code} has only ${have} in ${wh.code}; cannot reduce by ${-l.qtyChange}`, 409)
      }
    }
    const display = `ADJ-${fyCode(input.date)}`
    const key = `${company.id}:${display}`
    const counter = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } })
    return tx.stockAdjustment.create({
      data: {
        companyId: company.id, adjNo: `${display}-${String(counter.value).padStart(3, '0')}`, date: input.date, warehouseId: wh.id,
        reasonCode: input.reasonCode, notes: input.notes?.trim() || null, requestedBy: input.requestedBy,
        lines: { create: input.lines.map((l) => ({ itemId: l.itemId, qtyChange: r2(l.qtyChange), rate: r2(l.rate ?? 0) })) },
      },
      include: { lines: true },
    })
  })
}

function assertApprover(actor: Actor, requestedBy: string | null) {
  if (!actor) return // first-boot / single-user install without logins
  if (actor.role !== 'OWNER' && actor.role !== 'ACCOUNTANT' && actor.role !== 'SUPER_ADMIN') throw new BusinessError('Only the OWNER or an ACCOUNTANT can decide a stock adjustment', 403)
  if (actor.role !== 'OWNER' && actor.role !== 'SUPER_ADMIN' && requestedBy && actor.email === requestedBy) {
    throw new BusinessError('You requested this adjustment: another user (or the OWNER) must approve it', 403)
  }
}

export async function approveAdjustment(input: { id: string; actor: Actor; note?: string }) {
  return db.$transaction(async (tx) => {
    const adj = await tx.stockAdjustment.findFirst({ where: { id: input.id }, include: { lines: { include: { item: true } }, warehouse: true } })
    if (!adj) throw new BusinessError('Adjustment not found', 404)
    if (adj.status !== 'PENDING') throw new BusinessError(`Adjustment is ${adj.status.toLowerCase()}`, 409)
    assertApprover(input.actor, adj.requestedBy)
    await assertPeriodOpen(tx, adj.date)
    // claim first: two approvers at once cannot both post
    const claim = await tx.stockAdjustment.updateMany({ where: { id: adj.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedBy: input.actor?.email ?? 'setup', decidedAt: new Date(), decisionNote: input.note?.trim() || null } })
    if (claim.count !== 1) throw new BusinessError('Adjustment was decided by someone else', 409)
    let total = 0
    for (const line of adj.lines) {
      const cost = await avgCost(tx, line.itemId, adj.warehouseId)
      if (line.qtyChange < 0) {
        const have = await onHand(tx, line.itemId, adj.warehouseId)
        if (have + line.qtyChange < -EPS) throw new BusinessError(`${line.item.code} now has only ${have} in ${adj.warehouse.code}; the adjustment would make stock negative`, 409)
        await consumeLotsFefoTx(tx, { itemId: line.itemId, warehouseId: adj.warehouseId, qty: -line.qtyChange, voucherType: 'ADJUST', voucherNo: adj.adjNo, referenceId: adj.id })
      }
      // increases at the requested rate (else current average, else the item cost rate); decreases at average cost
      const rate = line.qtyChange < 0 ? cost : r2(line.rate > 0 ? line.rate : cost || line.item.costRate)
      const value = r2(line.qtyChange * rate)
      total = r2(total + value)
      await tx.stockLedger.create({
        data: {
          postingDate: adj.date, voucherType: 'ADJUST', voucherNo: adj.adjNo, itemId: line.itemId, warehouseId: adj.warehouseId,
          qtyIn: line.qtyChange > 0 ? line.qtyChange : 0, qtyOut: line.qtyChange < 0 ? -line.qtyChange : 0, rate, remarks: `${adj.reasonCode}${adj.notes ? `: ${adj.notes.slice(0, 120)}` : ''}`,
        },
      })
      await tx.stockAdjustmentLine.update({ where: { id: line.id }, data: { rate, value } })
    }
    if (Math.abs(total) > 0.004) {
      await postGl(tx, { date: adj.date, voucherType: 'ADJUST', voucherNo: adj.adjNo }, total > 0
        ? [{ account: 'STKV', debit: total, remarks: adj.reasonCode }, { account: 'STADJ', credit: total }]
        : [{ account: 'STADJ', debit: -total, remarks: adj.reasonCode }, { account: 'STKV', credit: -total }])
    }
    return tx.stockAdjustment.update({ where: { id: adj.id }, data: { value: total }, include: { lines: true } })
  })
}

export async function rejectAdjustment(input: { id: string; actor: Actor; note: string }) {
  const adj = await db.stockAdjustment.findFirst({ where: { id: input.id } })
  if (!adj) throw new BusinessError('Adjustment not found', 404)
  assertApprover(input.actor, adj.requestedBy)
  const upd = await db.stockAdjustment.updateMany({ where: { id: adj.id, status: 'PENDING' }, data: { status: 'REJECTED', decidedBy: input.actor?.email ?? 'setup', decidedAt: new Date(), decisionNote: input.note } })
  if (upd.count !== 1) throw new BusinessError(`Adjustment is ${adj.status.toLowerCase()}`, 409)
  return db.stockAdjustment.findFirst({ where: { id: adj.id } })
}

/** Cancel a pending request (withdraw) or an approved adjustment (mirrored reversal). */
export async function cancelAdjustment(input: { id: string; actor: Actor; reason: string }) {
  return db.$transaction(async (tx) => {
    const adj = await tx.stockAdjustment.findFirst({ where: { id: input.id }, include: { lines: { include: { item: true } }, warehouse: true } })
    if (!adj) throw new BusinessError('Adjustment not found', 404)
    if (adj.status === 'PENDING') {
      await tx.stockAdjustment.update({ where: { id: adj.id }, data: { status: 'CANCELLED', cancelReason: input.reason } })
      return tx.stockAdjustment.findFirst({ where: { id: adj.id } })
    }
    if (adj.status !== 'APPROVED') throw new BusinessError(`Adjustment is ${adj.status.toLowerCase()}`, 409)
    assertApprover(input.actor, null)
    const claim = await tx.stockAdjustment.updateMany({ where: { id: adj.id, status: 'APPROVED' }, data: { status: 'CANCELLED', cancelReason: input.reason } })
    if (claim.count !== 1) throw new BusinessError('Adjustment was changed by someone else', 409)
    // undoing an increase removes stock again: it must still be there
    for (const line of adj.lines) {
      if (line.qtyChange > 0) {
        const have = await onHand(tx, line.itemId, adj.warehouseId)
        if (have + EPS < line.qtyChange) throw new BusinessError(`Cannot cancel: ${line.item.code} has only ${have} left of the ${line.qtyChange} added (already used)`, 409)
      }
    }
    await cancelGlForVoucher(tx, 'ADJUST', adj.adjNo, new Date()) // refuses a locked period
    await cancelLotMovementsTx(tx, 'ADJUST', adj.adjNo)
    const rows = await tx.stockLedger.findMany({ where: { voucherType: 'ADJUST', voucherNo: adj.adjNo, isCancelled: false } })
    for (const r of rows) {
      await tx.stockLedger.create({ data: { postingDate: new Date(), voucherType: 'ADJUST', voucherNo: adj.adjNo, itemId: r.itemId, warehouseId: r.warehouseId, qtyIn: r.qtyOut, qtyOut: r.qtyIn, rate: r.rate, remarks: `Reversal of ${adj.adjNo}`, isCancelled: true } })
    }
    await tx.stockLedger.updateMany({ where: { voucherType: 'ADJUST', voucherNo: adj.adjNo, isCancelled: false }, data: { isCancelled: true } })
    return tx.stockAdjustment.findFirst({ where: { id: adj.id } })
  })
}

export async function adjustmentsDashboard() {
  const rows = await db.stockAdjustment.findMany({
    orderBy: [{ date: 'desc' }, { adjNo: 'desc' }], take: 300,
    include: { warehouse: { select: { code: true, name: true } }, lines: { include: { item: { select: { code: true, name: true, uom: true } } } } },
  })
  const approved = rows.filter((r) => r.status === 'APPROVED')
  const byReason = ADJUSTMENT_REASONS.map((reason) => {
    const rs = approved.filter((r) => r.reasonCode === reason)
    return { reason, count: rs.length, value: r2(rs.reduce((s, r) => s + r.value, 0)) }
  }).filter((r) => r.count > 0)
  return { adjustments: rows, pending: rows.filter((r) => r.status === 'PENDING').length, byReason }
}
