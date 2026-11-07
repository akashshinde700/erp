import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError, cancelGlForVoucher, postGl, AccountCode } from './accounting'
import { EPS, fyCode, r2 } from './erp'

type Tx = Prisma.TransactionClient
async function org(tx: Tx) { const row = await tx.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } }); if (!row) throw new BusinessError('Operating company is not configured', 409); return row }
async function nextNo(tx: Tx, companyId: string, date: Date) { const key = `MRC-${fyCode(date)}`; const row = await tx.counter.upsert({ where: { key: `${companyId}:${key}` }, create: { key: `${companyId}:${key}`, value: 1 }, update: { value: { increment: 1 } } }); return `${key}-${String(row.value).padStart(3, '0')}` }

export async function postProductionReceipt(input: { workOrderId: string; outputItemId: string; warehouseId: string; date?: Date; batchNo?: string; manufacturedAt?: Date; expiryDate?: Date; producedQty: number; acceptedQty: number; rejectedQty?: number; reworkQty?: number; scrapQty?: number; qcNotes?: string; createdBy?: string }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const wo = await tx.workOrder.findUnique({ where: { id: input.workOrderId }, include: { tasks: true, bom: { include: { items: true } }, productionReceipts: { where: { status: 'POSTED' } } } })
    if (!wo || !['OPEN', 'IN_PROGRESS'].includes(wo.status)) throw new BusinessError('Active work order not found', 404)
    const active = wo.tasks.filter((task) => task.status !== 'CANCELLED')
    if (!active.length || active.some((task) => task.status !== 'COMPLETED')) throw new BusinessError('Complete every active operation before receiving finished goods')
    const item = await tx.item.findFirst({ where: { id: input.outputItemId, active: true, isStockItem: true, isService: false } })
    if (!item) throw new BusinessError('Active finished-goods stock item not found', 404)
    const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, active: true } }); if (!warehouse) throw new BusinessError('Finished-goods warehouse not found', 404)
    const rejectedQty = input.rejectedQty ?? 0, reworkQty = input.reworkQty ?? 0, scrapQty = input.scrapQty ?? 0
    if (!(input.producedQty > 0) || [input.acceptedQty, rejectedQty, reworkQty, scrapQty].some((qty) => qty < 0)) throw new BusinessError('Production/QC quantities cannot be negative and produced quantity must be positive')
    if (Math.abs(input.acceptedQty + rejectedQty + reworkQty + scrapQty - input.producedQty) > EPS) throw new BusinessError('Accepted + rejected + rework + scrap must equal produced quantity')
    if (input.acceptedQty <= EPS) throw new BusinessError('At least one finished unit must pass QC before stock receipt')
    if ((rejectedQty > EPS || reworkQty > EPS || scrapQty > EPS) && !input.qcNotes?.trim()) throw new BusinessError('QC notes are required for rejection, rework or scrap')
    if (input.expiryDate && input.manufacturedAt && input.expiryDate <= input.manufacturedAt) throw new BusinessError('Expiry date must be after manufacture date')
    const planned = Math.max(...active.map((task) => task.plannedQty))
    const alreadyAccepted = wo.productionReceipts.reduce((sum, receipt) => sum + receipt.acceptedQty, 0)
    if (alreadyAccepted + input.acceptedQty > planned * 1.1 + EPS) throw new BusinessError(`Finished receipt exceeds planned output tolerance: planned ${planned}, already accepted ${alreadyAccepted}`)
    const actualTotal = r2(active.reduce((sum, task) => sum + task.materialCost + task.labourCost, 0))
    const priorSettled = r2(wo.productionReceipts.reduce((sum, receipt) => sum + receipt.actualCost, 0))
    const remainingActual = Math.max(0, r2(actualTotal - priorSettled))
    const receiptShare = Math.min(1, input.acceptedQty / Math.max(EPS, planned - alreadyAccepted))
    const actualCost = r2(remainingActual * receiptShare)
    const expectedTotal = r2(wo.bom?.items.reduce((sum, line) => sum + line.estCost, 0) ?? actualTotal)
    const expectedCost = r2(expectedTotal * (input.acceptedQty / planned))
    const variance = r2(actualCost - expectedCost)
    const date = input.date ?? new Date(), receiptNo = await nextNo(tx, company.id, date)
    const qcStatus = rejectedQty > EPS || reworkQty > EPS || scrapQty > EPS ? 'PARTIAL' : 'PASSED'
    const receipt = await tx.productionReceipt.create({ data: { companyId: company.id, receiptNo, date, workOrderId: wo.id, outputItemId: item.id, warehouseId: warehouse.id, batchNo: input.batchNo, manufacturedAt: input.manufacturedAt, expiryDate: input.expiryDate, producedQty: input.producedQty, acceptedQty: input.acceptedQty, rejectedQty, reworkQty, scrapQty, qcStatus, qcNotes: input.qcNotes, expectedCost, actualCost, variance, createdBy: input.createdBy } })
    await tx.stockLedger.create({ data: { postingDate: date, voucherType: 'MFG_RECEIPT', voucherNo: receiptNo, itemId: item.id, warehouseId: warehouse.id, qtyIn: input.acceptedQty, rate: input.acceptedQty > EPS ? r2(expectedCost / input.acceptedQty) : 0, remarks: `Finished goods from ${wo.woNo}${input.batchNo ? ` batch ${input.batchNo}` : ''}` } })
    const gl: Parameters<typeof postGl>[2] = [{ account: 'STKV' as AccountCode, debit: expectedCost }, { account: 'WIP' as AccountCode, credit: actualCost }]
    if (variance > EPS) gl.push({ account: 'MFGV' as AccountCode, debit: variance })
    else if (variance < -EPS) gl.push({ account: 'MFGV' as AccountCode, credit: -variance })
    await postGl(tx, { date, voucherType: 'MFG_RECEIPT', voucherNo: receiptNo }, gl)
    return receipt
  })
}

export async function cancelProductionReceipt(id: string) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const receipt = await tx.productionReceipt.findFirst({ where: { id, companyId: company.id } })
    if (!receipt || receipt.status !== 'POSTED') throw new BusinessError('Active production receipt not found', 404)
    const stock = await tx.stockLedger.aggregate({ where: { itemId: receipt.outputItemId, warehouseId: receipt.warehouseId, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
    if (r2((stock._sum.qtyIn ?? 0) - (stock._sum.qtyOut ?? 0)) + EPS < receipt.acceptedQty) throw new BusinessError('Finished goods were already consumed/sold; receipt cancellation is blocked')
    const rows = await tx.stockLedger.findMany({ where: { voucherType: 'MFG_RECEIPT', voucherNo: receipt.receiptNo, isCancelled: false } })
    for (const row of rows) await tx.stockLedger.create({ data: { postingDate: new Date(), voucherType: 'MFG_RECEIPT', voucherNo: receipt.receiptNo, itemId: row.itemId, warehouseId: row.warehouseId, qtyOut: row.qtyIn, rate: row.rate, remarks: `Reversal of ${receipt.receiptNo}`, isCancelled: true } })
    await tx.stockLedger.updateMany({ where: { voucherType: 'MFG_RECEIPT', voucherNo: receipt.receiptNo, isCancelled: false }, data: { isCancelled: true } })
    await cancelGlForVoucher(tx, 'MFG_RECEIPT', receipt.receiptNo, new Date())
    return tx.productionReceipt.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  })
}

export async function listProductionReceipts(workOrderId?: string) {
  const company = await db.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } }); if (!company) throw new BusinessError('Operating company is not configured', 409)
  return db.productionReceipt.findMany({ where: { companyId: company.id, ...(workOrderId ? { workOrderId } : {}) }, orderBy: { date: 'desc' }, include: { workOrder: { select: { woNo: true } }, outputItem: { select: { code: true, name: true, uom: true } }, warehouse: { select: { code: true, name: true } } } })
}
