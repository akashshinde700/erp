/**
 * ForgeERP — proforma invoices (PI).
 *
 * A PI is a priced, GST-computed offer sent before the sale (advance payment,
 * customer approval, import/LC paperwork). It posts nothing: no stock, no GL,
 * no GST liability. GST is computed with the same function as a tax invoice,
 * so the PI total equals the invoice it becomes.
 *
 * Converting a standalone PI creates the real tax invoice exactly once (the
 * status claim is a conditional update, so a double click cannot bill twice).
 * A PI raised against a sales order is billed through that order's delivery
 * challan instead — converting it directly would invoice the order twice.
 */
import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError } from './accounting'
import { computeInvoiceTotals, fyCode, r2 } from './erp'
import { tenantCompany } from './tenant'
import { postSalesInvoiceTx } from './services'

type Tx = Prisma.TransactionClient

export interface ProformaLineInput { itemId: string; qty: number; rate: number; discPct?: number }

async function org(tx: Tx) {
  const row = await tenantCompany(tx)
  if (!row) throw new BusinessError('Operating company is not configured', 409)
  return row
}

async function nextPiNo(tx: Tx, companyId: string, date: Date) {
  const key = `PI-${fyCode(date)}`
  const row = await tx.counter.upsert({ where: { key: `${companyId}:${key}` }, create: { key: `${companyId}:${key}`, value: 1 }, update: { value: { increment: 1 } } })
  return `${key}-${String(row.value).padStart(3, '0')}`
}

const dayOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

export async function createProforma(input: {
  partyId: string
  date?: Date
  validUntil: Date
  salesOrderId?: string | null
  terms?: string | null
  lines?: ProformaLineInput[]
  createdBy?: string | null
}) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const date = dayOnly(input.date ?? new Date())
    const validUntil = dayOnly(input.validUntil)
    if (validUntil < date) throw new BusinessError('Validity cannot end before the proforma date')
    const party = await tx.party.findFirst({ where: { id: input.partyId, active: true } })
    if (!party || !party.types.split(',').includes('CUSTOMER')) throw new BusinessError('Active customer not found', 404)

    let lines = input.lines ?? []
    let salesOrderId: string | null = null
    if (input.salesOrderId) {
      const so = await tx.salesOrder.findFirst({ where: { id: input.salesOrderId }, include: { lines: true } })
      if (!so) throw new BusinessError('Sales order not found', 404)
      if (so.partyId !== party.id) throw new BusinessError(`${so.orderNo} belongs to a different customer`, 400)
      if (['CANCELLED', 'CLOSED', 'DISPATCHED'].includes(so.status)) throw new BusinessError(`${so.orderNo} is ${so.status} — nothing left to quote a proforma for`, 409)
      salesOrderId = so.id
      // Default: the quantity still to be dispatched on every open line.
      if (!lines.length) lines = so.lines.map((l) => ({ itemId: l.itemId, qty: r2(l.qty - l.dispatchedQty), rate: l.rate })).filter((l) => l.qty > 0)
    }
    if (!lines.length) throw new BusinessError('A proforma needs at least one line')
    for (const l of lines) {
      if (!(l.qty > 0)) throw new BusinessError('Quantity must be positive on every line')
      if (!(l.rate >= 0)) throw new BusinessError('Rate cannot be negative')
      if (l.discPct != null && !(l.discPct >= 0 && l.discPct <= 100)) throw new BusinessError('Discount must be 0–100%')
    }
    const items = await tx.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) }, active: true } })
    const map = new Map(items.map((i) => [i.id, i]))
    for (const l of lines) if (!map.has(l.itemId)) throw new BusinessError('An item on the proforma is missing or inactive', 404)

    const interState = party.stateCode !== company.stateCode
    const totals = computeInvoiceTotals(
      lines.map((l) => ({ qty: l.qty, rate: l.rate, discPct: l.discPct ?? 0, gstRate: map.get(l.itemId)!.gstRate })),
      { taxInclusive: false, interState }
    )
    return tx.proformaInvoice.create({
      data: {
        companyId: company.id,
        piNo: await nextPiNo(tx, company.id, date),
        date,
        validUntil,
        partyId: party.id,
        salesOrderId,
        placeOfSupply: party.stateCode,
        interState,
        taxable: totals.taxable,
        discount: totals.discount,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        terms: input.terms?.trim() || null,
        createdBy: input.createdBy ?? null,
        lines: {
          create: lines.map((l, i) => {
            const it = map.get(l.itemId)!
            const t = totals.lines[i]
            return { itemId: it.id, hsn: it.hsn, uom: it.uom, qty: l.qty, rate: l.rate, discPct: l.discPct ?? 0, gstRate: it.gstRate, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total }
          }),
        },
      },
      include: { party: true, lines: { include: { item: true } }, salesOrder: { select: { orderNo: true } } },
    })
  })
}

export async function listProformas() {
  const rows = await db.proformaInvoice.findMany({
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 300,
    include: { party: { select: { id: true, code: true, name: true } }, salesOrder: { select: { orderNo: true } }, _count: { select: { lines: true } } },
  })
  const invoiceIds = rows.map((r) => r.convertedInvoiceId).filter((x): x is string => !!x)
  const invoices = invoiceIds.length ? await db.salesInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, invoiceNo: true } }) : []
  const invNo = new Map(invoices.map((i) => [i.id, i.invoiceNo]))
  const today = dayOnly(new Date())
  return rows.map((r) => ({ ...r, expired: r.status === 'ISSUED' && r.validUntil < today, convertedInvoiceNo: r.convertedInvoiceId ? invNo.get(r.convertedInvoiceId) ?? null : null }))
}

export async function getProforma(id: string) {
  const pi = await db.proformaInvoice.findFirst({
    where: { id },
    include: { party: true, lines: { include: { item: { select: { id: true, code: true, name: true, hsn: true, uom: true } } } }, salesOrder: { select: { orderNo: true } } },
  })
  if (!pi) throw new BusinessError('Proforma not found', 404)
  return pi
}

export async function cancelProforma(id: string, reason: string) {
  const why = reason.trim()
  if (why.length < 3) throw new BusinessError('Give a reason for cancelling the proforma')
  const claimed = await db.proformaInvoice.updateMany({ where: { id, status: 'ISSUED' }, data: { status: 'CANCELLED', cancelReason: why.slice(0, 190), cancelledAt: new Date() } })
  if (claimed.count !== 1) {
    const pi = await db.proformaInvoice.findFirst({ where: { id }, select: { status: true } })
    if (!pi) throw new BusinessError('Proforma not found', 404)
    throw new BusinessError(`Proforma is ${pi.status} — only an issued proforma can be cancelled`, 409)
  }
  return getProforma(id)
}

/** Standalone PI → tax invoice, exactly once. */
export async function convertProforma(id: string, input: { warehouseId: string; actor?: string | null }) {
  return db.$transaction(async (tx) => {
    const pi = await tx.proformaInvoice.findFirst({ where: { id }, include: { lines: true } })
    if (!pi) throw new BusinessError('Proforma not found', 404)
    if (pi.status !== 'ISSUED') throw new BusinessError(`Proforma is ${pi.status} — it cannot be invoiced`, 409)
    if (pi.salesOrderId) throw new BusinessError('This proforma belongs to a sales order — invoice it through the order’s delivery challan so the order is not billed twice', 409)
    if (pi.validUntil < dayOnly(new Date())) throw new BusinessError(`Proforma expired on ${pi.validUntil.toISOString().slice(0, 10)} — issue a fresh one at current prices`, 409)
    // Claim first: a second click or a parallel request finds it CONVERTED.
    const claimed = await tx.proformaInvoice.updateMany({ where: { id, status: 'ISSUED' }, data: { status: 'CONVERTED' } })
    if (claimed.count !== 1) throw new BusinessError('This proforma was just invoiced or cancelled by another user — refresh', 409)
    const invoice = await postSalesInvoiceTx(tx, {
      partyId: pi.partyId,
      warehouseId: input.warehouseId,
      pos: pi.placeOfSupply,
      remarks: `Against proforma ${pi.piNo}`,
      lines: pi.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate, discPct: l.discPct })),
    })
    await tx.proformaInvoice.update({ where: { id }, data: { convertedInvoiceId: invoice.id } })
    return { proformaId: id, piNo: pi.piNo, invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, grandTotal: invoice.grandTotal, proformaTotal: pi.grandTotal }
  })
}
