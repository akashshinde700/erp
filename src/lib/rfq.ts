import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError } from './accounting'
import { EPS, fyCode, r2 } from './erp'
import { tenantCompany } from './tenant'
import { createPurchaseOrder } from './procurement'

type Tx = Prisma.TransactionClient

async function org(tx: Tx) {
  const company = await tenantCompany(tx)
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  return company
}
async function nextRfqNo(tx: Tx, companyId: string, date: Date) {
  const display = `RFQ-${fyCode(date)}`
  const row = await tx.counter.upsert({ where: { key: `${companyId}:${display}` }, create: { key: `${companyId}:${display}`, value: 1 }, update: { value: { increment: 1 } } })
  return `${display}-${String(row.value).padStart(3, '0')}`
}

export interface CreateRfqInput {
  requisitionId?: string
  dueDate?: Date
  notes?: string
  supplierIds: string[]
  lines?: { itemId: string; qty: number }[]
  createdBy?: string
}

/** RFQ from an approved requisition (its unordered quantities) or explicit lines. */
export async function createRfq(input: CreateRfqInput) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const supplierIds = [...new Set(input.supplierIds)]
    if (!supplierIds.length) throw new BusinessError('Invite at least one supplier')
    const suppliers = await tx.party.findMany({ where: { id: { in: supplierIds }, active: true } })
    const notSupplier = supplierIds.filter((id) => !suppliers.find((s) => s.id === id && s.types.split(',').includes('SUPPLIER')))
    if (notSupplier.length) throw new BusinessError('Every invited party must be an active supplier', 404)
    let lines: { itemId: string; qty: number; requisitionLineId?: string }[] = []
    if (input.requisitionId) {
      const req = await tx.purchaseRequisition.findFirst({ where: { id: input.requisitionId, companyId: company.id }, include: { lines: true } })
      if (!req || req.status !== 'APPROVED') throw new BusinessError('An RFQ needs an approved requisition', 409)
      const open = req.lines.map((l) => ({ itemId: l.itemId, qty: r2(l.qty - l.orderedQty), requisitionLineId: l.id })).filter((l) => l.qty > EPS)
      if (input.lines?.length) {
        for (const line of input.lines) {
          const src = open.find((l) => l.itemId === line.itemId)
          if (!src) throw new BusinessError('RFQ line is not on the requisition (or already ordered)')
          if (!(line.qty > 0) || line.qty > src.qty + EPS) throw new BusinessError(`RFQ quantity exceeds the open requisition quantity (${src.qty})`)
        }
        lines = input.lines.map((l) => ({ ...l, requisitionLineId: open.find((o) => o.itemId === l.itemId)!.requisitionLineId }))
      } else lines = open
    } else lines = input.lines ?? []
    if (!lines.length) throw new BusinessError('An RFQ needs at least one line')
    if (new Set(lines.map((l) => l.itemId)).size !== lines.length) throw new BusinessError('An item may appear only once on an RFQ')
    const items = await tx.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) }, active: true } })
    for (const line of lines) {
      if (!items.find((i) => i.id === line.itemId)) throw new BusinessError('RFQ item not found or inactive', 404)
      if (!(line.qty > 0)) throw new BusinessError('RFQ quantities must be positive')
    }
    const date = new Date()
    if (input.dueDate && input.dueDate < new Date(date.toISOString().slice(0, 10))) throw new BusinessError('Quotation due date cannot be in the past')
    return tx.rfq.create({
      data: {
        companyId: company.id, rfqNo: await nextRfqNo(tx, company.id, date), date, dueDate: input.dueDate, requisitionId: input.requisitionId, notes: input.notes, createdBy: input.createdBy,
        lines: { create: lines.map((l) => ({ itemId: l.itemId, qty: r2(l.qty), uom: items.find((i) => i.id === l.itemId)!.uom, requisitionLineId: l.requisitionLineId })) },
        suppliers: { create: supplierIds.map((supplierId) => ({ supplierId })) },
      },
      include: { lines: true, suppliers: true },
    })
  })
}

export interface QuoteInput {
  rfqId: string
  supplierId: string
  supplierRef?: string
  quoteDate?: Date
  validUntil: Date
  deliveryDays: number
  freight?: number
  paymentTerms?: string
  lines: { rfqLineId: string; rate: number; discountPct?: number; gstRate?: number }[]
  createdBy?: string
}

/** Record (or revise, while the RFQ is open) one supplier's quotation for every RFQ line. */
export async function recordQuote(input: QuoteInput) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const rfq = await tx.rfq.findFirst({ where: { id: input.rfqId, companyId: company.id }, include: { lines: { include: { item: true } }, suppliers: true } })
    if (!rfq) throw new BusinessError('RFQ not found', 404)
    if (rfq.status !== 'OPEN') throw new BusinessError(`Quotations can only be recorded on an open RFQ; this one is ${rfq.status}`, 409)
    if (!rfq.suppliers.some((s) => s.supplierId === input.supplierId)) throw new BusinessError('This supplier was not invited to the RFQ', 409)
    const quoteDate = input.quoteDate ?? new Date()
    if (input.validUntil < quoteDate) throw new BusinessError('Quotation validity cannot end before the quotation date')
    if (!Number.isInteger(input.deliveryDays) || input.deliveryDays < 0 || input.deliveryDays > 3650) throw new BusinessError('Delivery days must be a whole number of days')
    if ((input.freight ?? 0) < 0) throw new BusinessError('Freight cannot be negative')
    if (input.lines.length !== rfq.lines.length || new Set(input.lines.map((l) => l.rfqLineId)).size !== rfq.lines.length) throw new BusinessError('Quote a rate for every RFQ line exactly once')
    const priced = input.lines.map((l) => {
      const line = rfq.lines.find((r) => r.id === l.rfqLineId)
      if (!line) throw new BusinessError('Quote line does not belong to this RFQ')
      const disc = l.discountPct ?? 0, gst = l.gstRate ?? line.item.gstRate
      if (!(l.rate >= 0) || disc < 0 || disc > 100 || gst < 0 || gst > 100) throw new BusinessError(`Invalid rate, discount or GST for ${line.item.name}`)
      const amount = r2(line.qty * l.rate * (1 - disc / 100))
      return { rfqLineId: line.id, rate: l.rate, discountPct: disc, gstRate: gst, amount, tax: r2((amount * gst) / 100) }
    })
    const subtotal = r2(priced.reduce((s, l) => s + l.amount, 0))
    const taxAmount = r2(priced.reduce((s, l) => s + l.tax, 0))
    const landedTotal = r2(subtotal + taxAmount + (input.freight ?? 0))
    const data = { supplierRef: input.supplierRef, quoteDate, validUntil: input.validUntil, deliveryDays: input.deliveryDays, freight: r2(input.freight ?? 0), paymentTerms: input.paymentTerms, subtotal, taxAmount, landedTotal, createdBy: input.createdBy }
    const existing = await tx.supplierQuote.findFirst({ where: { rfqId: rfq.id, supplierId: input.supplierId } })
    if (existing) await tx.supplierQuoteLine.deleteMany({ where: { quoteId: existing.id } })
    const lineCreate = { create: priced.map(({ tax: _tax, ...l }) => l) }
    return existing
      ? tx.supplierQuote.update({ where: { id: existing.id }, data: { ...data, lines: lineCreate }, include: { lines: true } })
      : tx.supplierQuote.create({ data: { companyId: company.id, rfqId: rfq.id, supplierId: input.supplierId, ...data, lines: lineCreate }, include: { lines: true } })
  })
}

type RfqWithQuotes = Prisma.RfqGetPayload<{ include: { lines: { include: { item: true } }; suppliers: { include: { supplier: true } }; quotes: { include: { supplier: true; lines: true } } } }>

/** Commercial comparison: landed totals, per-line lowest rate, delivery, validity. */
export function compareQuotes(rfq: RfqWithQuotes, now = new Date()) {
  const quotes = rfq.quotes.map((q) => ({ id: q.id, supplierId: q.supplierId, supplier: q.supplier.name, landedTotal: q.landedTotal, subtotal: q.subtotal, taxAmount: q.taxAmount, freight: q.freight, deliveryDays: q.deliveryDays, validUntil: q.validUntil, expired: q.validUntil < now, status: q.status }))
  const valid = quotes.filter((q) => !q.expired && q.status !== 'REJECTED')
  const lowest = valid.reduce<(typeof quotes)[number] | null>((best, q) => (!best || q.landedTotal < best.landedTotal ? q : best), null)
  const fastest = valid.reduce<(typeof quotes)[number] | null>((best, q) => (!best || q.deliveryDays < best.deliveryDays ? q : best), null)
  const lines = rfq.lines.map((line) => {
    const offers = rfq.quotes.map((q) => { const l = q.lines.find((x) => x.rfqLineId === line.id); return l ? { quoteId: q.id, supplier: q.supplier.name, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate, netRate: r2(l.rate * (1 - l.discountPct / 100)), amount: l.amount } : null }).filter((x): x is NonNullable<typeof x> => !!x)
    const best = offers.reduce<(typeof offers)[number] | null>((b, o) => (!b || o.netRate < b.netRate ? o : b), null)
    return { rfqLineId: line.id, item: { id: line.itemId, code: line.item.code, name: line.item.name }, qty: line.qty, uom: line.uom, offers, lowestQuoteId: best?.quoteId ?? null }
  })
  return { quotes: quotes.sort((a, b) => a.landedTotal - b.landedTotal), lowestQuoteId: lowest?.id ?? null, fastestQuoteId: fastest?.id ?? null, lines }
}

/**
 * Award an RFQ to one quotation. Supplier selection is an approval: only the
 * OWNER may award, a reason is mandatory, and every other quotation is closed
 * with the reason it was not selected. All of it lands in the audit trail.
 */
export async function awardRfq(input: { rfqId: string; quoteId: string; reason: string; actor?: { role: string; email: string | null } | null }) {
  if (!input.reason?.trim()) throw new BusinessError('A selection reason is required')
  if (input.actor && input.actor.role !== 'OWNER' && input.actor.role !== 'SUPER_ADMIN') throw new BusinessError('Supplier selection needs the OWNER\'s approval', 403)
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const rfq = await tx.rfq.findFirst({ where: { id: input.rfqId, companyId: company.id }, include: { lines: { include: { item: true } }, suppliers: { include: { supplier: true } }, quotes: { include: { supplier: true, lines: true } } } })
    if (!rfq) throw new BusinessError('RFQ not found', 404)
    if (rfq.status !== 'OPEN') throw new BusinessError(`Only an open RFQ can be awarded; this one is ${rfq.status}`, 409)
    const quote = rfq.quotes.find((q) => q.id === input.quoteId)
    if (!quote) throw new BusinessError('Quotation not found on this RFQ', 404)
    if (quote.validUntil < new Date()) throw new BusinessError('This quotation has expired — ask the supplier to revalidate it', 409)
    const moved = await tx.rfq.updateMany({ where: { id: rfq.id, status: 'OPEN' }, data: { status: 'AWARDED', awardedQuoteId: quote.id, awardReason: input.reason.trim(), awardedBy: input.actor?.email ?? null, awardedAt: new Date() } })
    if (moved.count !== 1) throw new BusinessError('This RFQ was awarded by someone else just now — refresh', 409)
    const comparison = compareQuotes(rfq)
    await tx.supplierQuote.update({ where: { id: quote.id }, data: { status: 'SELECTED' } })
    const notSelected = `Not selected — awarded to ${quote.supplier.name}: ${input.reason.trim()}`
    await tx.supplierQuote.updateMany({ where: { rfqId: rfq.id, id: { not: quote.id } }, data: { status: 'REJECTED', rejectionReason: notSelected } })
    const lowestNote = comparison.lowestQuoteId && comparison.lowestQuoteId !== quote.id ? ' (not the lowest landed total)' : ''
    await tx.auditLog.create({ data: { action: 'AWARD', entity: 'Rfq', entityId: rfq.id, details: `${rfq.rfqNo} awarded to ${quote.supplier.name} at ${quote.landedTotal}${lowestNote}: ${input.reason.trim()}`, actor: input.actor?.email ?? null } })
    for (const other of rfq.quotes.filter((q) => q.id !== quote.id)) {
      await tx.auditLog.create({ data: { action: 'REJECT', entity: 'SupplierQuote', entityId: other.id, details: `${rfq.rfqNo}: ${other.supplier.name} (${other.landedTotal}) ${notSelected}`, actor: input.actor?.email ?? null } })
    }
    return { rfqNo: rfq.rfqNo, awardedTo: quote.supplier.name, landedTotal: quote.landedTotal, lowest: !lowestNote }
  })
}

/** Raise the purchase order for an awarded RFQ at the quoted net rates. */
export async function createPoFromRfq(input: { rfqId: string; createdBy?: string }) {
  const company = await org(db)
  const rfq = await db.rfq.findFirst({ where: { id: input.rfqId, companyId: company.id }, include: { lines: true, quotes: { include: { lines: true } } } })
  if (!rfq) throw new BusinessError('RFQ not found', 404)
  if (rfq.status !== 'AWARDED' || !rfq.awardedQuoteId) throw new BusinessError('Award the RFQ before raising a purchase order', 409)
  const quote = rfq.quotes.find((q) => q.id === rfq.awardedQuoteId)!
  // Claim the RFQ first so two clicks cannot raise two orders.
  const claimed = await db.rfq.updateMany({ where: { id: rfq.id, status: 'AWARDED', purchaseOrderId: null }, data: { status: 'ORDERED' } })
  if (claimed.count !== 1) throw new BusinessError('A purchase order was already raised for this RFQ', 409)
  try {
    const po = await createPurchaseOrder({
      supplierId: quote.supplierId, requisitionId: rfq.requisitionId ?? undefined, createdBy: input.createdBy,
      terms: `Against ${rfq.rfqNo}, supplier quote ${quote.supplierRef ?? quote.id.slice(-6)}; delivery ${quote.deliveryDays} days; freight ${quote.freight}`,
      lines: rfq.lines.map((line) => { const q = quote.lines.find((l) => l.rfqLineId === line.id)!; return { itemId: line.itemId, qty: line.qty, rate: r2(q.rate * (1 - q.discountPct / 100)), remarks: `${rfq.rfqNo}` } }),
    })
    await db.rfq.update({ where: { id: rfq.id }, data: { purchaseOrderId: po.id } })
    return po
  } catch (error) {
    await db.rfq.updateMany({ where: { id: rfq.id, status: 'ORDERED', purchaseOrderId: null }, data: { status: 'AWARDED' } })
    throw error
  }
}

export async function cancelRfq(input: { rfqId: string; reason: string }) {
  if (!input.reason?.trim()) throw new BusinessError('A cancellation reason is required')
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const rfq = await tx.rfq.findFirst({ where: { id: input.rfqId, companyId: company.id } })
    if (!rfq) throw new BusinessError('RFQ not found', 404)
    if (rfq.status === 'ORDERED') throw new BusinessError('A purchase order was raised from this RFQ — cancel the PO instead', 409)
    if (rfq.status === 'CANCELLED') throw new BusinessError('RFQ is already cancelled', 409)
    return tx.rfq.update({ where: { id: rfq.id }, data: { status: 'CANCELLED', cancelReason: input.reason.trim() } })
  })
}

export async function rfqDashboard() {
  const company = await tenantCompany(db)
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  const rfqs = await db.rfq.findMany({ where: { companyId: company.id }, orderBy: { date: 'desc' }, take: 200, include: { requisition: { select: { reqNo: true } }, lines: { include: { item: true } }, suppliers: { include: { supplier: true } }, quotes: { include: { supplier: true, lines: true } } } })
  return rfqs.map((rfq) => ({ ...rfq, comparison: compareQuotes(rfq) }))
}
