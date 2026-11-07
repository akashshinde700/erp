import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError, postGl, AccountCode } from './accounting'
import { computeInvoiceTotals, EPS, fyCode, r2 } from './erp'

type Tx = Prisma.TransactionClient
type Line = { itemId: string; qty: number; rate: number; discountPct?: number; remarks?: string }

async function org(tx: Tx) {
  const row = await tx.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } })
  if (!row) throw new BusinessError('Operating company is not configured', 409)
  return row
}
async function number(tx: Tx, companyId: string, prefix: string, date: Date) {
  const key = `${prefix}-${fyCode(date)}`
  const row = await tx.counter.upsert({ where: { key: `${companyId}:${key}` }, create: { key: `${companyId}:${key}`, value: 1 }, update: { value: { increment: 1 } } })
  return `${key}-${String(row.value).padStart(3, '0')}`
}
async function items(tx: Tx, lines: Line[]) {
  if (!lines.length) throw new BusinessError('At least one line is required')
  const rows = await tx.item.findMany({ where: { id: { in: lines.map((line) => line.itemId) }, active: true } })
  const map = new Map(rows.map((row) => [row.id, row]))
  for (const line of lines) {
    const item = map.get(line.itemId)
    if (!item) throw new BusinessError(`Item ${line.itemId} not found`, 404)
    if (!(line.qty > 0) || line.rate < 0) throw new BusinessError(`Invalid quantity/rate for ${item.name}`)
  }
  return map
}

export async function createQuotation(input: { partyId: string; date?: Date; validUntil: Date; terms?: string; createdBy?: string; lines: Line[] }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const date = input.date ?? new Date()
    const party = await tx.party.findFirst({ where: { id: input.partyId, active: true } })
    if (!party || !party.types.split(',').includes('CUSTOMER')) throw new BusinessError('Active customer not found', 404)
    if (input.validUntil < date) throw new BusinessError('Quotation validity cannot end before quotation date')
    const map = await items(tx, input.lines)
    const totals = computeInvoiceTotals(input.lines.map((line) => ({ qty: line.qty, rate: line.rate, discPct: line.discountPct ?? 0, gstRate: map.get(line.itemId)!.gstRate })), { taxInclusive: false, interState: party.stateCode !== company.stateCode })
    return tx.salesQuotation.create({ data: { companyId: company.id, quotationNo: await number(tx, company.id, 'QT', date), date, validUntil: input.validUntil, partyId: party.id, taxable: totals.taxable, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, grandTotal: totals.grandTotal, terms: input.terms, createdBy: input.createdBy,
      lines: { create: input.lines.map((line, index) => ({ itemId: line.itemId, qty: line.qty, uom: map.get(line.itemId)!.uom, rate: line.rate, discountPct: line.discountPct ?? 0, gstRate: map.get(line.itemId)!.gstRate, taxable: totals.lines[index].taxable, total: totals.lines[index].total, remarks: line.remarks })) } }, include: { party: true, lines: { include: { item: true } } } })
  })
}

export async function reviseQuotation(id: string, input: { validUntil: Date; terms?: string; createdBy?: string; lines: Line[] }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const old = await tx.salesQuotation.findFirst({ where: { id, companyId: company.id }, include: { party: true } })
    if (!old || ['ACCEPTED', 'CANCELLED', 'SUPERSEDED'].includes(old.status)) throw new BusinessError('Quotation cannot be revised', 409)
    const map = await items(tx, input.lines)
    const totals = computeInvoiceTotals(input.lines.map((line) => ({ qty: line.qty, rate: line.rate, discPct: line.discountPct ?? 0, gstRate: map.get(line.itemId)!.gstRate })), { taxInclusive: false, interState: old.party.stateCode !== company.stateCode })
    const revision = await tx.salesQuotation.create({ data: { companyId: company.id, quotationNo: old.quotationNo, revisionNo: old.revisionNo + 1, supersedesId: old.id, date: new Date(), validUntil: input.validUntil, partyId: old.partyId, taxable: totals.taxable, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, grandTotal: totals.grandTotal, terms: input.terms, createdBy: input.createdBy,
      lines: { create: input.lines.map((line, index) => ({ itemId: line.itemId, qty: line.qty, uom: map.get(line.itemId)!.uom, rate: line.rate, discountPct: line.discountPct ?? 0, gstRate: map.get(line.itemId)!.gstRate, taxable: totals.lines[index].taxable, total: totals.lines[index].total, remarks: line.remarks })) } }, include: { lines: true } })
    await tx.salesQuotation.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } })
    return revision
  })
}

export async function transitionQuotation(id: string, action: 'SUBMIT' | 'APPROVE' | 'REJECT', actor?: string) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const quote = await tx.salesQuotation.findFirst({ where: { id, companyId: company.id } })
    if (!quote) throw new BusinessError('Quotation not found', 404)
    const allowed = action === 'SUBMIT' ? quote.status === 'DRAFT' : ['APPROVE', 'REJECT'].includes(action) && quote.status === 'SUBMITTED'
    if (!allowed) throw new BusinessError(`Cannot ${action.toLowerCase()} a ${quote.status} quotation`)
    if (action === 'APPROVE' && quote.validUntil < new Date()) throw new BusinessError('Expired quotation cannot be approved')
    return tx.salesQuotation.update({ where: { id }, data: { status: action === 'SUBMIT' ? 'SUBMITTED' : action === 'APPROVE' ? 'APPROVED' : 'REJECTED', approvedBy: action === 'APPROVE' ? actor : undefined, approvedAt: action === 'APPROVE' ? new Date() : undefined } })
  })
}

export async function quotationToOrder(id: string, input: { deliveryDate?: Date; customerPoNo?: string; actor?: string }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const quote = await tx.salesQuotation.findFirst({ where: { id, companyId: company.id }, include: { lines: true } })
    if (!quote || quote.status !== 'APPROVED') throw new BusinessError('Only an approved quotation can become a sales order')
    if (quote.validUntil < new Date()) throw new BusinessError('Quotation has expired')
    const existing = await tx.salesOrder.findFirst({ where: { quotationId: quote.id, status: { not: 'CANCELLED' } } })
    if (existing) throw new BusinessError(`Quotation is already linked to ${existing.orderNo}`, 409)
    const date = new Date()
    const order = await tx.salesOrder.create({ data: { companyId: company.id, orderNo: await number(tx, company.id, 'SO', date), date, deliveryDate: input.deliveryDate, partyId: quote.partyId, quotationId: quote.id, customerPoNo: input.customerPoNo, taxable: quote.taxable, taxAmount: r2(quote.cgst + quote.sgst + quote.igst), grandTotal: quote.grandTotal, createdBy: input.actor,
      lines: { create: quote.lines.map((line) => ({ itemId: line.itemId, qty: line.qty, uom: line.uom, rate: line.rate, gstRate: line.gstRate, taxable: line.taxable, total: line.total, remarks: line.remarks })) } }, include: { lines: true, party: true } })
    await tx.salesQuotation.update({ where: { id: quote.id }, data: { status: 'ACCEPTED' } })
    return order
  })
}

export async function approveSalesOrder(id: string, actor?: string) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const order = await tx.salesOrder.findFirst({ where: { id, companyId: company.id }, include: { party: true } })
    if (!order) throw new BusinessError('Sales order not found', 404)
    if (order.status !== 'DRAFT') throw new BusinessError('Only draft sales orders can be approved')
    if (order.party.creditLimit > EPS) {
      const invoices = await tx.salesInvoice.findMany({ where: { partyId: order.partyId, status: 'POSTED' }, select: { grandTotal: true, paidAmount: true } })
      const exposure = r2(Math.max(0, order.party.openingBal) + invoices.reduce((sum, invoice) => sum + invoice.grandTotal - invoice.paidAmount, 0))
      if (exposure + order.grandTotal > order.party.creditLimit + EPS) throw new BusinessError(`Credit limit exceeded: current exposure ${exposure}, order ${order.grandTotal}, limit ${order.party.creditLimit}`, 409)
    }
    return tx.salesOrder.update({ where: { id }, data: { status: 'APPROVED', creditApproved: true, approvedBy: actor, approvedAt: new Date() } })
  })
}

export async function createDeliveryChallan(input: { salesOrderId: string; warehouseId: string; date?: Date; vehicleNo?: string; transporter?: string; createdBy?: string; lines: { salesOrderLineId: string; qty: number; batchNo?: string }[] }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const order = await tx.salesOrder.findFirst({ where: { id: input.salesOrderId, companyId: company.id }, include: { lines: { include: { item: true } } } })
    if (!order || !['APPROVED', 'PART_DISPATCHED'].includes(order.status)) throw new BusinessError('Approved sales order not found', 404)
    const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, active: true } }); if (!warehouse) throw new BusinessError('Dispatch warehouse not found', 404)
    if (!input.lines.length) throw new BusinessError('At least one challan line is required')
    const seen = new Set<string>()
    for (const requested of input.lines) {
      if (seen.has(requested.salesOrderLineId)) throw new BusinessError('An order line may occur only once per challan'); seen.add(requested.salesOrderLineId)
      const line = order.lines.find((row) => row.id === requested.salesOrderLineId); if (!line) throw new BusinessError('Challan line does not belong to sales order')
      if (!(requested.qty > 0) || line.dispatchedQty + requested.qty > line.qty + EPS) throw new BusinessError(`Dispatch exceeds pending order quantity for ${line.item.name}`)
      if (!line.item.isService && line.item.isStockItem) {
        const stock = await tx.stockLedger.aggregate({ where: { itemId: line.itemId, warehouseId: warehouse.id, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
        if (r2((stock._sum.qtyIn ?? 0) - (stock._sum.qtyOut ?? 0)) + EPS < requested.qty) throw new BusinessError(`Insufficient stock for ${line.item.name}`)
      }
    }
    const date = input.date ?? new Date()
    return tx.deliveryChallan.create({ data: { companyId: company.id, challanNo: await number(tx, company.id, 'DC', date), date, salesOrderId: order.id, warehouseId: warehouse.id, vehicleNo: input.vehicleNo, transporter: input.transporter, createdBy: input.createdBy,
      lines: { create: input.lines.map((requested) => ({ salesOrderLineId: requested.salesOrderLineId, itemId: order.lines.find((line) => line.id === requested.salesOrderLineId)!.itemId, plannedQty: requested.qty, batchNo: requested.batchNo })) } }, include: { lines: { include: { item: true } } } })
  })
}

export async function inspectAndDispatch(input: { deliveryChallanId: string; actor?: string; lines: { deliveryChallanLineId: string; acceptedQty: number; rejectedQty: number; qcNotes?: string }[] }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const dc = await tx.deliveryChallan.findFirst({ where: { id: input.deliveryChallanId, companyId: company.id }, include: { salesOrder: { include: { lines: true } }, lines: { include: { item: true } } } })
    if (!dc || dc.status !== 'PENDING_QC') throw new BusinessError('Pending dispatch QC document not found', 404)
    if (input.lines.length !== dc.lines.length) throw new BusinessError('Every delivery line must be inspected')
    let acceptedTotal = 0
    for (const result of input.lines) {
      const line = dc.lines.find((row) => row.id === result.deliveryChallanLineId); if (!line) throw new BusinessError('QC line does not belong to challan')
      if (result.acceptedQty < 0 || result.rejectedQty < 0 || Math.abs(result.acceptedQty + result.rejectedQty - line.plannedQty) > EPS) throw new BusinessError(`Accepted + rejected must equal planned quantity for ${line.item.name}`)
      if (result.rejectedQty > EPS && !result.qcNotes?.trim()) throw new BusinessError(`QC notes required for rejected ${line.item.name}`)
      acceptedTotal += result.acceptedQty
      const qcStatus = result.acceptedQty > EPS && result.rejectedQty > EPS ? 'PARTIAL' : result.acceptedQty > EPS ? 'PASSED' : 'FAILED'
      await tx.deliveryChallanLine.update({ where: { id: line.id }, data: { acceptedQty: result.acceptedQty, rejectedQty: result.rejectedQty, qcStatus, qcNotes: result.qcNotes } })
      if (result.acceptedQty > EPS) {
        await tx.salesOrderLine.update({ where: { id: line.salesOrderLineId }, data: { dispatchedQty: { increment: result.acceptedQty } } })
        if (!line.item.isService && line.item.isStockItem) await tx.stockLedger.create({ data: { postingDate: new Date(), voucherType: 'DELIVERY_CHALLAN', voucherNo: dc.challanNo, itemId: line.itemId, warehouseId: dc.warehouseId, qtyOut: result.acceptedQty, rate: line.item.costRate, remarks: `Dispatch against ${dc.salesOrder.orderNo}` } })
      }
    }
    if (acceptedTotal <= EPS) return tx.deliveryChallan.update({ where: { id: dc.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
    const refreshed = await tx.salesOrderLine.findMany({ where: { salesOrderId: dc.salesOrderId } })
    const complete = refreshed.every((line) => line.dispatchedQty + EPS >= line.qty)
    await tx.salesOrder.update({ where: { id: dc.salesOrderId }, data: { status: complete ? 'DISPATCHED' : 'PART_DISPATCHED' } })
    return tx.deliveryChallan.update({ where: { id: dc.id }, data: { status: 'DISPATCHED', dispatchedAt: new Date() }, include: { lines: true } })
  })
}

export async function invoiceDispatchedChallan(input: { deliveryChallanId: string; date?: Date; remarks?: string; lines: { deliveryChallanLineId: string; qty: number }[] }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const dc = await tx.deliveryChallan.findFirst({ where: { id: input.deliveryChallanId, companyId: company.id }, include: { salesOrder: { include: { party: true } }, lines: { include: { item: true, salesOrderLine: true } } } })
    if (!dc || !['DISPATCHED', 'INVOICED'].includes(dc.status)) throw new BusinessError('Dispatched delivery challan not found', 404)
    if (!input.lines.length) throw new BusinessError('At least one invoice line is required')
    const seen = new Set<string>()
    const selected = input.lines.map((request) => {
      if (seen.has(request.deliveryChallanLineId)) throw new BusinessError('A challan line may occur only once on an invoice')
      seen.add(request.deliveryChallanLineId)
      const line = dc.lines.find((row) => row.id === request.deliveryChallanLineId)
      if (!line) throw new BusinessError('Invoice line does not belong to delivery challan')
      if (!(request.qty > 0) || line.invoicedQty + request.qty > line.acceptedQty + EPS) throw new BusinessError(`Invoice quantity exceeds unbilled dispatched quantity for ${line.item.name}`)
      return { request, line }
    })
    const interState = dc.salesOrder.party.stateCode !== company.stateCode
    const totals = computeInvoiceTotals(selected.map(({ request, line }) => ({ qty: request.qty, rate: line.salesOrderLine.rate, discPct: 0, gstRate: line.salesOrderLine.gstRate })), { taxInclusive: false, interState })
    const date = input.date ?? new Date(); const invoiceNo = await number(tx, company.id, 'INV', date)
    const invoice = await tx.salesInvoice.create({ data: {
      invoiceNo, date, partyId: dc.salesOrder.partyId, poNo: dc.salesOrder.customerPoNo, pos: dc.salesOrder.party.stateCode, interState,
      taxable: totals.taxable, discount: totals.discount, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, roundOff: totals.roundOff, grandTotal: totals.grandTotal,
      source: 'DELIVERY_CHALLAN', deliveryChallanId: dc.id, remarks: input.remarks,
      items: { create: selected.map(({ request, line }, index) => ({ itemId: line.itemId, detail: `Delivery challan ${dc.challanNo}`, hsn: line.item.hsn, uom: line.item.uom, qty: request.qty, rate: line.salesOrderLine.rate, discPct: 0, discAmt: totals.lines[index].discAmt, taxable: totals.lines[index].taxable, gstRate: line.salesOrderLine.gstRate, cgst: totals.lines[index].cgst, sgst: totals.lines[index].sgst, igst: totals.lines[index].igst, total: totals.lines[index].total, deliveryChallanLineId: line.id })) },
    }, include: { items: true } })
    for (const { request, line } of selected) {
      const updated = await tx.deliveryChallanLine.updateMany({ where: { id: line.id, invoicedQty: { gte: r2(line.invoicedQty - 0.0001), lte: r2(line.invoicedQty + 0.0001) } }, data: { invoicedQty: r2(line.invoicedQty + request.qty) } })
      if (updated.count !== 1) throw new BusinessError('Challan billing changed concurrently; refresh and retry', 409)
      await tx.salesOrderLine.update({ where: { id: line.salesOrderLineId }, data: { invoicedQty: { increment: request.qty } } })
    }
    const gl: Parameters<typeof postGl>[2] = [
      { account: 'DEBT' as AccountCode, partyId: dc.salesOrder.partyId, debit: totals.grandTotal, remarks: `Invoice ${invoiceNo} against ${dc.challanNo}` },
      { account: 'SALS' as AccountCode, credit: totals.taxable }, { account: 'CGSTP' as AccountCode, credit: totals.cgst }, { account: 'SGSTP' as AccountCode, credit: totals.sgst }, { account: 'IGSTP' as AccountCode, credit: totals.igst },
    ]
    if (Math.abs(totals.roundOff) > 0.004) gl.push(totals.roundOff > 0 ? { account: 'RND' as AccountCode, credit: totals.roundOff } : { account: 'RND' as AccountCode, debit: -totals.roundOff })
    await postGl(tx, { date, voucherType: 'SALES_INVOICE', voucherNo: invoiceNo }, gl)
    const all = await tx.deliveryChallanLine.findMany({ where: { deliveryChallanId: dc.id } })
    if (all.every((line) => line.invoicedQty + EPS >= line.acceptedQty)) await tx.deliveryChallan.update({ where: { id: dc.id }, data: { status: 'INVOICED' } })
    const orderLines = await tx.salesOrderLine.findMany({ where: { salesOrderId: dc.salesOrderId } })
    if (orderLines.every((line) => line.invoicedQty + EPS >= line.qty)) await tx.salesOrder.update({ where: { id: dc.salesOrderId }, data: { status: 'CLOSED' } })
    return invoice
  })
}

export async function cancelDeliveryChallan(id: string) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const dc = await tx.deliveryChallan.findFirst({ where: { id, companyId: company.id }, include: { lines: true } })
    if (!dc) throw new BusinessError('Delivery challan not found', 404)
    if (dc.status === 'CANCELLED') throw new BusinessError('Delivery challan is already cancelled')
    if (dc.lines.some((line) => line.invoicedQty > EPS)) throw new BusinessError('Delivery challan has invoiced quantities; cancel linked sales invoices first')
    const rows = await tx.stockLedger.findMany({ where: { voucherType: 'DELIVERY_CHALLAN', voucherNo: dc.challanNo, isCancelled: false } })
    for (const row of rows) await tx.stockLedger.create({ data: { postingDate: new Date(), voucherType: 'DELIVERY_CHALLAN', voucherNo: dc.challanNo, itemId: row.itemId, warehouseId: row.warehouseId, qtyIn: row.qtyOut, qtyOut: 0, rate: row.rate, remarks: `Reversal of ${dc.challanNo}`, isCancelled: true } })
    await tx.stockLedger.updateMany({ where: { voucherType: 'DELIVERY_CHALLAN', voucherNo: dc.challanNo, isCancelled: false }, data: { isCancelled: true } })
    for (const line of dc.lines) if (line.acceptedQty > EPS) await tx.salesOrderLine.update({ where: { id: line.salesOrderLineId }, data: { dispatchedQty: { decrement: line.acceptedQty } } })
    await tx.salesOrder.update({ where: { id: dc.salesOrderId }, data: { status: 'PART_DISPATCHED' } })
    return tx.deliveryChallan.update({ where: { id: dc.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  })
}

export async function orderToCashDashboard() {
  const company = await db.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } }); if (!company) throw new BusinessError('Operating company is not configured', 409)
  const [quotations, orders, challans] = await Promise.all([
    db.salesQuotation.findMany({ where: { companyId: company.id }, orderBy: [{ date: 'desc' }, { revisionNo: 'desc' }], include: { party: true, lines: { include: { item: true } } } }),
    db.salesOrder.findMany({ where: { companyId: company.id }, orderBy: { date: 'desc' }, include: { party: true, lines: { include: { item: true } } } }),
    db.deliveryChallan.findMany({ where: { companyId: company.id }, orderBy: { date: 'desc' }, include: { salesOrder: true, lines: { include: { item: true } } } }),
  ])
  return { quotations, orders, challans }
}
