import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError } from './accounting'
import { EPS, r2 } from './erp'
import { tenantCompany } from './tenant'

type Tx = Prisma.TransactionClient
async function company(tx: Tx) { const row = await tenantCompany(tx); if (!row) throw new BusinessError('Operating company is not configured', 409); return row }

/** Lots that can be issued: available, not expired. */
const ISSUABLE = 'AVAILABLE'

export async function lotBalanceTx(tx: Tx, lotId: string) {
  const sum = await tx.lotMovement.aggregate({ where: { lotId, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
  return r2((sum._sum.qtyIn ?? 0) - (sum._sum.qtyOut ?? 0))
}

export async function receiveLotTx(tx: Tx, input: { itemId: string; warehouseId: string; lotNo: string; qty: number; manufactureDate?: Date | null; expiryDate?: Date | null; supplierLotNo?: string | null; sourceType: string; sourceId: string; voucherType: string; voucherNo: string; status?: string; serialNumbers?: string[] }) {
  const org = await company(tx)
  if (!(input.qty > 0)) throw new BusinessError('Lot receipt quantity must be positive')
  if (input.expiryDate && input.manufactureDate && input.expiryDate <= input.manufactureDate) throw new BusinessError('Lot expiry date must be after manufacture date')
  const raw = (input.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean)
  const serials = [...new Set(raw)]
  if (serials.length !== raw.length) throw new BusinessError('Each serial number may appear only once in a receipt')
  if (serials.length && Math.abs(serials.length - input.qty) > EPS) throw new BusinessError('Serial count must equal received quantity')
  const lot = await tx.inventoryLot.upsert({ where: { companyId_itemId_warehouseId_lotNo: { companyId: org.id, itemId: input.itemId, warehouseId: input.warehouseId, lotNo: input.lotNo.trim() } }, create: { companyId: org.id, itemId: input.itemId, warehouseId: input.warehouseId, lotNo: input.lotNo.trim(), manufactureDate: input.manufactureDate, expiryDate: input.expiryDate, supplierLotNo: input.supplierLotNo, sourceType: input.sourceType, sourceId: input.sourceId, status: input.status ?? 'AVAILABLE' }, update: {} })
  // A fully consumed lot that receives stock again is available again; a recalled,
  // quarantined or blocked lot keeps that status (the new units inherit the hold).
  if (lot.status === 'CONSUMED') await tx.inventoryLot.update({ where: { id: lot.id }, data: { status: 'AVAILABLE' } })
  await tx.lotMovement.create({ data: { companyId: org.id, lotId: lot.id, itemId: input.itemId, warehouseId: input.warehouseId, postingDate: new Date(), movementType: 'RECEIPT', qtyIn: input.qty, voucherType: input.voucherType, voucherNo: input.voucherNo, referenceId: input.sourceId } })
  if (serials.length) {
    const existing = await tx.serialNumber.findMany({ where: { companyId: org.id, itemId: input.itemId, serialNo: { in: serials } } })
    const live = existing.filter((row) => row.status !== 'CANCELLED')
    if (live.length) throw new BusinessError(`Serial number already exists for this item: ${live.map((row) => row.serialNo).slice(0, 5).join(', ')}`, 409)
    const reusable = new Map(existing.map((row) => [row.serialNo, row]))
    for (const serialNo of serials) {
      const prior = reusable.get(serialNo)
      // A serial voided by a cancelled receipt may be received again (corrected receipt).
      if (prior) await tx.serialNumber.update({ where: { id: prior.id }, data: { status: 'AVAILABLE', warehouseId: input.warehouseId, lotId: lot.id, sourceType: input.sourceType, sourceId: input.sourceId, issuedToType: null, issuedToId: null } })
      else await tx.serialNumber.create({ data: { companyId: org.id, itemId: input.itemId, warehouseId: input.warehouseId, lotId: lot.id, serialNo, sourceType: input.sourceType, sourceId: input.sourceId } })
    }
  }
  return lot
}

export async function issueLotTx(tx: Tx, input: { lotId: string; qty: number; voucherType: string; voucherNo: string; referenceId?: string; serialNumbers?: string[] }) {
  const org = await company(tx)
  const lot = await tx.inventoryLot.findFirst({ where: { id: input.lotId, companyId: org.id } })
  if (!lot) throw new BusinessError('Inventory lot not found', 404)
  if (lot.status !== ISSUABLE) throw new BusinessError(`Lot ${lot.lotNo} is ${lot.status} and cannot be issued`)
  if (lot.expiryDate && lot.expiryDate < new Date()) throw new BusinessError(`Lot ${lot.lotNo} is expired`)
  const balance = await lotBalanceTx(tx, lot.id)
  if (!(input.qty > 0) || balance + EPS < input.qty) throw new BusinessError(`Lot ${lot.lotNo} balance is ${balance}, requested ${input.qty}`)
  const raw = (input.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean)
  const serials = [...new Set(raw)]
  if (serials.length !== raw.length) throw new BusinessError('Each serial number may be issued only once')
  const trackedSerials = await tx.serialNumber.count({ where: { lotId: lot.id, status: 'AVAILABLE' } })
  if (trackedSerials > 0 && !serials.length) throw new BusinessError(`Lot ${lot.lotNo} is serial-tracked — enter the ${input.qty} serial number(s) being issued`)
  if (serials.length && Math.abs(serials.length - input.qty) > EPS) throw new BusinessError('Serial count must equal issued quantity')
  if (serials.length) {
    // Conditional update: a serial already issued by a concurrent request no longer
    // matches status AVAILABLE, so the count check below fails instead of double-issuing.
    const updated = await tx.serialNumber.updateMany({ where: { companyId: org.id, itemId: lot.itemId, lotId: lot.id, serialNo: { in: serials }, status: 'AVAILABLE' }, data: { status: 'ISSUED', warehouseId: null, issuedToType: input.voucherType, issuedToId: input.referenceId } })
    if (updated.count !== serials.length) throw new BusinessError('One or more serial numbers are unavailable, already issued or belong to another lot', 409)
  }
  await tx.lotMovement.create({ data: { companyId: org.id, lotId: lot.id, itemId: lot.itemId, warehouseId: lot.warehouseId, postingDate: new Date(), movementType: 'ISSUE', qtyOut: input.qty, voucherType: input.voucherType, voucherNo: input.voucherNo, referenceId: input.referenceId } })
  if (Math.abs(balance - input.qty) <= EPS) await tx.inventoryLot.update({ where: { id: lot.id }, data: { status: 'CONSUMED' } })
  return lot
}

/**
 * Keep lot balances inside the stock ledger when stock leaves through a
 * document that names no batch (plain sales invoice, task material issue,
 * purchase return, un-batched challan line). Call it BEFORE writing the
 * stock-ledger issue row. Untracked stock (stock − Σ lot balances) is used
 * first; any remainder must come from issuable lots in FEFO order. Recalled,
 * quarantined, blocked, expired and serial-tracked lots are never consumed
 * implicitly — the issue is refused with the reason instead.
 */
export async function consumeLotsFefoTx(tx: Tx, input: { itemId: string; warehouseId: string; qty: number; voucherType: string; voucherNo: string; referenceId?: string }) {
  const org = await company(tx)
  const lots = await tx.inventoryLot.findMany({ where: { companyId: org.id, itemId: input.itemId, warehouseId: input.warehouseId }, select: { id: true, lotNo: true, status: true, expiryDate: true, createdAt: true } })
  if (!lots.length) return
  const sums = await tx.lotMovement.groupBy({ by: ['lotId'], where: { lotId: { in: lots.map((lot) => lot.id) }, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
  const balance = new Map(sums.map((row) => [row.lotId, r2((row._sum.qtyIn ?? 0) - (row._sum.qtyOut ?? 0))]))
  const inLots = r2(lots.reduce((sum, lot) => sum + Math.max(0, balance.get(lot.id) ?? 0), 0))
  const stock = await tx.stockLedger.aggregate({ where: { itemId: input.itemId, warehouseId: input.warehouseId, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
  const untracked = Math.max(0, r2((stock._sum.qtyIn ?? 0) - (stock._sum.qtyOut ?? 0) - inLots))
  let need = r2(input.qty - untracked)
  if (need <= EPS) return
  const now = new Date()
  const serialised = new Set((await tx.serialNumber.groupBy({ by: ['lotId'], where: { lotId: { in: lots.map((lot) => lot.id) }, status: 'AVAILABLE' } })).map((row) => row.lotId))
  const issuable = lots
    .filter((lot) => lot.status === ISSUABLE && !(lot.expiryDate && lot.expiryDate < now) && !serialised.has(lot.id) && (balance.get(lot.id) ?? 0) > EPS)
    .sort((a, b) => (a.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.createdAt.getTime() - b.createdAt.getTime())
  const issuableQty = r2(issuable.reduce((sum, lot) => sum + (balance.get(lot.id) ?? 0), 0))
  if (issuableQty + EPS < need) {
    const held = lots.filter((lot) => !issuable.includes(lot) && (balance.get(lot.id) ?? 0) > EPS).map((lot) => `${lot.lotNo} (${serialised.has(lot.id) ? 'serial-tracked' : lot.expiryDate && lot.expiryDate < now ? 'expired' : lot.status}, ${balance.get(lot.id)})`)
    throw new BusinessError(`Only ${r2(untracked + issuableQty)} can be issued without naming a batch; the rest is held in ${held.join(', ') || 'no issuable batch'}. Issue a specific batch or release the hold first.`, 409)
  }
  for (const lot of issuable) {
    if (need <= EPS) break
    const take = r2(Math.min(need, balance.get(lot.id) ?? 0))
    await issueLotTx(tx, { lotId: lot.id, qty: take, voucherType: input.voucherType, voucherNo: input.voucherNo, referenceId: input.referenceId })
    need = r2(need - take)
  }
}

/** Mirror every lot movement of a voucher (append-only) and restore lot/serial state. */
export async function cancelLotMovementsTx(tx: Tx, voucherType: string, voucherNo: string) {
  const rows = await tx.lotMovement.findMany({ where: { voucherType, voucherNo, isCancelled: false }, include: { lot: true } })
  for (const row of rows) {
    if (row.qtyIn > EPS) {
      // Undoing a receipt must not drive the batch negative even when the item
      // still has enough untracked stock in the warehouse.
      const balance = await lotBalanceTx(tx, row.lotId)
      if (balance + EPS < row.qtyIn) throw new BusinessError(`Cannot reverse ${voucherNo}: batch ${row.lot.lotNo} has only ${balance} left of the ${row.qtyIn} received (already issued)`, 409)
    }
  }
  for (const row of rows) {
    await tx.lotMovement.create({ data: { companyId: row.companyId, lotId: row.lotId, itemId: row.itemId, warehouseId: row.warehouseId, postingDate: new Date(), movementType: 'REVERSAL', qtyIn: row.qtyOut, qtyOut: row.qtyIn, voucherType, voucherNo, referenceId: row.referenceId, remarks: `Reversal of ${voucherNo}`, isCancelled: true } })
    if (row.qtyOut > EPS) {
      // Only a lot that this issue emptied is re-opened; a recall/quarantine/block
      // placed afterwards must survive the cancellation.
      const lot = await tx.inventoryLot.findUnique({ where: { id: row.lotId } })
      if (lot?.status === 'CONSUMED') await tx.inventoryLot.update({ where: { id: row.lotId }, data: { status: 'AVAILABLE' } })
      await tx.serialNumber.updateMany({
        where: { lotId: row.lotId, status: 'ISSUED', issuedToType: voucherType, issuedToId: row.referenceId },
        data: { status: lot?.status === 'RECALLED' ? 'RECALLED' : 'AVAILABLE', warehouseId: row.warehouseId, issuedToType: null, issuedToId: null },
      })
    }
    if (row.qtyIn > EPS && row.referenceId) {
      // Serials created by the cancelled receipt are voided (kept for audit, re-receivable).
      await tx.serialNumber.updateMany({ where: { lotId: row.lotId, sourceId: row.referenceId, status: { in: ['AVAILABLE', 'RESERVED'] } }, data: { status: 'CANCELLED', warehouseId: null } })
    }
  }
  await tx.lotMovement.updateMany({ where: { voucherType, voucherNo, isCancelled: false }, data: { isCancelled: true } })
}

/** Link parent lots to a child lot; refuses self-links and any multi-hop cycle. */
export async function linkLotGenealogyTx(tx: Tx, childLotId: string, parents: { parentLotId: string; consumedQty: number }[]) {
  for (const parent of parents) {
    if (parent.parentLotId === childLotId) throw new BusinessError('A lot cannot be its own parent')
    if (!(parent.consumedQty > 0)) throw new BusinessError('Consumed parent-lot quantity must be positive')
    // Walk the parent's ancestry: if the child is already an ancestor of the
    // parent, this link would close a loop (child -> ... -> parent -> child).
    const seen = new Set<string>([parent.parentLotId])
    let frontier = [parent.parentLotId]
    while (frontier.length) {
      const links = await tx.lotGenealogy.findMany({ where: { childLotId: { in: frontier } }, select: { parentLotId: true } })
      frontier = []
      for (const link of links) {
        if (link.parentLotId === childLotId) throw new BusinessError('This parent lot already descends from the lot being produced — the genealogy would form a cycle')
        if (!seen.has(link.parentLotId)) { seen.add(link.parentLotId); frontier.push(link.parentLotId) }
      }
    }
    await tx.lotGenealogy.upsert({ where: { parentLotId_childLotId: { parentLotId: parent.parentLotId, childLotId } }, create: { parentLotId: parent.parentLotId, childLotId, consumedQty: parent.consumedQty }, update: { consumedQty: { increment: parent.consumedQty } } })
  }
}

export async function recallLot(id: string, reason: string) {
  if (!reason.trim()) throw new BusinessError('Recall reason is required')
  return db.$transaction(async (tx) => {
    const org = await company(tx); const root = await tx.inventoryLot.findFirst({ where: { id, companyId: org.id } }); if (!root) throw new BusinessError('Lot not found', 404)
    const visited = new Set<string>(); const queue = [root.id]
    while (queue.length) { const lotId = queue.shift()!; if (visited.has(lotId)) continue; visited.add(lotId); const children = await tx.lotGenealogy.findMany({ where: { parentLotId: lotId }, select: { childLotId: true } }); queue.push(...children.map((row) => row.childLotId)) }
    await tx.inventoryLot.updateMany({ where: { id: { in: [...visited] } }, data: { status: 'RECALLED' } })
    await tx.serialNumber.updateMany({ where: { lotId: { in: [...visited] }, status: { in: ['AVAILABLE', 'RESERVED'] } }, data: { status: 'RECALLED' } })
    return { rootLot: root.lotNo, affectedLots: visited.size, reason: reason.trim() }
  })
}

export async function traceabilityDashboard() {
  const org = await tenantCompany(db); if (!org) throw new BusinessError('Operating company is not configured', 409)
  const lots = await db.inventoryLot.findMany({ where: { companyId: org.id }, orderBy: { createdAt: 'desc' }, include: { item: true, warehouse: true, movements: { where: { isCancelled: false } }, serials: true, parentLinks: { include: { parentLot: { include: { item: true } } } }, childLinks: { include: { childLot: { include: { item: true } } } } } })
  return lots.map((lot) => ({ ...lot, balance: r2(lot.movements.reduce((sum, row) => sum + row.qtyIn - row.qtyOut, 0)), expired: !!lot.expiryDate && lot.expiryDate < new Date(), availableSerials: lot.serials.filter((row) => row.status === 'AVAILABLE').length }))
}
