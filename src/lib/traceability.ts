import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError } from './accounting'
import { EPS, r2 } from './erp'

type Tx = Prisma.TransactionClient
async function company(tx: Tx) { const row = await tx.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } }); if (!row) throw new BusinessError('Operating company is not configured', 409); return row }

export async function lotBalanceTx(tx: Tx, lotId: string) {
  const sum = await tx.lotMovement.aggregate({ where: { lotId, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
  return r2((sum._sum.qtyIn ?? 0) - (sum._sum.qtyOut ?? 0))
}

export async function receiveLotTx(tx: Tx, input: { itemId: string; warehouseId: string; lotNo: string; qty: number; manufactureDate?: Date | null; expiryDate?: Date | null; supplierLotNo?: string | null; sourceType: string; sourceId: string; voucherType: string; voucherNo: string; status?: string; serialNumbers?: string[] }) {
  const org = await company(tx)
  if (!(input.qty > 0)) throw new BusinessError('Lot receipt quantity must be positive')
  if (input.expiryDate && input.manufactureDate && input.expiryDate <= input.manufactureDate) throw new BusinessError('Lot expiry date must be after manufacture date')
  const lot = await tx.inventoryLot.upsert({ where: { companyId_itemId_warehouseId_lotNo: { companyId: org.id, itemId: input.itemId, warehouseId: input.warehouseId, lotNo: input.lotNo.trim() } }, create: { companyId: org.id, itemId: input.itemId, warehouseId: input.warehouseId, lotNo: input.lotNo.trim(), manufactureDate: input.manufactureDate, expiryDate: input.expiryDate, supplierLotNo: input.supplierLotNo, sourceType: input.sourceType, sourceId: input.sourceId, status: input.status ?? 'AVAILABLE' }, update: {} })
  await tx.lotMovement.create({ data: { companyId: org.id, lotId: lot.id, itemId: input.itemId, warehouseId: input.warehouseId, postingDate: new Date(), movementType: 'RECEIPT', qtyIn: input.qty, voucherType: input.voucherType, voucherNo: input.voucherNo, referenceId: input.sourceId } })
  const serials = [...new Set((input.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean))]
  if (serials.length && Math.abs(serials.length - input.qty) > EPS) throw new BusinessError('Serial count must equal received quantity')
  for (const serialNo of serials) await tx.serialNumber.create({ data: { companyId: org.id, itemId: input.itemId, warehouseId: input.warehouseId, lotId: lot.id, serialNo, sourceType: input.sourceType, sourceId: input.sourceId } })
  return lot
}

export async function issueLotTx(tx: Tx, input: { lotId: string; qty: number; voucherType: string; voucherNo: string; referenceId?: string; serialNumbers?: string[] }) {
  const org = await company(tx)
  const lot = await tx.inventoryLot.findFirst({ where: { id: input.lotId, companyId: org.id } })
  if (!lot) throw new BusinessError('Inventory lot not found', 404)
  if (!['AVAILABLE'].includes(lot.status)) throw new BusinessError(`Lot ${lot.lotNo} is ${lot.status} and cannot be issued`)
  if (lot.expiryDate && lot.expiryDate < new Date()) throw new BusinessError(`Lot ${lot.lotNo} is expired`)
  const balance = await lotBalanceTx(tx, lot.id)
  if (!(input.qty > 0) || balance + EPS < input.qty) throw new BusinessError(`Lot ${lot.lotNo} balance is ${balance}, requested ${input.qty}`)
  const serials = [...new Set((input.serialNumbers ?? []).map((value) => value.trim()).filter(Boolean))]
  if (serials.length && Math.abs(serials.length - input.qty) > EPS) throw new BusinessError('Serial count must equal issued quantity')
  if (serials.length) {
    const available = await tx.serialNumber.findMany({ where: { companyId: org.id, itemId: lot.itemId, lotId: lot.id, serialNo: { in: serials }, status: 'AVAILABLE' } })
    if (available.length !== serials.length) throw new BusinessError('One or more serial numbers are unavailable or belong to another lot')
    await tx.serialNumber.updateMany({ where: { id: { in: available.map((row) => row.id) } }, data: { status: 'ISSUED', warehouseId: null, issuedToType: input.voucherType, issuedToId: input.referenceId } })
  }
  await tx.lotMovement.create({ data: { companyId: org.id, lotId: lot.id, itemId: lot.itemId, warehouseId: lot.warehouseId, postingDate: new Date(), movementType: 'ISSUE', qtyOut: input.qty, voucherType: input.voucherType, voucherNo: input.voucherNo, referenceId: input.referenceId } })
  if (Math.abs(balance - input.qty) <= EPS) await tx.inventoryLot.update({ where: { id: lot.id }, data: { status: 'CONSUMED' } })
  return lot
}

export async function cancelLotMovementsTx(tx: Tx, voucherType: string, voucherNo: string) {
  const rows = await tx.lotMovement.findMany({ where: { voucherType, voucherNo, isCancelled: false } })
  for (const row of rows) {
    await tx.lotMovement.create({ data: { companyId: row.companyId, lotId: row.lotId, itemId: row.itemId, warehouseId: row.warehouseId, postingDate: new Date(), movementType: 'REVERSAL', qtyIn: row.qtyOut, qtyOut: row.qtyIn, voucherType, voucherNo, referenceId: row.referenceId, remarks: `Reversal of ${voucherNo}`, isCancelled: true } })
    const balance = await lotBalanceTx(tx, row.lotId)
    if (row.qtyOut > 0 && balance + row.qtyOut > EPS) await tx.inventoryLot.update({ where: { id: row.lotId }, data: { status: 'AVAILABLE' } })
  }
  await tx.lotMovement.updateMany({ where: { voucherType, voucherNo, isCancelled: false }, data: { isCancelled: true } })
}

export async function linkLotGenealogyTx(tx: Tx, childLotId: string, parents: { parentLotId: string; consumedQty: number }[]) {
  for (const parent of parents) {
    if (parent.parentLotId === childLotId) throw new BusinessError('A lot cannot be its own parent')
    if (!(parent.consumedQty > 0)) throw new BusinessError('Consumed parent-lot quantity must be positive')
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
  const org = await db.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } }); if (!org) throw new BusinessError('Operating company is not configured', 409)
  const lots = await db.inventoryLot.findMany({ where: { companyId: org.id }, orderBy: { createdAt: 'desc' }, include: { item: true, warehouse: true, movements: { where: { isCancelled: false } }, serials: true, parentLinks: { include: { parentLot: { include: { item: true } } } }, childLinks: { include: { childLot: { include: { item: true } } } } } })
  return lots.map((lot) => ({ ...lot, balance: r2(lot.movements.reduce((sum, row) => sum + row.qtyIn - row.qtyOut, 0)), expired: !!lot.expiryDate && lot.expiryDate < new Date(), availableSerials: lot.serials.filter((row) => row.status === 'AVAILABLE').length }))
}
