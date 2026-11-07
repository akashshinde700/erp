import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError, postGl, AccountCode } from './accounting'
import { computeInvoiceTotals, fyCode, r2, EPS } from './erp'
import { cancelLotMovementsTx, receiveLotTx } from './traceability'

export type ProcurementLineInput = { itemId: string; qty: number; rate?: number; remarks?: string }
type Tx = Prisma.TransactionClient

async function contextCompany(tx: Tx) {
  const company = await tx.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } })
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  return company
}

async function nextNumber(tx: Tx, companyId: string, prefix: string, date = new Date()) {
  const displayKey = `${prefix}-${fyCode(date)}`
  const counter = await tx.counter.upsert({
    where: { key: `${companyId}:${displayKey}` },
    create: { key: `${companyId}:${displayKey}`, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${displayKey}-${String(counter.value).padStart(3, '0')}`
}

async function loadItems(tx: Tx, lines: ProcurementLineInput[]) {
  if (!lines.length) throw new BusinessError('At least one line is required')
  const rows = await tx.item.findMany({ where: { id: { in: lines.map((line) => line.itemId) }, active: true } })
  const map = new Map(rows.map((row) => [row.id, row]))
  for (const line of lines) {
    const item = map.get(line.itemId)
    if (!item) throw new BusinessError(`Item ${line.itemId} not found or inactive`, 404)
    if (!(line.qty > 0)) throw new BusinessError(`Quantity must be positive for ${item.name}`)
    if ((line.rate ?? 0) < 0) throw new BusinessError(`Rate cannot be negative for ${item.name}`)
  }
  return map
}

export async function createPurchaseRequisition(input: { date?: Date; requiredBy?: Date; department?: string; purpose?: string; createdBy?: string; lines: ProcurementLineInput[] }) {
  return db.$transaction(async (tx) => {
    const company = await contextCompany(tx)
    const items = await loadItems(tx, input.lines)
    const date = input.date ?? new Date()
    return tx.purchaseRequisition.create({
      data: {
        companyId: company.id,
        reqNo: await nextNumber(tx, company.id, 'MR', date),
        date,
        requiredBy: input.requiredBy,
        department: input.department,
        purpose: input.purpose,
        createdBy: input.createdBy,
        lines: { create: input.lines.map((line) => ({ itemId: line.itemId, qty: line.qty, uom: items.get(line.itemId)!.uom, estimatedRate: line.rate ?? items.get(line.itemId)!.costRate, remarks: line.remarks })) },
      },
      include: { lines: { include: { item: true } } },
    })
  })
}

export async function transitionRequisition(id: string, action: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'CANCEL', actor?: string) {
  return db.$transaction(async (tx) => {
    const company = await contextCompany(tx)
    const row = await tx.purchaseRequisition.findFirst({ where: { id, companyId: company.id } })
    if (!row) throw new BusinessError('Material requisition not found', 404)
    const allowed: Record<string, string[]> = { SUBMIT: ['DRAFT'], APPROVE: ['SUBMITTED'], REJECT: ['SUBMITTED'], CANCEL: ['DRAFT', 'SUBMITTED', 'APPROVED'] }
    if (!allowed[action].includes(row.status)) throw new BusinessError(`Cannot ${action.toLowerCase()} a ${row.status} requisition`)
    const status = action === 'SUBMIT' ? 'SUBMITTED' : action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'CANCELLED'
    return tx.purchaseRequisition.update({ where: { id }, data: { status, approvedBy: action === 'APPROVE' ? actor : row.approvedBy, approvedAt: action === 'APPROVE' ? new Date() : row.approvedAt } })
  })
}

export async function createPurchaseOrder(input: { supplierId: string; requisitionId?: string; date?: Date; expectedDate?: Date; overReceiptPct?: number; taxInclusive?: boolean; terms?: string; createdBy?: string; lines: ProcurementLineInput[] }) {
  return db.$transaction(async (tx) => {
    const company = await contextCompany(tx)
    const supplier = await tx.party.findFirst({ where: { id: input.supplierId, active: true } })
    if (!supplier || !supplier.types.split(',').includes('SUPPLIER')) throw new BusinessError('Active supplier not found', 404)
    const items = await loadItems(tx, input.lines)
    if (input.overReceiptPct !== undefined && (input.overReceiptPct < 0 || input.overReceiptPct > 25)) throw new BusinessError('Over-receipt tolerance must be between 0 and 25%')
    let requisition = null
    if (input.requisitionId) {
      requisition = await tx.purchaseRequisition.findFirst({ where: { id: input.requisitionId, companyId: company.id }, include: { lines: true } })
      if (!requisition || requisition.status !== 'APPROVED') throw new BusinessError('Purchase order requires an approved requisition', 409)
      for (const line of input.lines) {
        const source = requisition.lines.find((x) => x.itemId === line.itemId)
        if (!source || source.orderedQty + line.qty > source.qty + EPS) throw new BusinessError(`Order quantity exceeds approved requisition for ${items.get(line.itemId)!.name}`)
      }
    }
    const interState = supplier.stateCode !== company.stateCode
    const totals = computeInvoiceTotals(input.lines.map((line) => ({ qty: line.qty, rate: line.rate ?? items.get(line.itemId)!.costRate, discPct: 0, gstRate: items.get(line.itemId)!.gstRate })), { taxInclusive: input.taxInclusive ?? false, interState })
    const date = input.date ?? new Date()
    const order = await tx.purchaseOrder.create({
      data: {
        companyId: company.id, poNo: await nextNumber(tx, company.id, 'PO', date), date, supplierId: supplier.id,
        requisitionId: requisition?.id, expectedDate: input.expectedDate, overReceiptPct: input.overReceiptPct ?? 0,
        taxInclusive: input.taxInclusive ?? false, subtotal: totals.taxable, taxAmount: r2(totals.cgst + totals.sgst + totals.igst), grandTotal: totals.grandTotal,
        terms: input.terms, createdBy: input.createdBy,
        lines: { create: input.lines.map((line, i) => ({ itemId: line.itemId, qty: line.qty, uom: items.get(line.itemId)!.uom, rate: line.rate ?? items.get(line.itemId)!.costRate, gstRate: items.get(line.itemId)!.gstRate, amount: totals.lines[i].total, remarks: line.remarks })) },
      }, include: { lines: { include: { item: true } }, supplier: true },
    })
    if (requisition) {
      for (const line of input.lines) await tx.purchaseRequisitionLine.updateMany({ where: { requisitionId: requisition.id, itemId: line.itemId }, data: { orderedQty: { increment: line.qty } } })
    }
    return order
  })
}

export async function approvePurchaseOrder(id: string, actor?: string) {
  return db.$transaction(async (tx) => {
    const company = await contextCompany(tx)
    const order = await tx.purchaseOrder.findFirst({ where: { id, companyId: company.id } })
    if (!order) throw new BusinessError('Purchase order not found', 404)
    if (order.status !== 'DRAFT') throw new BusinessError(`Only draft purchase orders can be approved; current status is ${order.status}`)
    return tx.purchaseOrder.update({ where: { id }, data: { status: 'APPROVED', approvedBy: actor, approvedAt: new Date() } })
  })
}

export async function createGoodsReceipt(input: { purchaseOrderId: string; warehouseId: string; supplierDocNo?: string; supplierDocDate?: Date; date?: Date; remarks?: string; createdBy?: string; lines: { purchaseOrderLineId: string; receivedQty: number; batchNo?: string; manufactureDate?: Date; expiryDate?: Date }[] }) {
  return db.$transaction(async (tx) => {
    const company = await contextCompany(tx)
    const order = await tx.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, companyId: company.id }, include: { lines: true } })
    if (!order) throw new BusinessError('Purchase order not found', 404)
    if (!['APPROVED', 'PART_RECEIVED'].includes(order.status)) throw new BusinessError(`Cannot receive against a ${order.status} purchase order`)
    const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, active: true } })
    if (!warehouse) throw new BusinessError('Receiving warehouse not found or inactive', 404)
    if (!input.lines.length) throw new BusinessError('At least one receipt line is required')
    const seen = new Set<string>()
    for (const line of input.lines) {
      if (seen.has(line.purchaseOrderLineId)) throw new BusinessError('A PO line may occur only once in a GRN')
      seen.add(line.purchaseOrderLineId)
      const poLine = order.lines.find((row) => row.id === line.purchaseOrderLineId)
      if (!poLine) throw new BusinessError('GRN line does not belong to the selected purchase order')
      if (!(line.receivedQty > 0)) throw new BusinessError('Received quantity must be positive')
      const cap = poLine.qty * (1 + order.overReceiptPct / 100)
      if (poLine.receivedQty + line.receivedQty > cap + EPS) throw new BusinessError(`Receipt exceeds PO quantity/tolerance for line ${poLine.id}`)
      if (line.expiryDate && line.manufactureDate && line.expiryDate <= line.manufactureDate) throw new BusinessError('Expiry date must be after manufacture date')
    }
    const date = input.date ?? new Date()
    const grn = await tx.goodsReceipt.create({
      data: { companyId: company.id, grnNo: await nextNumber(tx, company.id, 'GRN', date), date, purchaseOrderId: order.id, supplierDocNo: input.supplierDocNo, supplierDocDate: input.supplierDocDate, warehouseId: warehouse.id, remarks: input.remarks, createdBy: input.createdBy,
        lines: { create: input.lines.map((line) => ({ ...line, itemId: order.lines.find((row) => row.id === line.purchaseOrderLineId)!.itemId })) } },
      include: { lines: { include: { item: true, purchaseOrderLine: true } } },
    })
    for (const line of input.lines) await tx.purchaseOrderLine.update({ where: { id: line.purchaseOrderLineId }, data: { receivedQty: { increment: line.receivedQty } } })
    const receivedNow = new Map(input.lines.map((line) => [line.purchaseOrderLineId, line.receivedQty]))
    const fullyReceived = order.lines.every((line) => line.receivedQty + (receivedNow.get(line.id) ?? 0) + EPS >= line.qty)
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: fullyReceived ? 'RECEIVED' : 'PART_RECEIVED' } })
    return grn
  })
}

export async function inspectGoodsReceipt(input: { goodsReceiptId: string; actor?: string; notes?: string; lines: { goodsReceiptLineId: string; acceptedQty: number; rejectedQty: number; rejectionReason?: string; results?: unknown }[] }) {
  return db.$transaction(async (tx) => {
    const company = await contextCompany(tx)
    const grn = await tx.goodsReceipt.findFirst({ where: { id: input.goodsReceiptId, companyId: company.id }, include: { lines: { include: { purchaseOrderLine: true, item: true } } } })
    if (!grn) throw new BusinessError('Goods receipt not found', 404)
    if (grn.status !== 'PENDING_QC') throw new BusinessError(`Goods receipt is already ${grn.status}`)
    if (input.lines.length !== grn.lines.length) throw new BusinessError('Every GRN line must be inspected')
    let acceptedTotal = 0, rejectedTotal = 0
    for (const decision of input.lines) {
      const line = grn.lines.find((row) => row.id === decision.goodsReceiptLineId)
      if (!line) throw new BusinessError('Inspection line does not belong to this GRN')
      if (decision.acceptedQty < 0 || decision.rejectedQty < 0 || Math.abs(decision.acceptedQty + decision.rejectedQty - line.receivedQty) > EPS) throw new BusinessError(`Accepted + rejected must equal received quantity for ${line.item.name}`)
      if (decision.rejectedQty > EPS && !decision.rejectionReason?.trim()) throw new BusinessError(`Rejection reason is required for ${line.item.name}`)
      acceptedTotal += decision.acceptedQty; rejectedTotal += decision.rejectedQty
      const status = decision.acceptedQty > EPS && decision.rejectedQty > EPS ? 'PARTIAL' : decision.acceptedQty > EPS ? 'PASSED' : 'FAILED'
      await tx.goodsReceiptLine.update({ where: { id: line.id }, data: { acceptedQty: decision.acceptedQty, rejectedQty: decision.rejectedQty, qcStatus: status, rejectionReason: decision.rejectionReason } })
      await tx.purchaseOrderLine.update({ where: { id: line.purchaseOrderLineId }, data: { acceptedQty: { increment: decision.acceptedQty }, rejectedQty: { increment: decision.rejectedQty } } })
      if (decision.acceptedQty > EPS && line.item.isStockItem && !line.item.isService) {
        await tx.stockLedger.create({ data: { postingDate: new Date(), voucherType: 'GRN', voucherNo: grn.grnNo, itemId: line.itemId, warehouseId: grn.warehouseId, qtyIn: decision.acceptedQty, rate: line.purchaseOrderLine.rate, remarks: `QC-accepted receipt ${grn.grnNo}${line.batchNo ? ` batch ${line.batchNo}` : ''}` } })
        if (line.batchNo?.trim()) await receiveLotTx(tx, { itemId: line.itemId, warehouseId: grn.warehouseId, lotNo: line.batchNo, qty: decision.acceptedQty, manufactureDate: line.manufactureDate, expiryDate: line.expiryDate, sourceType: 'GOODS_RECEIPT_LINE', sourceId: line.id, voucherType: 'GRN', voucherNo: grn.grnNo, status: 'AVAILABLE' })
      }
      await tx.qualityInspection.create({ data: { companyId: company.id, inspectionNo: await nextNumber(tx, company.id, 'QC'), inspectionType: 'INWARD', referenceType: 'GOODS_RECEIPT_LINE', referenceId: line.id, goodsReceiptId: grn.id, goodsReceiptLineId: line.id, status, inspectedBy: input.actor, inspectedAt: new Date(), disposition: decision.rejectedQty > EPS ? 'QUARANTINE' : 'ACCEPT', resultsJson: decision.results ? JSON.stringify(decision.results) : null, notes: decision.rejectionReason } })
    }
    const status = acceptedTotal > EPS && rejectedTotal > EPS ? 'PART_ACCEPTED' : acceptedTotal > EPS ? 'ACCEPTED' : 'REJECTED'
    return tx.goodsReceipt.update({ where: { id: grn.id }, data: { status, postedAt: new Date(), remarks: input.notes ?? grn.remarks }, include: { lines: true, inspections: true } })
  })
}

export async function invoiceAcceptedReceipt(input: { goodsReceiptId: string; supplierInvoiceNo: string; date?: Date; taxInclusive?: boolean; remarks?: string; lines: { goodsReceiptLineId: string; qty: number; rate?: number }[] }) {
  return db.$transaction(async (tx) => {
    const company = await contextCompany(tx)
    const grn = await tx.goodsReceipt.findFirst({
      where: { id: input.goodsReceiptId, companyId: company.id },
      include: { purchaseOrder: { include: { supplier: true } }, lines: { include: { item: true, purchaseOrderLine: true } } },
    })
    if (!grn) throw new BusinessError('Goods receipt not found', 404)
    const supplierInvoiceNo = input.supplierInvoiceNo.trim()
    if (!supplierInvoiceNo) throw new BusinessError('Supplier invoice number is required')
    const duplicate = await tx.purchaseInvoice.findFirst({ where: { partyId: grn.purchaseOrder.supplierId, supplierInvoiceNo, status: { not: 'CANCELLED' } }, select: { invoiceNo: true } })
    if (duplicate) throw new BusinessError(`Supplier invoice ${supplierInvoiceNo} is already posted as ${duplicate.invoiceNo}`, 409)
    if (!['ACCEPTED', 'PART_ACCEPTED'].includes(grn.status)) throw new BusinessError('Only a QC-accepted receipt can be invoiced')
    if (!input.lines.length) throw new BusinessError('At least one invoice line is required')
    const seen = new Set<string>()
    const selected = input.lines.map((requested) => {
      if (seen.has(requested.goodsReceiptLineId)) throw new BusinessError('A GRN line may occur only once on an invoice')
      seen.add(requested.goodsReceiptLineId)
      const line = grn.lines.find((row) => row.id === requested.goodsReceiptLineId)
      if (!line) throw new BusinessError('Invoice line does not belong to the selected GRN')
      if (!(requested.qty > 0)) throw new BusinessError(`Billing quantity must be positive for ${line.item.name}`)
      if (line.billedQty + requested.qty > line.acceptedQty + EPS) throw new BusinessError(`Billing quantity exceeds unbilled QC-accepted quantity for ${line.item.name}`)
      const rate = requested.rate ?? line.purchaseOrderLine.rate
      if (rate < 0) throw new BusinessError(`Rate cannot be negative for ${line.item.name}`)
      return { requested, line, rate }
    })
    const interState = grn.purchaseOrder.supplier.stateCode !== company.stateCode
    const taxInclusive = input.taxInclusive ?? grn.purchaseOrder.taxInclusive
    const totals = computeInvoiceTotals(selected.map(({ requested, line, rate }) => ({ qty: requested.qty, rate, discPct: 0, gstRate: line.purchaseOrderLine.gstRate })), { taxInclusive, interState })
    const date = input.date ?? new Date()
    const invoiceNo = await nextNumber(tx, company.id, 'PIN', date)
    const invoice = await tx.purchaseInvoice.create({
      data: {
        invoiceNo, date, partyId: grn.purchaseOrder.supplierId, poNo: grn.purchaseOrder.poNo, supplierInvoiceNo, interState, taxInclusive,
        taxable: totals.taxable, discount: totals.discount, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst,
        roundOff: totals.roundOff, grandTotal: totals.grandTotal, remarks: input.remarks, goodsReceiptId: grn.id,
        items: { create: selected.map(({ requested, line, rate }, index) => ({
          itemId: line.itemId, detail: `GRN ${grn.grnNo}`, hsn: line.item.hsn, uom: line.item.uom,
          qty: requested.qty, rate, discPct: 0, discAmt: totals.lines[index].discAmt, taxable: totals.lines[index].taxable,
          gstRate: line.purchaseOrderLine.gstRate, cgst: totals.lines[index].cgst, sgst: totals.lines[index].sgst,
          igst: totals.lines[index].igst, total: totals.lines[index].total, goodsReceiptLineId: line.id,
        })) },
      }, include: { items: true },
    })
    for (const { requested, line } of selected) {
      const updated = await tx.goodsReceiptLine.updateMany({
        where: { id: line.id, billedQty: { gte: r2(line.billedQty - 0.0001), lte: r2(line.billedQty + 0.0001) } },
        data: { billedQty: r2(line.billedQty + requested.qty) },
      })
      if (updated.count !== 1) throw new BusinessError('GRN billing changed concurrently; refresh and retry', 409)
      await tx.purchaseOrderLine.update({ where: { id: line.purchaseOrderLineId }, data: { billedQty: { increment: requested.qty } } })
    }
    const gl: Parameters<typeof postGl>[2] = [
      { account: 'PURC' as AccountCode, debit: totals.taxable },
      { account: 'CGSTI' as AccountCode, debit: totals.cgst },
      { account: 'SGSTI' as AccountCode, debit: totals.sgst },
      { account: 'IGSTI' as AccountCode, debit: totals.igst },
      { account: 'CRED' as AccountCode, partyId: grn.purchaseOrder.supplierId, credit: totals.grandTotal, remarks: `Invoice ${invoiceNo} against ${grn.grnNo}` },
    ]
    if (Math.abs(totals.roundOff) > 0.004) gl.push(totals.roundOff > 0 ? { account: 'RND' as AccountCode, credit: totals.roundOff } : { account: 'RND' as AccountCode, debit: -totals.roundOff })
    await postGl(tx, { date, voucherType: 'PURCHASE_INVOICE', voucherNo: invoiceNo }, gl)
    return invoice
  })
}

export async function cancelGoodsReceipt(id: string) {
  return db.$transaction(async (tx) => {
    const company = await contextCompany(tx)
    const grn = await tx.goodsReceipt.findFirst({ where: { id, companyId: company.id }, include: { lines: { include: { item: true } } } })
    if (!grn) throw new BusinessError('Goods receipt not found', 404)
    if (grn.status === 'CANCELLED') throw new BusinessError('Goods receipt is already cancelled')
    if (grn.lines.some((line) => line.billedQty > EPS)) throw new BusinessError('GRN has billed quantities; cancel the linked purchase invoice first')
    for (const line of grn.lines) {
      if (line.acceptedQty <= EPS || line.item.isService || !line.item.isStockItem) continue
      const stock = await tx.stockLedger.aggregate({ where: { itemId: line.itemId, warehouseId: grn.warehouseId, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
      const available = r2((stock._sum.qtyIn ?? 0) - (stock._sum.qtyOut ?? 0))
      if (available + EPS < line.acceptedQty) throw new BusinessError(`Cannot cancel ${grn.grnNo}: ${line.item.name} stock has already been consumed/sold`)
    }
    const originals = await tx.stockLedger.findMany({ where: { voucherType: 'GRN', voucherNo: grn.grnNo, isCancelled: false } })
    for (const row of originals) await tx.stockLedger.create({ data: { postingDate: new Date(), voucherType: 'GRN', voucherNo: grn.grnNo, itemId: row.itemId, warehouseId: row.warehouseId, qtyIn: 0, qtyOut: row.qtyIn, rate: row.rate, remarks: `Reversal of ${grn.grnNo}`, isCancelled: true } })
    await tx.stockLedger.updateMany({ where: { voucherType: 'GRN', voucherNo: grn.grnNo, isCancelled: false }, data: { isCancelled: true } })
    await cancelLotMovementsTx(tx, 'GRN', grn.grnNo)
    for (const line of grn.lines) await tx.purchaseOrderLine.update({ where: { id: line.purchaseOrderLineId }, data: { receivedQty: { decrement: line.receivedQty }, acceptedQty: { decrement: line.acceptedQty }, rejectedQty: { decrement: line.rejectedQty } } })
    await tx.qualityInspection.updateMany({ where: { goodsReceiptId: grn.id }, data: { status: 'CANCELLED' } })
    await tx.purchaseOrder.update({ where: { id: grn.purchaseOrderId }, data: { status: 'PART_RECEIVED' } })
    return tx.goodsReceipt.update({ where: { id: grn.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  })
}

export async function procurementDashboard() {
  const company = await db.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } })
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  const [requisitions, orders, receipts, controlledInvoices] = await Promise.all([
    db.purchaseRequisition.findMany({ where: { companyId: company.id }, orderBy: { date: 'desc' }, include: { lines: { include: { item: true } } } }),
    db.purchaseOrder.findMany({ where: { companyId: company.id }, orderBy: { date: 'desc' }, include: { supplier: true, lines: { include: { item: true } } } }),
    db.goodsReceipt.findMany({ where: { companyId: company.id }, orderBy: { date: 'desc' }, include: { purchaseOrder: true, lines: { include: { item: true, purchaseOrderLine: true } } } }),
    db.purchaseInvoice.findMany({ where: { goodsReceiptId: { not: null }, status: 'POSTED' }, include: { items: true } }),
  ])
  const invoiceLines = controlledInvoices.flatMap((invoice) => invoice.items.map((line) => ({ ...line, invoiceNo: invoice.invoiceNo, supplierInvoiceNo: invoice.supplierInvoiceNo })))
  const matchExceptions = receipts.flatMap((receipt) => receipt.lines.flatMap((line) => {
    const billed = invoiceLines.filter((invoiceLine) => invoiceLine.goodsReceiptLineId === line.id)
    const billedQty = r2(billed.reduce((sum, row) => sum + row.qty, 0))
    const rateVariance = billed.map((row) => r2(row.rate - line.purchaseOrderLine.rate)).filter((variance) => Math.abs(variance) > 0.004)
    if (Math.abs(billedQty - line.acceptedQty) <= EPS && rateVariance.length === 0) return []
    return [{ grnNo: receipt.grnNo, itemCode: line.item.code, acceptedQty: line.acceptedQty, billedQty, quantityVariance: r2(billedQty - line.acceptedQty), rateVariance, invoices: billed.map((row) => row.supplierInvoiceNo || row.invoiceNo) }]
  }))
  return { requisitions, orders, receipts, matchExceptions }
}
