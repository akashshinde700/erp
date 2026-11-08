import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError, cancelGlForVoucher, postGl, AccountCode } from './accounting'
import { EPS, fyCode, r2 } from './erp'
import { cancelLotMovementsTx, linkLotGenealogyTx, receiveLotTx } from './traceability'
import { tenantCompany } from './tenant'
import { bomUnitsPerSet, isUnitBasis } from './bom-basis'

type Tx = Prisma.TransactionClient
async function org(tx: Tx) { const row = await tenantCompany(tx); if (!row) throw new BusinessError('Operating company is not configured', 409); return row }
async function nextNo(tx: Tx, companyId: string, date: Date) { const key = `MRC-${fyCode(date)}`; const row = await tx.counter.upsert({ where: { key: `${companyId}:${key}` }, create: { key: `${companyId}:${key}`, value: 1 }, update: { value: { increment: 1 } } }); return `${key}-${String(row.value).padStart(3, '0')}` }

type WoForCosting = Prisma.WorkOrderGetPayload<{ include: { tasks: true; bom: { include: { items: true } }; productionReceipts: true } }>

/**
 * Receipt costing, shared by posting and the preview. WIP is consumed by
 * everything PRODUCED (rejected/rework/scrap used material and labour too);
 * accepted units are valued at the BOM standard, so the cost of rejected output
 * lands in manufacturing variance.
 */
function receiptCosts(wo: WoForCosting, input: { producedQty: number; acceptedQty: number }, overheadRatePct = 0) {
  const active = wo.tasks.filter((task) => task.status !== 'CANCELLED')
  const posted = wo.productionReceipts.filter((receipt) => receipt.status === 'POSTED')
  // UNIT BOM: the order is for `outputQty` finished units and every quantity on
  // the receipt is in those units. BATCH (legacy) BOM: planned output is the
  // largest task quantity, as it always was.
  const unitBasis = isUnitBasis(wo.bom)
  const planned = unitBasis ? wo.outputQty : active.length ? Math.max(...active.map((task) => task.plannedQty)) : 0
  const alreadyAccepted = r2(posted.reduce((sum, receipt) => sum + receipt.acceptedQty, 0))
  const alreadyProduced = r2(posted.reduce((sum, receipt) => sum + receipt.producedQty, 0))
  const actualTotal = r2(active.reduce((sum, task) => sum + task.materialCost + task.labourCost + task.overheadCost, 0))
  const priorSettled = r2(posted.reduce((sum, receipt) => sum + receipt.actualCost, 0))
  const remainingActual = Math.max(0, r2(actualTotal - priorSettled))
  const receiptShare = Math.min(1, input.producedQty / Math.max(EPS, planned - alreadyProduced))
  const actualCost = r2(remainingActual * receiptShare)
  const bomMaterial = wo.bom?.items.reduce((sum, line) => sum + line.estCost, 0) ?? 0
  let expectedCost: number
  let standardPerUnit: number | null = null
  if (unitBasis) {
    // Full standard per finished unit — material + routed labour + absorbed
    // overhead at the company rate — so stock carries what the unit should
    // cost and MFGV holds only the true job variance.
    const material = bomMaterial / bomUnitsPerSet(wo.bom)
    const labour = wo.bom?.standardLabourCost ?? 0
    standardPerUnit = r2(material + labour + (material + labour) * (overheadRatePct / 100))
    expectedCost = r2(standardPerUnit * input.acceptedQty)
  } else {
    // BATCH (legacy): standard on the MATERIAL basis only. `planned` is the
    // largest task quantity (kg of plate, say) while `acceptedQty` counts
    // finished pieces, so scaling the per-unit labour standard by it would mix
    // units. Labour and overhead therefore land in MFGV for these orders; use
    // GET /api/manufacturing/costing for the full per-unit comparison.
    const expectedTotal = r2(wo.bom ? bomMaterial * (wo.outputQty / bomUnitsPerSet(wo.bom)) : actualTotal)
    expectedCost = planned > EPS ? r2(expectedTotal * (input.acceptedQty / planned)) : 0
  }
  const variance = r2(actualCost - expectedCost)
  return { basis: unitBasis ? 'UNIT' : 'BATCH', standardPerUnit, planned, alreadyAccepted, alreadyProduced, actualTotal, priorSettled, remainingActual, actualCost, expectedCost, variance, wipAfter: r2(remainingActual - actualCost), tasksOpen: active.filter((t) => t.status !== 'COMPLETED').length, tasks: active.length }
}

/** What a receipt would post — shown in the wizard before the user commits. */
export async function previewProductionReceipt(input: { workOrderId: string; producedQty: number; acceptedQty: number }) {
  const wo = await db.workOrder.findUnique({ where: { id: input.workOrderId }, include: { tasks: true, bom: { include: { items: true } }, productionReceipts: true } })
  if (!wo) throw new BusinessError('Work order not found', 404)
  const company = await tenantCompany(db)
  const c = receiptCosts(wo, input, company?.overheadRatePct ?? 0)
  const warnings: string[] = []
  if (!['OPEN', 'IN_PROGRESS'].includes(wo.status)) warnings.push(`Work order is ${wo.status}`)
  if (!c.tasks || c.tasksOpen) warnings.push(`${c.tasksOpen || 'No'} operation(s) still open — complete every task first`)
  if (c.alreadyAccepted + input.acceptedQty > c.planned * 1.1 + EPS) warnings.push(`Accepted quantity exceeds planned output ${c.planned} + 10%`)
  if (c.alreadyProduced + input.producedQty + EPS < c.planned && input.producedQty > 0) warnings.push(`After this receipt ${r2(c.planned - c.alreadyProduced - input.producedQty)} of ${c.planned} remain to be produced; WIP stays open until then`)
  return { woNo: wo.woNo, ...c, warnings, closesWorkOrder: c.tasksOpen === 0 && c.wipAfter <= 0.01 && c.alreadyAccepted + input.acceptedQty > EPS }
}

/** Work-order closure readiness for every active work order. */
export async function workOrderReadiness() {
  const company = await tenantCompany(db); if (!company) throw new BusinessError('Operating company is not configured', 409)
  const wos = await db.workOrder.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { date: 'desc' }, take: 300, include: { tasks: true, bom: { include: { items: true } }, productionReceipts: true, project: { select: { projectNo: true, name: true } } } })
  return wos.map((wo) => {
    const c = receiptCosts(wo, { producedQty: 0, acceptedQty: 0 })
    const settled = c.priorSettled
    const blockers: string[] = []
    if (!c.tasks) blockers.push('No production tasks')
    if (c.tasksOpen) blockers.push(`${c.tasksOpen} task(s) open`)
    if (c.alreadyAccepted <= EPS) blockers.push('No QC-accepted FG received')
    if (Math.abs(c.actualTotal - settled) > 0.01) blockers.push(`WIP unsettled: ${r2(c.actualTotal - settled)} (material + labour + absorbed overhead)`)
    return { id: wo.id, woNo: wo.woNo, project: wo.project, status: wo.status, planned: c.planned, produced: c.alreadyProduced, accepted: c.alreadyAccepted, actualCost: c.actualTotal, settled, readyToReceive: c.tasks > 0 && c.tasksOpen === 0, readyToClose: blockers.length === 0, blockers }
  })
}

export async function postProductionReceipt(input: { workOrderId: string; outputItemId: string; warehouseId: string; date?: Date; batchNo?: string; manufacturedAt?: Date; expiryDate?: Date; producedQty: number; acceptedQty: number; rejectedQty?: number; reworkQty?: number; scrapQty?: number; qcNotes?: string; serialNumbers?: string[]; parentLots?: { parentLotId: string; consumedQty: number }[]; createdBy?: string }) {
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
    const { planned, alreadyAccepted, actualCost, expectedCost, variance } = receiptCosts(wo, input, company.overheadRatePct ?? 0)
    if (alreadyAccepted + input.acceptedQty > planned * 1.1 + EPS) throw new BusinessError(`Finished receipt exceeds planned output tolerance: planned ${planned}, already accepted ${alreadyAccepted}`)
    const date = input.date ?? new Date(), receiptNo = await nextNo(tx, company.id, date)
    const qcStatus = rejectedQty > EPS || reworkQty > EPS || scrapQty > EPS ? 'PARTIAL' : 'PASSED'
    const receipt = await tx.productionReceipt.create({ data: { companyId: company.id, receiptNo, date, workOrderId: wo.id, outputItemId: item.id, warehouseId: warehouse.id, batchNo: input.batchNo, manufacturedAt: input.manufacturedAt, expiryDate: input.expiryDate, producedQty: input.producedQty, acceptedQty: input.acceptedQty, rejectedQty, reworkQty, scrapQty, qcStatus, qcNotes: input.qcNotes, expectedCost, actualCost, variance, createdBy: input.createdBy } })
    await tx.stockLedger.create({ data: { postingDate: date, voucherType: 'MFG_RECEIPT', voucherNo: receiptNo, itemId: item.id, warehouseId: warehouse.id, qtyIn: input.acceptedQty, rate: input.acceptedQty > EPS ? r2(expectedCost / input.acceptedQty) : 0, remarks: `Finished goods from ${wo.woNo}${input.batchNo ? ` batch ${input.batchNo}` : ''}` } })
    if (input.batchNo?.trim()) {
      const lot = await receiveLotTx(tx, { itemId: item.id, warehouseId: warehouse.id, lotNo: input.batchNo, qty: input.acceptedQty, manufactureDate: input.manufacturedAt, expiryDate: input.expiryDate, sourceType: 'PRODUCTION_RECEIPT', sourceId: receipt.id, voucherType: 'MFG_RECEIPT', voucherNo: receiptNo, serialNumbers: input.serialNumbers })
      if (input.parentLots?.length) await linkLotGenealogyTx(tx, lot.id, input.parentLots)
    } else if (input.serialNumbers?.length) throw new BusinessError('A batch/lot number is required when receiving serialised finished goods')
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
    await cancelLotMovementsTx(tx, 'MFG_RECEIPT', receipt.receiptNo)
    await cancelGlForVoucher(tx, 'MFG_RECEIPT', receipt.receiptNo, new Date())
    return tx.productionReceipt.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  })
}

export async function listProductionReceipts(workOrderId?: string) {
  const company = await tenantCompany(db); if (!company) throw new BusinessError('Operating company is not configured', 409)
  return db.productionReceipt.findMany({ where: { companyId: company.id, ...(workOrderId ? { workOrderId } : {}) }, orderBy: { date: 'desc' }, include: { workOrder: { select: { woNo: true } }, outputItem: { select: { code: true, name: true, uom: true } }, warehouse: { select: { code: true, name: true } } } })
}
