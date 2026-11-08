/**
 * ForgeERP — Transactional posting services.
 * Every voucher writes its document + stock ledger + GL entries inside ONE
 * prisma.$transaction (core invariant #1). Ledgers are append-only: cancel
 * writes mirrored reversal rows and flags, never deletes (invariant #2).
 * Numbering is atomic via the Counter table inside the same transaction (invariant #3).
 * All business guards are enforced SERVER-side; client input is untrusted.
 */
import { db } from './db'
import { Prisma } from '@prisma/client'
import { r2, fyCode, computeInvoiceTotals, EPS, DEFAULT_WAREHOUSE_CODE } from './erp'
import { isValidDateString } from './validation'
import { BusinessError, AccountCode, postGl, cancelGlForVoucher } from './accounting'
import { cancelLotMovementsTx, consumeLotsFefoTx } from './traceability'
import { recomputeScheduleTx, recomputeSchedulesForInvoicesTx } from './finance-adjustments'
import { tenantCompany } from './tenant'

type Tx = Prisma.TransactionClient

export { DEFAULT_WAREHOUSE_CODE }

// ---------- helpers ----------

async function getCompany(tx: Tx) {
  // OPERATING org only (first non-platform company) — never the platform
  // company. A shared resolver with platform.ts keeps interState and seller
  // identity consistent across posting, Tally and e-Invoice.
  const company = await tenantCompany(tx)
  if (!company) throw new BusinessError('Company profile is not set up yet. Complete setup in Masters → Company.', 409)
  return company
}

async function defaultWarehouseId(tx: Tx): Promise<string> {
  const w = await tx.warehouse.findFirst({ where: { code: DEFAULT_WAREHOUSE_CODE } })
  if (w) return w.id
  const any = await tx.warehouse.findFirst({ orderBy: { code: 'asc' } })
  if (!any) throw new BusinessError('No warehouse defined. Create one in Masters first.', 409)
  return any.id
}

/** A client-supplied warehouse id is untrusted: validate it before it reaches
 *  a FK column, otherwise a typo becomes a 500 instead of a clear 400. */
async function resolveWarehouseId(tx: Tx, requested?: string | null): Promise<string> {
  if (!requested) return defaultWarehouseId(tx)
  const w = await tx.warehouse.findUnique({ where: { id: requested }, select: { id: true, active: true } })
  if (!w || !w.active) throw new BusinessError('Selected warehouse does not exist or is inactive', 400)
  return w.id
}

/** Atomic gapless-forward document number: INV-2526-003 */
async function nextDocNo(tx: Tx, prefix: string, date: Date): Promise<string> {
  const fy = fyCode(date)
  const display = `${prefix}-${fy}`
  const key = `${(await getCompany(tx)).id}:${display}` // one gapless series per organisation
  const counter = await tx.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${display}-${String(counter.value).padStart(3, '0')}`
}

interface StockStats { avail: number; avgCost: number }

async function stockStats(tx: Tx, itemId: string, warehouseId: string): Promise<StockStats> {
  // OWN stock only: JOBWORK_IN rows carry customer-owned material at rate 0 —
  // including them would (a) let sales consume material we do not own and
  // (b) dilute the moving-average cost to ~0 (inventory-integrity invariant).
  // Traceability of JW material stays intact in the stock LEDGER report.
  const rows = await tx.stockLedger.findMany({
    where: { itemId, warehouseId, isCancelled: false, voucherType: { not: 'JOBWORK_IN' } },
    select: { qtyIn: true, qtyOut: true, rate: true },
  })
  let qtyIn = 0
  let qtyOut = 0
  let inValue = 0
  for (const r of rows) {
    qtyIn += r.qtyIn
    qtyOut += r.qtyOut
    inValue += r.qtyIn * r.rate
  }
  return {
    avail: r2(qtyIn - qtyOut),
    avgCost: qtyIn > EPS ? r2(inValue / qtyIn) : 0,
  }
}

async function requireAvailability(tx: Tx, itemId: string, itemName: string, warehouseId: string, need: number) {
  const { avail } = await stockStats(tx, itemId, warehouseId)
  if (avail + EPS < need) {
    throw new BusinessError(
      `Insufficient stock for "${itemName}" (also check warehouse): available ${avail}, required ${need}`
    )
  }
}

/** Cancel path for stock rows of a voucher: mirror + flag both sides. */
async function cancelStockForVoucher(tx: Tx, voucherType: string, voucherNo: string, date: Date) {
  const originals = await tx.stockLedger.findMany({
    where: { voucherType, voucherNo, isCancelled: false },
  })
  if (originals.length === 0) return
  for (const o of originals) {
    await tx.stockLedger.create({
      data: {
        postingDate: date,
        voucherType,
        voucherNo,
        itemId: o.itemId,
        warehouseId: o.warehouseId,
        qtyIn: o.qtyOut, // mirrored
        qtyOut: o.qtyIn,
        rate: o.rate,
        remarks: `Reversal of ${voucherNo}`,
        isCancelled: true,
      },
    })
  }
  await tx.stockLedger.updateMany({
    where: { voucherType, voucherNo, isCancelled: false },
    data: { isCancelled: true },
  })
  await cancelLotMovementsTx(tx, voucherType, voucherNo)
}

/** Never let an unparseable/rolled-over date reach Prisma (FY numbering and
 *  as-of stock reports depend on it). Routes validate first; this is the
 *  service-level trust boundary for seed/internal callers too. */
const iso = (d?: string | Date): Date => {
  if (d === undefined || d === null || d === '') return new Date()
  if (typeof d === 'string' && !isValidDateString(d)) throw new BusinessError('Invalid date — use YYYY-MM-DD', 400)
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) throw new BusinessError('Invalid date — use YYYY-MM-DD', 400)
  return dt
}

// ---------- Sales invoices (W1) ----------

export interface SalesLineInput {
  itemId: string
  detail?: string | null
  qty: number
  rate: number
  discPct?: number
}

export interface PostSalesInput {
  partyId: string
  date?: string | Date
  pos?: string
  poNo?: string | null
  taxInclusive?: boolean
  warehouseId?: string | null
  remarks?: string | null
  source?: string
  salespersonId?: string | null
  lines: SalesLineInput[]
}

export async function postSalesInvoice(input: PostSalesInput) {
  return db.$transaction(async (tx) => postSalesInvoiceTx(tx, input))
}

/** Internal: runs inside a caller-owned transaction (used by jobwork invoicing). */
export async function postSalesInvoiceTx(tx: Tx, input: PostSalesInput) {
  if (!input.lines?.length) throw new BusinessError('Invoice needs at least one line item')
  {
    const company = await getCompany(tx)
    const party = await tx.party.findUnique({ where: { id: input.partyId } })
    if (!party) throw new BusinessError('Party not found', 404)
    if (!party.active) throw new BusinessError(`Party "${party.name}" is inactive`)
    if (input.salespersonId && !(await tx.salesperson.findFirst({ where: { id: input.salespersonId, active: true } }))) throw new BusinessError('Salesperson not found or inactive', 404)

    const items = await tx.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } })
    const itemMap = new Map(items.map((i) => [i.id, i]))
    for (const l of input.lines) {
      const it = itemMap.get(l.itemId)
      if (!it) throw new BusinessError(`Item ${l.itemId} not found`, 404)
      if (!(l.qty > 0)) throw new BusinessError(`Quantity must be positive for "${it.name}"`)
      if (l.rate < 0) throw new BusinessError(`Rate cannot be negative for "${it.name}"`)
    }

    const date = iso(input.date)
    const pos = input.pos ?? party.stateCode
    const interState = pos !== company.stateCode
    const taxInclusive = input.taxInclusive ?? false

    const totals = computeInvoiceTotals(
      input.lines.map((l) => ({
        qty: l.qty,
        rate: l.rate,
        discPct: l.discPct ?? 0,
        gstRate: itemMap.get(l.itemId)!.gstRate,
      })),
      { taxInclusive, interState }
    )

    const invoiceNo = await nextDocNo(tx, 'INV', date)
    const source = input.source ?? 'MANUAL'
    const incomeAccount: AccountCode = source === 'JOBWORK' ? 'JWIN' : 'SALS'

    const invoice = await tx.salesInvoice.create({
      data: {
        invoiceNo,
        date,
        partyId: party.id,
        poNo: input.poNo ?? null,
        pos,
        interState,
        taxInclusive,
        taxable: totals.taxable,
        discount: totals.discount,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        salespersonId: input.salespersonId ?? null,
        source,
        remarks: input.remarks ?? null,
        items: {
          create: input.lines.map((l, idx) => {
            const it = itemMap.get(l.itemId)!
            const t = totals.lines[idx]
            return {
              itemId: l.itemId,
              detail: l.detail ?? null,
              hsn: it.hsn,
              uom: it.uom,
              qty: l.qty,
              rate: l.rate,
              discPct: l.discPct ?? 0,
              discAmt: t.discAmt,
              taxable: t.taxable,
              gstRate: it.gstRate,
              cgst: t.cgst,
              sgst: t.sgst,
              igst: t.igst,
              total: t.total,
            }
          }),
        },
      },
      include: { items: true },
    })

    // Stock ledger: qtyOut @ weighted-average cost, availability-guarded
    const warehouseId = await resolveWarehouseId(tx, input.warehouseId)
    const qtyByItem = new Map<string, number>()
    for (const l of input.lines) {
      const it = itemMap.get(l.itemId)!
      if (it.isService || !it.isStockItem) continue
      qtyByItem.set(l.itemId, r2((qtyByItem.get(l.itemId) ?? 0) + l.qty))
    }
    for (const [itemId, q] of qtyByItem) {
      const it = itemMap.get(itemId)!
      await requireAvailability(tx, itemId, it.name, warehouseId, q)
      // Batch-tracked stock leaves FEFO through its lots (never from a recalled,
      // quarantined or expired batch), keeping lot balances inside the stock ledger.
      await consumeLotsFefoTx(tx, { itemId, warehouseId, qty: q, voucherType: 'SALES', voucherNo: invoiceNo })
      const { avgCost } = await stockStats(tx, itemId, warehouseId)
      await tx.stockLedger.create({
        data: {
          postingDate: date,
          voucherType: 'SALES',
          voucherNo: invoiceNo,
          itemId,
          warehouseId,
          qtyOut: q,
          rate: avgCost,
          remarks: `Sale to ${party.name}`,
        },
      })
    }

    // GL: Dr DEBT / Cr income + output GST / RND
    const gl: Parameters<typeof postGl>[2] = [
      { account: 'DEBT', partyId: party.id, debit: totals.grandTotal, remarks: `Invoice ${invoiceNo}` },
      { account: incomeAccount, credit: totals.taxable },
      { account: 'CGSTP', credit: totals.cgst },
      { account: 'SGSTP', credit: totals.sgst },
      { account: 'IGSTP', credit: totals.igst },
    ]
    if (Math.abs(totals.roundOff) > 0.004) {
      if (totals.roundOff > 0) gl.push({ account: 'RND', credit: totals.roundOff })
      else gl.push({ account: 'RND', debit: -totals.roundOff })
    }
    await postGl(tx, { date, voucherType: 'SALES_INVOICE', voucherNo: invoiceNo }, gl)

    return invoice
  }
}

export async function cancelSalesInvoice(id: string) {
  return db.$transaction(async (tx) => {
    const inv = await tx.salesInvoice.findUnique({ where: { id }, include: { items: true } })
    if (!inv) throw new BusinessError('Invoice not found', 404)
    if (inv.status === 'CANCELLED') throw new BusinessError('Invoice is already cancelled')
    if (inv.paidAmount > 0.004) {
      throw new BusinessError('Invoice has payments against it — cancel those payments first')
    }
    const notes = await tx.returnDocument.findMany({ where: { sourceInvoiceId: inv.id, returnType: 'SALES_RETURN', status: 'POSTED' }, select: { adjustmentNo: true } })
    if (notes.length) throw new BusinessError(`Credit note ${notes.map((n) => n.adjustmentNo).join(', ')} is posted against this invoice — cancel the return first`, 409)
    const now = new Date()
    await cancelStockForVoucher(tx, 'SALES', inv.invoiceNo, now)
    await cancelGlForVoucher(tx, 'SALES_INVOICE', inv.invoiceNo, now)
    // Dispatch-backed invoices do not issue stock again: the delivery challan
    // already did. Release billed quantities so a correction can be posted or
    // the challan can be cancelled after this invoice reversal.
    for (const line of inv.items) {
      if (!line.deliveryChallanLineId) continue
      const challanLine = await tx.deliveryChallanLine.findUnique({ where: { id: line.deliveryChallanLineId } })
      if (!challanLine || challanLine.invoicedQty + EPS < line.qty) throw new BusinessError('Linked challan billing state is inconsistent; cancellation stopped', 409)
      await tx.deliveryChallanLine.update({ where: { id: challanLine.id }, data: { invoicedQty: { decrement: line.qty } } })
      await tx.salesOrderLine.update({ where: { id: challanLine.salesOrderLineId }, data: { invoicedQty: { decrement: line.qty } } })
      if (inv.deliveryChallanId) await tx.deliveryChallan.update({ where: { id: inv.deliveryChallanId }, data: { status: 'DISPATCHED' } })
    }
    if (inv.deliveryChallanId) {
      const challan = await tx.deliveryChallan.findUnique({ where: { id: inv.deliveryChallanId }, select: { salesOrderId: true } })
      if (challan) await tx.salesOrder.update({ where: { id: challan.salesOrderId }, data: { status: 'DISPATCHED' } })
    }
    return tx.salesInvoice.update({ where: { id }, data: { status: 'CANCELLED' }, include: { items: true } })
  })
}

// ---------- Purchase invoices (W2) ----------

export interface PostPurchaseInput {
  partyId: string
  date?: string | Date
  poNo?: string | null
  taxInclusive?: boolean
  warehouseId?: string | null
  remarks?: string | null
  lines: SalesLineInput[]
}

export async function postPurchaseInvoice(input: PostPurchaseInput) {
  if (!input.lines?.length) throw new BusinessError('Invoice needs at least one line item')
  return db.$transaction(async (tx) => {
    const company = await getCompany(tx)
    const party = await tx.party.findUnique({ where: { id: input.partyId } })
    if (!party) throw new BusinessError('Party not found', 404)
    if (!party.active) throw new BusinessError(`Party "${party.name}" is inactive`)

    const items = await tx.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } })
    const itemMap = new Map(items.map((i) => [i.id, i]))
    for (const l of input.lines) {
      const it = itemMap.get(l.itemId)
      if (!it) throw new BusinessError(`Item ${l.itemId} not found`, 404)
      if (!(l.qty > 0)) throw new BusinessError(`Quantity must be positive for "${it.name}"`)
      if (l.rate < 0) throw new BusinessError(`Rate cannot be negative for "${it.name}"`)
    }

    const date = iso(input.date)
    const interState = party.stateCode !== company.stateCode // supplier state drives input tax
    const taxInclusive = input.taxInclusive ?? false

    const totals = computeInvoiceTotals(
      input.lines.map((l) => ({
        qty: l.qty,
        rate: l.rate,
        discPct: l.discPct ?? 0,
        gstRate: itemMap.get(l.itemId)!.gstRate,
      })),
      { taxInclusive, interState }
    )

    const invoiceNo = await nextDocNo(tx, 'PIN', date)
    const invoice = await tx.purchaseInvoice.create({
      data: {
        invoiceNo,
        date,
        partyId: party.id,
        poNo: input.poNo ?? null,
        interState,
        taxInclusive,
        taxable: totals.taxable,
        discount: totals.discount,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        remarks: input.remarks ?? null,
        items: {
          create: input.lines.map((l, idx) => {
            const it = itemMap.get(l.itemId)!
            const t = totals.lines[idx]
            return {
              itemId: l.itemId,
              detail: l.detail ?? null,
              hsn: it.hsn,
              uom: it.uom,
              qty: l.qty,
              rate: l.rate,
              discPct: l.discPct ?? 0,
              discAmt: t.discAmt,
              taxable: t.taxable,
              gstRate: it.gstRate,
              cgst: t.cgst,
              sgst: t.sgst,
              igst: t.igst,
              total: t.total,
            }
          }),
        },
      },
      include: { items: true },
    })

    // Stock: qtyIn @ effective line cost (taxable / qty)
    const warehouseId = await resolveWarehouseId(tx, input.warehouseId)
    const qtyByItem = new Map<string, { qty: number; value: number }>()
    for (const [idx, l] of input.lines.entries()) {
      const it = itemMap.get(l.itemId)!
      if (it.isService || !it.isStockItem) continue
      const prev = qtyByItem.get(l.itemId) ?? { qty: 0, value: 0 }
      qtyByItem.set(l.itemId, {
        qty: r2(prev.qty + l.qty),
        value: r2(prev.value + totals.lines[idx].taxable),
      })
    }
    for (const [itemId, agg] of qtyByItem) {
      const cost = agg.qty > EPS ? r2(agg.value / agg.qty) : 0
      await tx.stockLedger.create({
        data: {
          postingDate: date,
          voucherType: 'PURCHASE',
          voucherNo: invoiceNo,
          itemId,
          warehouseId,
          qtyIn: agg.qty,
          rate: cost,
          remarks: `Purchase from ${party.name}`,
        },
      })
    }

    // GL: Dr PURC + input GST / Cr CRED / RND
    const gl: Parameters<typeof postGl>[2] = [
      { account: 'PURC', debit: totals.taxable },
      { account: 'CGSTI', debit: totals.cgst },
      { account: 'SGSTI', debit: totals.sgst },
      { account: 'IGSTI', debit: totals.igst },
      { account: 'CRED', partyId: party.id, credit: totals.grandTotal, remarks: `Invoice ${invoiceNo}` },
    ]
    if (Math.abs(totals.roundOff) > 0.004) {
      if (totals.roundOff > 0) gl.push({ account: 'RND', credit: totals.roundOff })
      else gl.push({ account: 'RND', debit: -totals.roundOff })
    }
    await postGl(tx, { date, voucherType: 'PURCHASE_INVOICE', voucherNo: invoiceNo }, gl)

    return invoice
  })
}

export async function cancelPurchaseInvoice(id: string) {
  return db.$transaction(async (tx) => {
    const inv = await tx.purchaseInvoice.findUnique({ where: { id }, include: { items: true } })
    if (!inv) throw new BusinessError('Invoice not found', 404)
    if (inv.status === 'CANCELLED') throw new BusinessError('Invoice is already cancelled')
    if (inv.paidAmount > 0.004) {
      throw new BusinessError('Invoice has payments against it — cancel those payments first')
    }
    const notes = await tx.returnDocument.findMany({ where: { sourceInvoiceId: inv.id, returnType: 'PURCHASE_RETURN', status: 'POSTED' }, select: { adjustmentNo: true } })
    if (notes.length) throw new BusinessError(`Debit note ${notes.map((n) => n.adjustmentNo).join(', ')} is posted against this invoice — cancel the return first`, 409)
    const now = new Date()
    await cancelStockForVoucher(tx, 'PURCHASE', inv.invoiceNo, now)
    await cancelGlForVoucher(tx, 'PURCHASE_INVOICE', inv.invoiceNo, now)
    // Controlled procurement invoices do not post stock (the QC-accepted GRN
    // does). Release their billed quantities so the same accepted receipt can
    // be corrected/re-invoiced; direct legacy invoices have no source ids.
    for (const line of inv.items) {
      if (!line.goodsReceiptLineId) continue
      const receiptLine = await tx.goodsReceiptLine.findUnique({ where: { id: line.goodsReceiptLineId } })
      if (!receiptLine || receiptLine.billedQty + EPS < line.qty) throw new BusinessError('Linked GRN billing state is inconsistent; cancellation stopped', 409)
      await tx.goodsReceiptLine.update({ where: { id: receiptLine.id }, data: { billedQty: { decrement: line.qty } } })
      await tx.purchaseOrderLine.update({ where: { id: receiptLine.purchaseOrderLineId }, data: { billedQty: { decrement: line.qty } } })
    }
    // Free the supplier invoice number so the corrected bill can be entered again.
    return tx.purchaseInvoice.update({ where: { id }, data: { status: 'CANCELLED', activeSupplierInvoiceNo: null } })
  })
}

// ---------- Payments + allocations (W3) ----------

export interface PostPaymentInput {
  type: 'RECEIPT' | 'PAYMENT'
  partyId: string
  date?: string | Date
  amount: number
  mode?: string
  refNo?: string | null
  notes?: string | null
  allocations?: { invoiceType: 'SALES' | 'PURCHASE'; invoiceNo: string; amount: number }[]
  /** TDS at source. PAYMENT: we deduct from the supplier (TDS payable).
   *  RECEIPT: the customer deducted from us (TDS receivable). `amount` stays the
   *  net cash moved; the invoices are settled by amount + tdsAmount. */
  tdsSectionId?: string | null
  tdsAmount?: number
}

export async function postPayment(input: PostPaymentInput) {
  return db.$transaction(async (tx) => {
    const company = await getCompany(tx) // company must exist
    const party = await tx.party.findUnique({ where: { id: input.partyId } })
    if (!party) throw new BusinessError('Party not found', 404)
    if (!(input.amount > 0)) throw new BusinessError('Payment amount must be positive')
    const tds = r2(input.tdsAmount ?? 0)
    if (tds < 0) throw new BusinessError('TDS amount cannot be negative')
    let tdsSectionId: string | null = null
    if (tds > 0) {
      if (!input.tdsSectionId) throw new BusinessError('Choose the TDS section the deduction was made under')
      const section = await tx.tdsSection.findFirst({ where: { id: input.tdsSectionId, active: true } })
      if (!section) throw new BusinessError('TDS section not found or inactive', 404)
      // a deduction can never exceed the section rate on the settled amount (with 1 rupee rounding headroom)
      if (tds > r2(((input.amount + tds) * section.ratePct) / 100) + 1) {
        throw new BusinessError(`TDS ${tds} is more than ${section.section} @ ${section.ratePct}% of the settled amount`)
      }
      tdsSectionId = section.id
    } else if (input.tdsSectionId) throw new BusinessError('Enter the TDS amount for the chosen section')
    const settled = r2(input.amount + tds)

    const date = iso(input.date)
    const prefix = input.type === 'RECEIPT' ? 'RCP' : 'PAY'
    const paymentNo = await nextDocNo(tx, prefix, date)

    // Validate allocations against live outstanding (laserp guard pattern) +
    // VOUCHER-SIDE consistency: a RECEIPT settles SALES invoices (Dr CASH / Cr
    // DEBT) and a PAYMENT settles PURCHASE invoices (Dr CRED / Cr CASH) — the
    // control-account side must match the invoice side or party sub-ledgers
    // mis-state even though the voucher itself balances.
    const allocations = input.allocations ?? []
    const allocSum = r2(allocations.reduce((s, a) => s + a.amount, 0))
    if (allocSum > settled + 0.005) {
      throw new BusinessError(`Allocated (${allocSum}) exceeds payment amount (${settled}${tds > 0 ? ` incl. TDS ${tds}` : ''})`)
    }
    // One invoice may appear only ONCE per payment voucher. Two rows for the
    // same invoice would make PaymentAllocation Σ drift from the invoice's
    // paidAmount (and from the outstanding report) even if each row looked
    // valid in isolation.
    const seen = new Set<string>()
    for (const a of allocations) {
      const key = `${a.invoiceType}:${a.invoiceNo}`
      if (seen.has(key)) throw new BusinessError(`Duplicate allocation for invoice ${a.invoiceNo} in one payment`)
      seen.add(key)
    }
    for (const a of allocations) {
      if (!(a.amount > 0)) throw new BusinessError('Allocation amount must be positive')
      const expectedType = input.type === 'RECEIPT' ? 'SALES' : 'PURCHASE'
      if (a.invoiceType !== expectedType) {
        throw new BusinessError(
          `A ${input.type === 'RECEIPT' ? 'receipt' : 'payment'} can only settle ${expectedType === 'SALES' ? 'sales' : 'purchase'} invoices — ${a.invoiceNo} is a ${a.invoiceType === 'SALES' ? 'sales' : 'purchase'} invoice`
        )
      }
      if (a.invoiceType === 'SALES') {
        const inv = await tx.salesInvoice.findFirst({ where: { invoiceNo: a.invoiceNo } })
        if (!inv) throw new BusinessError(`Sales invoice ${a.invoiceNo} not found`, 404)
        if (inv.partyId !== party.id) throw new BusinessError(`Invoice ${a.invoiceNo} belongs to a different party`)
        if (inv.status !== 'POSTED') throw new BusinessError(`Invoice ${a.invoiceNo} is not active`)
        const outstanding = r2(inv.grandTotal - inv.paidAmount)
        if (a.amount > outstanding + 0.005) {
          throw new BusinessError(`Invoice ${a.invoiceNo} outstanding is only ${outstanding}`)
        }
        const upd = await tx.salesInvoice.updateMany({
          where: { id: inv.id, status: 'POSTED', paidAmount: { gte: r2(inv.paidAmount - 0.0001), lte: r2(inv.paidAmount + 0.0001) } },
          data: { paidAmount: r2(inv.paidAmount + a.amount) },
        })
        if (upd.count !== 1) throw new BusinessError(`Invoice ${a.invoiceNo} was updated by another transaction — refresh and try again`, 409)
      } else {
        const inv = await tx.purchaseInvoice.findFirst({ where: { invoiceNo: a.invoiceNo } })
        if (!inv) throw new BusinessError(`Purchase invoice ${a.invoiceNo} not found`, 404)
        if (inv.partyId !== party.id) throw new BusinessError(`Invoice ${a.invoiceNo} belongs to a different party`)
        if (inv.status !== 'POSTED') throw new BusinessError(`Invoice ${a.invoiceNo} is not active`)
        const outstanding = r2(inv.grandTotal - inv.paidAmount)
        if (a.amount > outstanding + 0.005) {
          throw new BusinessError(`Invoice ${a.invoiceNo} outstanding is only ${outstanding}`)
        }
        const upd = await tx.purchaseInvoice.updateMany({
          where: { id: inv.id, status: 'POSTED', paidAmount: { gte: r2(inv.paidAmount - 0.0001), lte: r2(inv.paidAmount + 0.0001) } },
          data: { paidAmount: r2(inv.paidAmount + a.amount) },
        })
        if (upd.count !== 1) throw new BusinessError(`Invoice ${a.invoiceNo} was updated by another transaction — refresh and try again`, 409)
      }
    }

    const payment = await tx.payment.create({
      data: {
        paymentNo,
        date,
        type: input.type,
        partyId: party.id,
        amount: r2(input.amount),
        mode: input.mode ?? 'CASH',
        refNo: input.refNo ?? null,
        notes: input.notes ?? null,
        tdsSectionId,
        tdsAmount: tds,
        allocations: allocations.length
          ? { create: allocations.map((a) => ({ invoiceType: a.invoiceType, invoiceNo: a.invoiceNo, amount: r2(a.amount) })) }
          : undefined,
      },
      include: { allocations: true },
    })

    // GL: RECEIPT → Dr CASH/BANK, Cr DEBT ; PAYMENT → Dr CRED, Cr CASH/BANK
    const cashAccount: AccountCode = input.mode === 'CASH' ? 'CASH' : 'BANK'
    // with TDS: RECEIPT adds Dr TDS receivable, PAYMENT adds Cr TDS payable; the party is settled gross
    const gl: Parameters<typeof postGl>[2] =
      input.type === 'RECEIPT'
        ? [
            { account: cashAccount, debit: payment.amount, remarks: `${paymentNo} (${input.mode})` },
            { account: 'TDSR', partyId: party.id, debit: tds },
            { account: 'DEBT', partyId: party.id, credit: settled },
          ]
        : [
            { account: 'CRED', partyId: party.id, debit: settled },
            { account: cashAccount, credit: payment.amount, remarks: `${paymentNo} (${input.mode})` },
            { account: 'TDSP', partyId: party.id, credit: tds },
          ]
    await postGl(tx, { date, voucherType: 'PAYMENT', voucherNo: paymentNo }, gl)

    const unallocated = r2(settled - allocSum)
    if (unallocated > EPS) {
      await tx.partyAdvance.create({ data: { companyId: company.id, partyId: party.id, paymentId: payment.id, advanceType: input.type === 'RECEIPT' ? 'CUSTOMER' : 'SUPPLIER', originalAmount: unallocated } })
    }
    // Collections against dispatch-backed invoices settle their order's milestones.
    const salesNos = (input.allocations ?? []).filter((a) => a.invoiceType === 'SALES').map((a) => a.invoiceNo)
    if (salesNos.length) await recomputeSchedulesForInvoicesTx(tx, { invoiceNos: salesNos })

    return payment
  })
}

export async function cancelPayment(id: string) {
  return db.$transaction(async (tx) => {
    const pay = await tx.payment.findUnique({ where: { id }, include: { allocations: true, advances: true, refunds: true } })
    if (!pay) throw new BusinessError('Payment not found', 404)
    if (pay.status === 'CANCELLED') throw new BusinessError('Payment is already cancelled')
    if (pay.refunds.length) throw new BusinessError('This is a refund — cancel it from the return document (Cancel refund) so the refundable balance is restored', 409)
    if (pay.advances.some((advance) => advance.appliedAmount > EPS)) throw new BusinessError('Advance was already applied to invoices — reverse those applications first')
    await tx.partyAdvance.updateMany({ where: { paymentId: pay.id }, data: { status: 'CANCELLED' } })
    for (const a of pay.allocations) {
      if (a.reversedAt) continue // reversed applications already gave the amount back
      if (a.invoiceType === 'SALES') {
        await tx.salesInvoice.updateMany({
          where: { invoiceNo: a.invoiceNo },
          data: { paidAmount: { decrement: a.amount } },
        })
      } else if (a.invoiceType === 'PURCHASE') {
        await tx.purchaseInvoice.updateMany({
          where: { invoiceNo: a.invoiceNo },
          data: { paidAmount: { decrement: a.amount } },
        })
      }
    }
    await cancelGlForVoucher(tx, 'PAYMENT', pay.paymentNo, new Date())
    const cancelled = await tx.payment.update({ where: { id }, data: { status: 'CANCELLED' }, include: { allocations: true } })
    const salesNos = pay.allocations.filter((a) => a.invoiceType === 'SALES' && !a.reversedAt).map((a) => a.invoiceNo)
    if (salesNos.length) await recomputeSchedulesForInvoicesTx(tx, { invoiceNos: salesNos })
    for (const a of pay.advances) if (a.salesOrderId) await recomputeScheduleTx(tx, a.salesOrderId)
    return cancelled
  })
}

// ---------- Jobwork: Inward (W5.1) ----------

export interface PostInwardInput {
  partyId: string
  date?: string | Date
  challanNo?: string | null
  warehouseId?: string | null
  notes?: string | null
  items: { itemId: string; batchNo?: string | null; qty: number; weight: number; remarks?: string | null }[]
}

export async function postJobworkInward(input: PostInwardInput) {
  if (!input.items?.length) throw new BusinessError('Inward needs at least one item')
  return db.$transaction(async (tx) => {
    await getCompany(tx)
    const party = await tx.party.findUnique({ where: { id: input.partyId } })
    if (!party) throw new BusinessError('Party not found', 404)
    const items = await tx.item.findMany({ where: { id: { in: input.items.map((i) => i.itemId) } } })
    const itemMap = new Map(items.map((i) => [i.id, i]))
    for (const i of input.items) {
      const it = itemMap.get(i.itemId)
      if (!it) throw new BusinessError(`Item ${i.itemId} not found`, 404)
      if (!(i.qty > 0)) throw new BusinessError(`Quantity must be positive for "${it.name}"`)
      if (i.weight < 0) throw new BusinessError(`Weight cannot be negative for "${it.name}"`)
    }

    const date = iso(input.date)
    const inwardNo = await nextDocNo(tx, 'JWI', date)
    const warehouseId = await resolveWarehouseId(tx, input.warehouseId)

    const inward = await tx.jobworkInward.create({
      data: {
        inwardNo,
        date,
        partyId: party.id,
        challanNo: input.challanNo ?? null,
        warehouseId,
        notes: input.notes ?? null,
        items: {
          create: input.items.map((i) => ({
            itemId: i.itemId,
            batchNo: i.batchNo ?? null,
            qty: i.qty,
            weight: i.weight,
            remarks: i.remarks ?? null,
          })),
        },
      },
      include: { items: true },
    })

    // Customer-owned material: value-neutral qtyIn @ 0 (tracked, not owned)
    for (const i of input.items) {
      const it = itemMap.get(i.itemId)!
      if (it.isService || !it.isStockItem) continue
      await tx.stockLedger.create({
        data: {
          postingDate: date,
          voucherType: 'JOBWORK_IN',
          voucherNo: inwardNo,
          itemId: i.itemId,
          warehouseId,
          qtyIn: i.qty,
          rate: 0,
          remarks: `Jobwork inward from ${party.name}`,
        },
      })
    }

    return inward
  })
}

export async function cancelJobworkInward(id: string) {
  return db.$transaction(async (tx) => {
    const inward = await tx.jobworkInward.findUnique({
      where: { id },
      include: { items: true, jobCards: true, certificates: true },
    })
    if (!inward) throw new BusinessError('Inward not found', 404)
    if (inward.status === 'CANCELLED') throw new BusinessError('Inward is already cancelled')
    if (inward.status === 'INVOICED') {
      throw new BusinessError('This inward is already invoiced — cancel the jobwork invoice before the inward')
    }
    const doneCards = inward.jobCards.filter((c) => c.status === 'COMPLETED')
    if (doneCards.length > 0) {
      throw new BusinessError('Inward has completed job cards — cancel those first (certificate/invoice blocks may apply)')
    }
    const now = new Date()
    await cancelStockForVoucher(tx, 'JOBWORK_IN', inward.inwardNo, now)
    return tx.jobworkInward.update({ where: { id }, data: { status: 'CANCELLED' }, include: { items: true } })
  })
}

// ---------- Jobwork: Job Card (W5.2) ----------

export interface PostJobCardInput {
  inwardId: string
  date?: string | Date
  notes?: string | null
  lines: { inwardItemId: string; qty: number; weight: number; processIds: string[] }[]
}

const OVER_TOLERANCE = 1.05 // 5% over-processing allowance (ERPNext pattern)

export async function postJobCard(input: PostJobCardInput) {
  if (!input.lines?.length) throw new BusinessError('Job card needs at least one line')
  return db.$transaction(async (tx) => {
    const inward = await tx.jobworkInward.findUnique({
      where: { id: input.inwardId },
      include: { items: true, certificates: { where: { status: 'ISSUED' }, select: { certNo: true } } },
    })
    if (!inward) throw new BusinessError('Inward not found', 404)
    if (inward.status === 'CANCELLED') throw new BusinessError('Inward is cancelled')
    if (inward.status === 'INVOICED') throw new BusinessError('Inward is already invoiced')
    if (inward.certificates.length > 0) {
      throw new BusinessError(`Certificate ${inward.certificates[0].certNo} is already issued — no further job cards can be posted`)
    }

    const inwardItemMap = new Map(inward.items.map((i) => [i.id, i]))
    for (const l of input.lines) {
      const it = inwardItemMap.get(l.inwardItemId)
      if (!it) throw new BusinessError('Line item does not belong to this inward', 400)
      if (!(l.qty > 0)) throw new BusinessError(`Quantity must be positive`)
      if (l.weight < 0) throw new BusinessError('Weight cannot be negative')
      if (!l.processIds?.length) throw new BusinessError('Select at least one process per line')
    }

    // Aggregate qty/weight per inward item (server-side trust boundary)
    const agg = new Map<string, { qty: number; weight: number }>()
    for (const l of input.lines) {
      const prev = agg.get(l.inwardItemId) ?? { qty: 0, weight: 0 }
      agg.set(l.inwardItemId, { qty: r2(prev.qty + l.qty), weight: r2(prev.weight + l.weight) })
    }
    for (const [itemId, a] of agg) {
      const it = inwardItemMap.get(itemId)!
      if (it.processedQty + a.qty > it.qty * OVER_TOLERANCE + EPS) {
        throw new BusinessError(
          `Over-processing: item "${it.batchNo ? it.batchNo + ' — ' : ''}processed ${it.processedQty} + new ${a.qty} exceeds received ${it.qty} (5% tolerance)`
        )
      }
      // SYMMETRIC WEIGHT guard — a WEIGHT-basis row bills weight × rate, so
      // processedWeight must stay within received weight (5% tolerance),
      // exactly like qty. Without this, one inward item could be billed for
      // unbounded material (inventory-integrity invariant).
      if (it.processedWeight + a.weight > it.weight * OVER_TOLERANCE + EPS) {
        throw new BusinessError(
          `Over-processing weight: item "${it.batchNo ? it.batchNo + ' — ' : ''}processed ${it.processedWeight} + new ${a.weight} kg exceeds received ${it.weight} kg (5% tolerance)`
        )
      }
    }

    // Resolve processes + party-specific rates
    const allProcessIds = [...new Set(input.lines.flatMap((l) => l.processIds))]
    const processes = await tx.process.findMany({ where: { id: { in: allProcessIds } } })
    const processMap = new Map(processes.map((p) => [p.id, p]))
    for (const pid of allProcessIds) {
      if (!processMap.has(pid)) throw new BusinessError(`Process ${pid} not found`, 404)
    }
    const rates = await tx.partyProcessRate.findMany({
      where: { partyId: inward.partyId, processId: { in: allProcessIds } },
    })
    const rateMap = new Map(rates.map((r) => [r.processId, r]))

    const date = iso(input.date)
    const cardNo = await nextDocNo(tx, 'JC', date)

    // Build aggregated rows: one row per (inwardItem, process); same-process merges
    interface Row { inwardItemId: string; processId: string; qty: number; weight: number }
    const rowMap = new Map<string, Row>()
    for (const l of input.lines) {
      for (const pid of l.processIds) {
        const key = `${l.inwardItemId}|${pid}`
        const prev = rowMap.get(key) ?? { inwardItemId: l.inwardItemId, processId: pid, qty: 0, weight: 0 }
        rowMap.set(key, { ...prev, qty: r2(prev.qty + l.qty), weight: r2(prev.weight + l.weight) })
      }
    }

    // Lot charge: ONCE per distinct process per card — FROZEN onto the rows at
    // post time (stored on the first row of each process) so certificates and
    // invoices re-use the stored value instead of recomputing from live rates
    // (billing-accuracy invariant: card ≡ certificate ≡ invoice).
    let lotTotal = 0
    const lotByProcess = new Map<string, number>()
    for (const pid of allProcessIds) {
      const pr = rateMap.get(pid)
      const lot = r2(pr?.lotCharge ?? processMap.get(pid)!.lotCharge)
      lotByProcess.set(pid, lot)
      lotTotal = r2(lotTotal + lot)
    }

    const rows = [...rowMap.values()].map((r) => {
      const process = processMap.get(r.processId)!
      const partyRate = rateMap.get(r.processId)
      const rate = partyRate?.rate ?? process.rate
      const basis = process.basis
      const amount = r2(basis === 'WEIGHT' ? r.weight * rate : r.qty * rate)
      return { ...r, basis, rate, amount }
    })
    // Attach the frozen lot charge to the FIRST row of each process (0 on the
    // rest) so Σ(amount) + Σ(lotCharge) == card.totalAmount by construction.
    const seenProcess = new Set<string>()
    const rowsWithLot: { inwardItemId: string; processId: string; qty: number; weight: number; basis: string; rate: number; amount: number; lotCharge: number }[] = []
    for (const row of rows) {
      if (!seenProcess.has(row.processId)) {
        seenProcess.add(row.processId)
        rowsWithLot.push({ ...row, lotCharge: lotByProcess.get(row.processId) ?? 0 })
      } else {
        rowsWithLot.push({ ...row, lotCharge: 0 })
      }
    }
    const totalAmount = r2(rowsWithLot.reduce((s, r) => s + r.amount, 0) + lotTotal)

    const card = await tx.jobCard.create({
      data: {
        cardNo,
        inwardId: inward.id,
        date,
        status: 'COMPLETED',
        totalAmount,
        notes: input.notes ?? null,
        processes: { create: rowsWithLot },
      },
      include: { processes: { include: { process: true } } },
    })

    // Bump processed quantities (per inward item, once — not per process row).
    // Conditional update: two concurrent cards that both read the same
    // processedQty must not both pass the over-processing guard and then
    // overwrite each other's progress (lost-update / over-billing race).
    for (const [itemId, a] of agg) {
      const it = inwardItemMap.get(itemId)!
      const upd = await tx.jobworkInwardItem.updateMany({
        where: {
          id: itemId,
          processedQty: { gte: r2(it.processedQty - 0.0001), lte: r2(it.processedQty + 0.0001) },
          processedWeight: { gte: r2(it.processedWeight - 0.0001), lte: r2(it.processedWeight + 0.0001) },
        },
        data: { processedQty: r2(it.processedQty + a.qty), processedWeight: r2(it.processedWeight + a.weight) },
      })
      if (upd.count !== 1) {
        throw new BusinessError('This inward was processed by another job card at the same time — refresh and try again', 409)
      }
    }

    // Derived status (ERPNext pattern): all items fully processed → COMPLETED
    const refreshed = await tx.jobworkInward.findUnique({ where: { id: inward.id }, include: { items: true } })
    const fullyProcessed = refreshed!.items.every((i) => i.processedQty >= i.qty - EPS)
    await tx.jobworkInward.update({
      where: { id: inward.id },
      data: { status: fullyProcessed ? 'COMPLETED' : 'IN_PROGRESS' },
    })

    return { ...card, inwardStatus: fullyProcessed ? 'COMPLETED' : 'IN_PROGRESS' }
  })
}

export async function cancelJobCard(id: string) {
  return db.$transaction(async (tx) => {
    const card = await tx.jobCard.findUnique({
      where: { id },
      include: { processes: true, inward: { include: { items: true, certificates: true } } },
    })
    if (!card) throw new BusinessError('Job card not found', 404)
    if (card.status === 'CANCELLED') throw new BusinessError('Job card is already cancelled')
    if (card.inward.status === 'INVOICED') {
      // The invoice was built from THIS card's amounts — cancelling it now
      // would roll back processed qty/weight under a live invoice and make
      // billed totals diverge from the jobwork chain (billing-accuracy
      // invariant). Cancel the invoice first.
      throw new BusinessError('This inward is already invoiced — cancel the jobwork invoice before its job cards')
    }
    const activeCert = card.inward.certificates.find((c) => c.status === 'ISSUED')
    if (activeCert) {
      throw new BusinessError(`Certificate ${activeCert.certNo} has been issued on this inward — card cannot be cancelled`)
    }

    // Roll back processed qty/weight per inward item
    const agg = new Map<string, { qty: number; weight: number }>()
    for (const p of card.processes) {
      const prev = agg.get(p.inwardItemId) ?? { qty: 0, weight: 0 }
      agg.set(p.inwardItemId, { qty: r2(prev.qty + p.qty), weight: r2(prev.weight + p.weight) })
    }
    for (const [itemId, delta] of agg) {
      const it = card.inward.items.find((i) => i.id === itemId)
      if (!it) continue
      await tx.jobworkInwardItem.update({
        where: { id: itemId },
        data: {
          processedQty: Math.max(0, r2(it.processedQty - delta.qty)),
          processedWeight: Math.max(0, r2(it.processedWeight - delta.weight)),
        },
      })
    }

    const refreshed = await tx.jobworkInward.findUnique({ where: { id: card.inwardId }, include: { items: true } })
    const anyProcessed = refreshed!.items.some((i) => i.processedQty > EPS)
    const fullyProcessed = refreshed!.items.every((i) => i.processedQty >= i.qty - EPS)
    const newStatus = fullyProcessed ? 'COMPLETED' : anyProcessed ? 'IN_PROGRESS' : 'OPEN'
    await tx.jobworkInward.update({ where: { id: card.inwardId }, data: { status: newStatus } })

    return tx.jobCard.update({ where: { id }, data: { status: 'CANCELLED' } })
  })
}

// ---------- Jobwork: Certificate (W5.3) ----------

export async function issueCertificate(inwardId: string, date?: string | Date) {
  return db.$transaction(async (tx) => {
    const inward = await tx.jobworkInward.findUnique({
      where: { id: inwardId },
      include: {
        items: true,
        jobCards: { where: { status: 'COMPLETED' }, include: { processes: { include: { process: true } } } },
        certificates: true,
      },
    })
    if (!inward) throw new BusinessError('Inward not found', 404)
    if (inward.status === 'CANCELLED') throw new BusinessError('Inward is cancelled')
    if (inward.status === 'INVOICED') {
      // Chain order: certificate precedes invoice — a certificate cannot be
      // retro-fitted under a live invoice (its totals would bypass the GST
      // engine and could diverge from the billed amounts).
      throw new BusinessError('This inward is already invoiced — the certificate must be issued before invoicing')
    }
    const activeCert = inward.certificates.find((c) => c.status === 'ISSUED')
    if (activeCert) throw new BusinessError(`Certificate ${activeCert.certNo} already issued for this inward`)
    if (inward.jobCards.length === 0) {
      throw new BusinessError('No completed job cards on this inward — complete a job card first')
    }
    // A certificate freezes the processed quantities and billing value. Issue
    // it only after every inward line is complete; otherwise later cards could
    // make the certificate and invoice disagree.
    const pendingItems = inward.items.filter((i) => i.processedQty < i.qty - EPS)
    if (pendingItems.length > 0 || inward.status !== 'COMPLETED') {
      throw new BusinessError(
        `${pendingItems.length || 'Some'} inward item(s) are still pending — finish processing before issuing the certificate`
      )
    }

    const d = iso(date)
    const certNo = await nextDocNo(tx, 'CERT', d)

    // Process-wise aggregation — LOT CHARGES come from the STORED rows
    // (frozen at card post time), never recomputed from live rates, so the
    // certificate total always equals Σ card.totalAmount (billing-accuracy
    // invariant). Legacy rows created before the freeze store lotCharge=0
    // with the lot folded into card.totalAmount; for those the card delta is
    // attributed to the card's first process so nothing is lost.
    const byProcess = new Map<string, { code: string; name: string; qty: number; weight: number; amount: number }>()
    let totalAmount = 0
    for (const card of inward.jobCards) {
      let cardLotStored = 0
      let firstProcessId: string | null = null
      for (const p of card.processes) {
        if (firstProcessId === null) firstProcessId = p.processId
        cardLotStored = r2(cardLotStored + (p.lotCharge ?? 0))
      }
      const cardRowSum = r2(card.processes.reduce((s, p) => s + p.amount, 0))
      // Legacy fallback: stored lots missing → derive from the card total
      const legacyLot = Math.max(0, r2(card.totalAmount - cardRowSum - cardLotStored))
      const applyLegacy = legacyLot > 0.004
      for (const p of card.processes) {
        const key = p.processId
        const prev = byProcess.get(key) ?? {
          code: p.process.code,
          name: p.process.name,
          qty: 0,
          weight: 0,
          amount: 0,
        }
        byProcess.set(key, {
          ...prev,
          qty: r2(prev.qty + p.qty),
          weight: r2(prev.weight + p.weight),
          amount: r2(prev.amount + p.amount + (p.lotCharge ?? 0)),
        })
        totalAmount = r2(totalAmount + p.amount + (p.lotCharge ?? 0))
        if (applyLegacy && p.processId === firstProcessId) {
          const entry = byProcess.get(key)!
          entry.amount = r2(entry.amount + legacyLot)
          totalAmount = r2(totalAmount + legacyLot)
        }
      }
    }

    const totalQty = r2(inward.items.reduce((s, i) => s + i.processedQty, 0))
    const totalWeight = r2(inward.items.reduce((s, i) => s + i.processedWeight, 0))
    const details = JSON.stringify([...byProcess.values()])

    return tx.jobworkCertificate.create({
      data: {
        certNo,
        inwardId: inward.id,
        date: d,
        totalQty,
        totalWeight,
        totalAmount,
        details,
      },
    })
  })
}

// ---------- Jobwork → Invoice (W5.4) ----------

export async function generateJobworkInvoice(inwardId: string, date?: string | Date) {
  return db.$transaction(async (tx) => {
    const inward = await tx.jobworkInward.findUnique({
      where: { id: inwardId },
      include: {
        party: true,
        items: true,
        jobCards: { where: { status: 'COMPLETED' }, include: { processes: { include: { process: true } } } },
        certificates: true,
      },
    })
    if (!inward) throw new BusinessError('Inward not found', 404)
    if (inward.status === 'INVOICED') throw new BusinessError('Inward is already invoiced')
    if (inward.status === 'CANCELLED') throw new BusinessError('Inward is cancelled')
    if (inward.jobCards.length === 0) {
      throw new BusinessError('No completed job cards on this inward — complete a job card first')
    }
    const activeCert = inward.certificates.find((c) => c.status === 'ISSUED')
    if (!activeCert) {
      throw new BusinessError('Issue the jobwork completion certificate before generating the GST invoice')
    }
    const cardTotal = r2(inward.jobCards.reduce((sum, card) => sum + card.totalAmount, 0))
    if (Math.abs(cardTotal - activeCert.totalAmount) > 0.01) {
      throw new BusinessError(
        `Certificate ${activeCert.certNo} value (${activeCert.totalAmount}) does not match completed job cards (${cardTotal}) — review the chain before invoicing`,
        409
      )
    }

    const serviceItem = await tx.item.findFirst({ where: { code: 'JW-SERVICE' } })
    if (!serviceItem) {
      throw new BusinessError('Service item "JW-SERVICE" is missing — seed masters first', 409)
    }

    // Aggregate per process from STORED rows: p.amount + p.lotCharge (lot
    // frozen at card post time — never recomputed from live rates), with a
    // legacy fallback for pre-freeze cards whose lot lives only in
    // card.totalAmount. Invoice lines therefore match card/certificate
    // totals exactly (billing-accuracy invariant).
    const byProcess = new Map<string, { name: string; amount: number }>()
    for (const card of inward.jobCards) {
      let cardLotStored = 0
      let firstProcessId: string | null = null
      for (const p of card.processes) {
        if (firstProcessId === null) firstProcessId = p.processId
        cardLotStored = r2(cardLotStored + (p.lotCharge ?? 0))
      }
      const cardRowSum = r2(card.processes.reduce((s, p) => s + p.amount, 0))
      const legacyLot = Math.max(0, r2(card.totalAmount - cardRowSum - cardLotStored))
      const applyLegacy = legacyLot > 0.004
      for (const p of card.processes) {
        const prev = byProcess.get(p.processId) ?? { name: p.process.name, amount: 0 }
        const add = r2(p.amount + (p.lotCharge ?? 0) + (applyLegacy && p.processId === firstProcessId ? legacyLot : 0))
        byProcess.set(p.processId, { ...prev, amount: r2(prev.amount + add) })
      }
    }

    const lines = [...byProcess.values()].map((v) => ({
      itemId: serviceItem.id,
      detail: `${v.name} — Jobwork ${inward.inwardNo}`,
      qty: 1,
      rate: v.amount,
    }))
    if (lines.length === 0) throw new BusinessError('Nothing to invoice')

    // Certificate is expected before invoice (compliance chain) but not hard-blocked in MVP
    await tx.jobworkInward.update({ where: { id: inward.id }, data: { status: 'INVOICED' } })

    // Reuse the full sales posting pipeline INSIDE this transaction (stock skip: service item; GL income → JWIN)
    return postSalesInvoiceTx(tx, {
      partyId: inward.partyId,
      date: date ?? new Date(),
      pos: inward.party.stateCode,
      taxInclusive: false,
      remarks: `Jobwork invoice for inward ${inward.inwardNo}`,
      source: 'JOBWORK',
      lines,
    })
  })
}

// ---------- Opening stock (W4) ----------

export interface PostOpeningInput {
  date?: string | Date
  warehouseId?: string | null
  rows: { itemId: string; qty: number; rate: number }[]
}

export async function postOpeningStock(input: PostOpeningInput) {
  if (!input.rows?.length) throw new BusinessError('Opening stock needs at least one row')
  return db.$transaction(
    async (tx) => {
      await getCompany(tx)
      const date = iso(input.date)
      const warehouseId = await resolveWarehouseId(tx, input.warehouseId)
      const voucherNo = await nextDocNo(tx, 'OPN', date)

      for (const r of input.rows) {
        const it = await tx.item.findUnique({ where: { id: r.itemId } })
        if (!it) throw new BusinessError(`Item ${r.itemId} not found`, 404)
        if (!(r.qty > 0)) throw new BusinessError(`Quantity must be positive for "${it.name}"`)
        if (r.rate < 0) throw new BusinessError(`Rate cannot be negative for "${it.name}"`)

        // Replace any previous live OPENING rows for (item, warehouse)
        const prev = await tx.stockLedger.findMany({
          where: { itemId: r.itemId, warehouseId, voucherType: 'OPENING', isCancelled: false },
        })
        for (const p of prev) {
          await tx.stockLedger.create({
            data: {
              postingDate: date,
              voucherType: 'OPENING',
              voucherNo: p.voucherNo,
              itemId: p.itemId,
              warehouseId: p.warehouseId,
              qtyIn: p.qtyOut,
              qtyOut: p.qtyIn,
              rate: p.rate,
              remarks: `Reversal of opening ${p.voucherNo}`,
              isCancelled: true,
            },
          })
        }
        if (prev.length > 0) {
          await tx.stockLedger.updateMany({
            where: { itemId: r.itemId, warehouseId, voucherType: 'OPENING', isCancelled: false },
            data: { isCancelled: true },
          })
        }

        await tx.stockLedger.create({
          data: {
            postingDate: date,
            voucherType: 'OPENING',
            voucherNo,
            itemId: r.itemId,
            warehouseId,
            qtyIn: r.qty,
            rate: r2(r.rate),
            remarks: 'Opening stock',
          },
        })
      }

      // GL mirror of the opening stock VALUE: Dr STKV / Cr OPEN so the trial
      // balance reconciles with the stock valuation (previously stock openings
      // never reached the GL and reports contradicted each other).
      // The OPENING-STOCK GL uses a fixed voucher number so a re-post fully
      // replaces the previous one (append-only: cancel + re-post).
      const glVoucherNo = 'OPENING-STOCK'
      await cancelGlForVoucher(tx, 'OPENING', glVoucherNo, date)
      const totalValue = r2(input.rows.reduce((s, r) => s + r.qty * r2(r.rate), 0))
      if (totalValue > 0.004) {
        await postGl(
          tx,
          { date, voucherType: 'OPENING', voucherNo: glVoucherNo },
          [
            { account: 'STKV', debit: totalValue, remarks: 'Opening stock valuation' },
            { account: 'OPEN', credit: totalValue, remarks: 'Opening stock valuation' },
          ]
        )
      }

      return { voucherNo, rows: input.rows.length }
    },
    // Opening entry can carry many rows (loops + per-row queries) — allow
    // longer than the 5s interactive default instead of aborting mid-post.
    { timeout: 20_000 }
  )
}

// ---------- Party opening balances (GL mirror) ----------

/**
 * Keep the party's opening balance mirrored in the GL (Dr DEBT / Cr CRED vs
 * OPEN) so outstanding + party ledger reconcile with the trial balance.
 * Idempotent: cancels the party's previous OPENING-PARTY GL rows and re-posts
 * the CURRENT full amount — call after every party create/update.
 */
export async function syncPartyOpeningBalance(partyId: string) {
  return db.$transaction(async (tx) => {
    const party = await tx.party.findUnique({ where: { id: partyId } })
    if (!party) throw new BusinessError('Party not found', 404)
    // Cancel EVERY live OPENING GL row for this party, whatever voucherNo it
    // was posted under. Legacy rows keyed by `OPENING-PARTY-<code>` broke when
    // the party code was renamed (the old voucherNo was never cancelled and a
    // second live opening was posted → double-counted opening in the trial
    // balance). Keying by the immutable partyId + cancelling by partyId makes
    // re-posting idempotent regardless of code edits.
    const live = await tx.accountLedger.findMany({
      where: { voucherType: 'OPENING', partyId, isCancelled: false },
      select: { voucherNo: true },
    })
    for (const v of new Set(live.map((r) => r.voucherNo))) {
      await cancelGlForVoucher(tx, 'OPENING', v, new Date())
    }
    const voucherNo = `OPENING-PARTY-${party.id}`
    const bal = r2(party.openingBal)
    if (Math.abs(bal) < 0.004) return { synced: true, amount: 0 }
    // + balance = customer owes us → Dr DEBT ; − balance = we owe supplier → Cr CRED
    const rows: Parameters<typeof postGl>[2] =
      bal > 0
        ? [
            { account: 'DEBT', partyId: party.id, debit: bal, remarks: `Opening balance — ${party.name}` },
            { account: 'OPEN', credit: bal, remarks: `Opening balance — ${party.name}` },
          ]
        : [
            { account: 'CRED', partyId: party.id, credit: -bal, remarks: `Opening balance — ${party.name}` },
            { account: 'OPEN', debit: -bal, remarks: `Opening balance — ${party.name}` },
          ]
    await postGl(tx, { date: new Date(), voucherType: 'OPENING', voucherNo }, rows)
    return { synced: true, amount: bal }
  })
}
