import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError, postGl, cancelGlForVoucher, AccountCode } from './accounting'
import { computeInvoiceTotals, EPS, fyCode, r2 } from './erp'
import { cancelLotMovementsTx, consumeLotsFefoTx } from './traceability'
import { tenantCompany } from './tenant'

type Tx = Prisma.TransactionClient

type ReturnInput = {
  returnType: 'SALES_RETURN' | 'PURCHASE_RETURN'
  sourceInvoiceId: string
  warehouseId: string
  date?: Date
  reason: string
  createdBy?: string
  lines: { sourceLineId: string; requestedQty: number; acceptedQty: number; rejectedQty: number; disposition?: string; batchNo?: string; qcNotes?: string }[]
}

async function company(tx: Tx) {
  const row = await tenantCompany(tx)
  if (!row) throw new BusinessError('Operating company is not configured', 409)
  return row
}

async function nextNo(tx: Tx, companyId: string, prefix: string, date: Date) {
  const display = `${prefix}-${fyCode(date)}`
  const counter = await tx.counter.upsert({ where: { key: `${companyId}:${display}` }, create: { key: `${companyId}:${display}`, value: 1 }, update: { value: { increment: 1 } } })
  return `${display}-${String(counter.value).padStart(3, '0')}`
}

export async function postReturn(input: ReturnInput) {
  return db.$transaction(async (tx) => {
    const org = await company(tx)
    const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, active: true } })
    if (!warehouse) throw new BusinessError('Return warehouse not found or inactive', 404)
    if (!input.reason?.trim()) throw new BusinessError('Return reason is required')
    if (!input.lines.length) throw new BusinessError('At least one return line is required')
    const isSales = input.returnType === 'SALES_RETURN'
    const invoice = isSales
      ? await tx.salesInvoice.findUnique({ where: { id: input.sourceInvoiceId }, include: { items: { include: { item: true } }, party: true } })
      : await tx.purchaseInvoice.findUnique({ where: { id: input.sourceInvoiceId }, include: { items: { include: { item: true } }, party: true } })
    if (!invoice || invoice.status !== 'POSTED') throw new BusinessError('Active source invoice not found', 404)
    const prior = await tx.returnDocument.findMany({ where: { sourceInvoiceId: invoice.id, returnType: input.returnType, status: 'POSTED' }, include: { lines: true } })
    const already = new Map<string, number>()
    for (const doc of prior) for (const line of doc.lines) already.set(line.sourceLineId, r2((already.get(line.sourceLineId) ?? 0) + line.acceptedQty))
    const seen = new Set<string>()
    const selected = input.lines.map((request) => {
      if (seen.has(request.sourceLineId)) throw new BusinessError('A source invoice line may occur only once per return')
      seen.add(request.sourceLineId)
      const source = invoice.items.find((line) => line.id === request.sourceLineId)
      if (!source) throw new BusinessError('Return line does not belong to the source invoice')
      if (!(request.requestedQty > 0) || request.acceptedQty < 0 || request.rejectedQty < 0) throw new BusinessError(`Invalid return quantity for ${source.item.name}`)
      if (Math.abs(request.acceptedQty + request.rejectedQty - request.requestedQty) > EPS) throw new BusinessError(`Accepted + rejected must equal requested quantity for ${source.item.name}`)
      if ((already.get(source.id) ?? 0) + request.acceptedQty > source.qty + EPS) throw new BusinessError(`Return exceeds original invoice quantity for ${source.item.name}`)
      if (request.rejectedQty > EPS && !request.qcNotes?.trim()) throw new BusinessError(`QC notes are required for rejected return quantity of ${source.item.name}`)
      return { request, source, effectiveRate: source.qty > EPS ? r2(source.taxable / source.qty) : 0 }
    })
    const accepted = selected.filter((row) => row.request.acceptedQty > EPS)
    if (!accepted.length) throw new BusinessError('At least one returned line must pass QC before posting')
    if (!isSales) {
      for (const { request, source } of accepted) {
        if (source.item.isService || !source.item.isStockItem) continue
        const stock = await tx.stockLedger.aggregate({ where: { itemId: source.itemId, warehouseId: warehouse.id, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
        const available = r2((stock._sum.qtyIn ?? 0) - (stock._sum.qtyOut ?? 0))
        if (available + EPS < request.acceptedQty) throw new BusinessError(`Insufficient stock to return ${source.item.name}: ${available} available`)
      }
    }
    const totals = computeInvoiceTotals(accepted.map(({ request, source, effectiveRate }) => ({ qty: request.acceptedQty, rate: effectiveRate, discPct: 0, gstRate: source.gstRate })), { taxInclusive: false, interState: invoice.interState })
    const date = input.date ?? new Date()
    const returnNo = await nextNo(tx, org.id, isSales ? 'SRN' : 'PRN', date)
    const adjustmentNo = await nextNo(tx, org.id, isSales ? 'CN' : 'DN', date)
    const doc = await tx.returnDocument.create({ data: {
      companyId: org.id, returnNo, date, returnType: input.returnType, sourceInvoiceId: invoice.id, sourceInvoiceNo: invoice.invoiceNo,
      partyId: invoice.partyId, warehouseId: warehouse.id, qcStatus: selected.some((row) => row.request.rejectedQty > EPS) ? 'PARTIAL' : 'PASSED',
      status: 'POSTED', adjustmentType: isSales ? 'CREDIT_NOTE' : 'DEBIT_NOTE', adjustmentNo,
      taxable: totals.taxable, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, grandTotal: totals.grandTotal,
      reason: input.reason.trim(), postedAt: new Date(), createdBy: input.createdBy,
      lines: { create: selected.map(({ request, source, effectiveRate }) => {
        const index = accepted.findIndex((row) => row.source.id === source.id)
        const calculated = index >= 0 ? totals.lines[index] : { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }
        return { sourceLineId: source.id, itemId: source.itemId, requestedQty: request.requestedQty, acceptedQty: request.acceptedQty, rejectedQty: request.rejectedQty,
          rate: effectiveRate, gstRate: source.gstRate, taxable: calculated.taxable, cgst: calculated.cgst, sgst: calculated.sgst, igst: calculated.igst, total: calculated.total,
          disposition: request.disposition ?? (isSales ? 'RESTOCK' : 'RETURN_TO_VENDOR'), batchNo: request.batchNo, qcNotes: request.qcNotes }
      }) },
    }, include: { lines: { include: { item: true } }, party: true } })
    for (const { request, source, effectiveRate } of accepted) {
      if (source.item.isService || !source.item.isStockItem) continue
      if (!isSales) await consumeLotsFefoTx(tx, { itemId: source.itemId, warehouseId: warehouse.id, qty: request.acceptedQty, voucherType: input.returnType, voucherNo: returnNo })
      await tx.stockLedger.create({ data: { postingDate: date, voucherType: input.returnType, voucherNo: returnNo, itemId: source.itemId, warehouseId: warehouse.id,
        qtyIn: isSales && (request.disposition ?? 'RESTOCK') === 'RESTOCK' ? request.acceptedQty : 0,
        qtyOut: !isSales ? request.acceptedQty : 0, rate: effectiveRate, remarks: `${input.returnType} against ${invoice.invoiceNo}` } })
    }
    const gl: Parameters<typeof postGl>[2] = isSales ? [
      { account: 'SALS' as AccountCode, debit: totals.taxable }, { account: 'CGSTP' as AccountCode, debit: totals.cgst }, { account: 'SGSTP' as AccountCode, debit: totals.sgst }, { account: 'IGSTP' as AccountCode, debit: totals.igst },
      { account: 'DEBT' as AccountCode, partyId: invoice.partyId, credit: totals.grandTotal, remarks: `${adjustmentNo} against ${invoice.invoiceNo}` },
    ] : [
      { account: 'CRED' as AccountCode, partyId: invoice.partyId, debit: totals.grandTotal, remarks: `${adjustmentNo} against ${invoice.invoiceNo}` },
      { account: 'PURC' as AccountCode, credit: totals.taxable }, { account: 'CGSTI' as AccountCode, credit: totals.cgst }, { account: 'SGSTI' as AccountCode, credit: totals.sgst }, { account: 'IGSTI' as AccountCode, credit: totals.igst },
    ]
    if (Math.abs(totals.roundOff) > 0.004) {
      if (isSales) gl.push(totals.roundOff > 0 ? { account: 'RND' as AccountCode, debit: totals.roundOff } : { account: 'RND' as AccountCode, credit: -totals.roundOff })
      else gl.push(totals.roundOff > 0 ? { account: 'RND' as AccountCode, credit: totals.roundOff } : { account: 'RND' as AccountCode, debit: -totals.roundOff })
    }
    await postGl(tx, { date, voucherType: isSales ? 'CREDIT_NOTE' : 'DEBIT_NOTE', voucherNo: adjustmentNo }, gl)
    return doc
  })
}

export async function cancelReturn(id: string) {
  return db.$transaction(async (tx) => {
    const org = await company(tx)
    const doc = await tx.returnDocument.findFirst({ where: { id, companyId: org.id }, include: { lines: { include: { item: true } } } })
    if (!doc) throw new BusinessError('Return document not found', 404)
    if (doc.status !== 'POSTED') throw new BusinessError(`Return document is already ${doc.status}`)
    if (doc.refundedAmount > EPS) throw new BusinessError(`${r2(doc.refundedAmount)} has been refunded against ${doc.adjustmentNo} — cancel those refunds first`, 409)
    const isSales = doc.returnType === 'SALES_RETURN'
    if (isSales) for (const line of doc.lines) {
      if (line.acceptedQty <= EPS || line.disposition !== 'RESTOCK' || line.item.isService || !line.item.isStockItem) continue
      const stock = await tx.stockLedger.aggregate({ where: { itemId: line.itemId, warehouseId: doc.warehouseId, isCancelled: false }, _sum: { qtyIn: true, qtyOut: true } })
      if (r2((stock._sum.qtyIn ?? 0) - (stock._sum.qtyOut ?? 0)) + EPS < line.acceptedQty) throw new BusinessError(`Cannot cancel return: ${line.item.name} has already been consumed/sold`)
    }
    const rows = await tx.stockLedger.findMany({ where: { voucherType: doc.returnType, voucherNo: doc.returnNo, isCancelled: false } })
    for (const row of rows) await tx.stockLedger.create({ data: { postingDate: new Date(), voucherType: doc.returnType, voucherNo: doc.returnNo, itemId: row.itemId, warehouseId: row.warehouseId, qtyIn: row.qtyOut, qtyOut: row.qtyIn, rate: row.rate, remarks: `Reversal of ${doc.returnNo}`, isCancelled: true } })
    await tx.stockLedger.updateMany({ where: { voucherType: doc.returnType, voucherNo: doc.returnNo, isCancelled: false }, data: { isCancelled: true } })
    await cancelLotMovementsTx(tx, doc.returnType, doc.returnNo)
    await cancelGlForVoucher(tx, isSales ? 'CREDIT_NOTE' : 'DEBIT_NOTE', doc.adjustmentNo!, new Date())
    return tx.returnDocument.update({ where: { id: doc.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  })
}

export async function listReturns() {
  const org = await tenantCompany(db)
  if (!org) throw new BusinessError('Operating company is not configured', 409)
  return db.returnDocument.findMany({ where: { companyId: org.id }, orderBy: { date: 'desc' }, include: { party: true, lines: { include: { item: true } } } })
}
