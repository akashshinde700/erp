/**
 * ForgeERP — analysis reports: back orders, receivable / payable aging by
 * due date (party credit days), sales by customer / product / salesperson,
 * purchase history by supplier, P&L by ledger, project profitability.
 */
import { db } from './db'
import { r2, EPS } from './erp'
import { natureOf } from './books'

const DAY = 86_400_000
const BUCKETS = [
  { key: 'notDue', label: 'Not due' },
  { key: 'd0_30', label: '1-30 days' },
  { key: 'd31_60', label: '31-60 days' },
  { key: 'd61_90', label: '61-90 days' },
  { key: 'd90p', label: 'Over 90 days' },
] as const
type BucketKey = (typeof BUCKETS)[number]['key']
const bucketOf = (daysOverdue: number): BucketKey => (daysOverdue <= 0 ? 'notDue' : daysOverdue <= 30 ? 'd0_30' : daysOverdue <= 60 ? 'd31_60' : daysOverdue <= 90 ? 'd61_90' : 'd90p')

/** Open sales-order quantity not yet dispatched (approved / part-dispatched orders). */
export async function backOrderReport() {
  const orders = await db.salesOrder.findMany({
    where: { status: { in: ['APPROVED', 'PART_DISPATCHED'] } },
    include: { party: { select: { code: true, name: true } }, lines: { include: { item: { select: { code: true, name: true, uom: true } } } } },
    orderBy: [{ deliveryDate: 'asc' }, { date: 'asc' }],
  })
  const itemIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemId)))]
  const stock = itemIds.length ? await db.stockLedger.groupBy({ by: ['itemId'], where: { itemId: { in: itemIds }, isCancelled: false, voucherType: { not: 'JOBWORK_IN' } }, _sum: { qtyIn: true, qtyOut: true } }) : []
  const onHand = new Map(stock.map((s) => [s.itemId, r2((s._sum.qtyIn ?? 0) - (s._sum.qtyOut ?? 0))]))
  const now = Date.now()
  const rows = orders.flatMap((o) => o.lines.map((l) => {
    const pending = r2(l.qty - l.dispatchedQty)
    return {
      orderNo: o.orderNo, orderId: o.id, date: o.date, deliveryDate: o.deliveryDate, customer: o.party.name, item: l.item.code, itemName: l.item.name, uom: l.item.uom,
      ordered: l.qty, dispatched: l.dispatchedQty, pending, pendingValue: r2(pending * l.rate), onHand: onHand.get(l.itemId) ?? 0,
      late: !!o.deliveryDate && o.deliveryDate.getTime() < now,
    }
  })).filter((r) => r.pending > EPS)
  return { rows, totalPendingValue: r2(rows.reduce((s, r) => s + r.pendingValue, 0)), lateLines: rows.filter((r) => r.late).length }
}

/** Receivable (SALES) or payable (PURCHASE) aging by due date = invoice date + party credit days. */
export async function agingReport(kind: 'SALES' | 'PURCHASE', asOf = new Date()) {
  const select = { id: true, invoiceNo: true, date: true, grandTotal: true, paidAmount: true, party: { select: { id: true, code: true, name: true, creditDays: true } } }
  const invoices = kind === 'SALES'
    ? await db.salesInvoice.findMany({ where: { status: 'POSTED' }, select })
    : await db.purchaseInvoice.findMany({ where: { status: 'POSTED' }, select })
  const open = invoices.map((i) => {
    const balance = r2(i.grandTotal - i.paidAmount)
    const due = new Date(i.date.getTime() + i.party.creditDays * DAY)
    const daysOverdue = Math.floor((asOf.getTime() - due.getTime()) / DAY)
    return { invoiceNo: i.invoiceNo, date: i.date, dueDate: due, partyId: i.party.id, party: i.party.name, partyCode: i.party.code, creditDays: i.party.creditDays, total: i.grandTotal, balance, daysOverdue, bucket: bucketOf(daysOverdue) }
  }).filter((i) => i.balance > 0.004)
  const byParty = new Map<string, { partyId: string; party: string; code: string; total: number } & Record<BucketKey, number>>()
  for (const i of open) {
    const row = byParty.get(i.partyId) ?? { partyId: i.partyId, party: i.party, code: i.partyCode, total: 0, notDue: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 }
    row[i.bucket] = r2(row[i.bucket] + i.balance)
    row.total = r2(row.total + i.balance)
    byParty.set(i.partyId, row)
  }
  const totals = Object.fromEntries(BUCKETS.map((b) => [b.key, r2(open.filter((i) => i.bucket === b.key).reduce((s, i) => s + i.balance, 0))])) as Record<BucketKey, number>
  const grand = r2(open.reduce((s, i) => s + i.balance, 0))
  const overdue = r2(grand - totals.notDue)
  return {
    kind, asOf: asOf.toISOString().slice(0, 10), buckets: BUCKETS, invoices: open.sort((a, b) => b.daysOverdue - a.daysOverdue),
    parties: [...byParty.values()].sort((a, b) => b.total - a.total), totals, total: grand, overdue,
    // one consistent measure: share of the open balance that is past due (no separate "collection progress")
    overduePct: grand > 0 ? r2((overdue * 100) / grand) : 0,
  }
}

/** Sales analysis for a date range: by customer, by product, by salesperson (posted invoices, net of nothing else). */
export async function salesAnalysisReport(from: Date, to: Date) {
  const invoices = await db.salesInvoice.findMany({
    where: { status: 'POSTED', date: { gte: from, lte: to } },
    include: { party: { select: { code: true, name: true } }, salesperson: { select: { name: true } }, items: { include: { item: { select: { code: true, name: true, uom: true } } } } },
  })
  const add = <K extends string>(m: Map<K, { key: K; label: string; taxable: number; total: number; count: number; qty?: number }>, key: K, label: string, taxable: number, total: number, qty?: number) => {
    const row = m.get(key) ?? { key, label, taxable: 0, total: 0, count: 0, ...(qty !== undefined ? { qty: 0 } : {}) }
    row.taxable = r2(row.taxable + taxable); row.total = r2(row.total + total); row.count++
    if (qty !== undefined) row.qty = r2((row.qty ?? 0) + qty)
    m.set(key, row)
  }
  const byCustomer = new Map(), byProduct = new Map(), bySalesperson = new Map()
  for (const inv of invoices) {
    add(byCustomer, inv.partyId, `${inv.party.name} (${inv.party.code})`, inv.taxable, inv.grandTotal)
    add(bySalesperson, inv.salespersonId ?? '-', inv.salesperson?.name ?? 'Unassigned', inv.taxable, inv.grandTotal)
    for (const l of inv.items) add(byProduct, l.itemId, `${l.item.code} ${l.item.name}`, l.taxable, l.total, l.qty)
  }
  const sort = (m: Map<string, { taxable: number }>) => [...m.values()].sort((a, b) => b.taxable - a.taxable)
  return {
    from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
    invoices: invoices.length, taxable: r2(invoices.reduce((s, i) => s + i.taxable, 0)), total: r2(invoices.reduce((s, i) => s + i.grandTotal, 0)),
    byCustomer: sort(byCustomer), byProduct: sort(byProduct), bySalesperson: sort(bySalesperson),
  }
}

/** Purchase history by supplier: PO value, received / accepted / rejected, billed, on-time receipt share. */
export async function purchaseBySupplierReport(from: Date, to: Date) {
  const pos = await db.purchaseOrder.findMany({
    where: { date: { gte: from, lte: to }, status: { notIn: ['CANCELLED', 'DRAFT'] } },
    include: { supplier: { select: { id: true, code: true, name: true } }, lines: true },
  })
  const bills = await db.purchaseInvoice.findMany({ where: { status: 'POSTED', date: { gte: from, lte: to } }, select: { partyId: true, taxable: true, grandTotal: true } })
  const map = new Map<string, { supplierId: string; supplier: string; orders: number; ordered: number; receivedQty: number; acceptedQty: number; rejectedQty: number; orderedQty: number; billed: number }>()
  for (const po of pos) {
    const row = map.get(po.supplierId) ?? { supplierId: po.supplierId, supplier: `${po.supplier.name} (${po.supplier.code})`, orders: 0, ordered: 0, receivedQty: 0, acceptedQty: 0, rejectedQty: 0, orderedQty: 0, billed: 0 }
    row.orders++
    for (const l of po.lines) { row.ordered = r2(row.ordered + l.amount); row.orderedQty = r2(row.orderedQty + l.qty); row.receivedQty = r2(row.receivedQty + l.receivedQty); row.acceptedQty = r2(row.acceptedQty + l.acceptedQty); row.rejectedQty = r2(row.rejectedQty + l.rejectedQty) }
    map.set(po.supplierId, row)
  }
  for (const b of bills) { const row = map.get(b.partyId); if (row) row.billed = r2(row.billed + b.taxable) }
  const rows = [...map.values()].map((r) => ({ ...r, fillRatePct: r.orderedQty > 0 ? r2((r.receivedQty * 100) / r.orderedQty) : 0, rejectionPct: r.receivedQty > 0 ? r2((r.rejectedQty * 100) / r.receivedQty) : 0 })).sort((a, b) => b.ordered - a.ordered)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), rows }
}

/** P&L by ledger: every INCOME / EXPENSE account (system and organisation ledgers). */
export async function pnlByLedgerReport(from: Date, to: Date) {
  const nature = await natureOf()
  const rows = await db.accountLedger.groupBy({ by: ['account', 'accountName'], where: { isCancelled: false, date: { gte: from, lte: to } }, _sum: { debit: true, credit: true } })
  const lines = rows
    .map((r) => ({ account: r.account, name: r.accountName, nature: nature.get(r.account) ?? 'ASSET', net: r2((r._sum.credit ?? 0) - (r._sum.debit ?? 0)) }))
    .filter((r) => r.nature === 'INCOME' || r.nature === 'EXPENSE')
  const income = lines.filter((l) => l.nature === 'INCOME').map((l) => ({ ...l, amount: l.net })).sort((a, b) => b.amount - a.amount)
  const expenses = lines.filter((l) => l.nature === 'EXPENSE').map((l) => ({ ...l, amount: r2(-l.net) })).sort((a, b) => b.amount - a.amount)
  const totalIncome = r2(income.reduce((s, l) => s + l.amount, 0))
  const totalExpenses = r2(expenses.reduce((s, l) => s + l.amount, 0))
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), income, expenses, totalIncome, totalExpenses, netProfit: r2(totalIncome - totalExpenses) }
}

/** Project profitability: contract value vs estimated and actual cost (materials + labour from production tasks), invoiced so far. */
export async function projectProfitabilityReport() {
  const projects = await db.project.findMany({
    where: { status: { not: 'CANCELLED' } },
    include: { party: { select: { name: true } }, workOrders: { include: { tasks: { where: { status: { not: 'CANCELLED' } }, select: { materialCost: true, labourCost: true, hours: true } } } } },
    orderBy: { createdAt: 'desc' },
  })
  return projects.map((p) => {
    const material = r2(p.workOrders.reduce((s, w) => s + w.tasks.reduce((t, x) => t + x.materialCost, 0), 0))
    const labour = r2(p.workOrders.reduce((s, w) => s + w.tasks.reduce((t, x) => t + x.labourCost, 0), 0))
    const hours = r2(p.workOrders.reduce((s, w) => s + w.tasks.reduce((t, x) => t + x.hours, 0), 0))
    const actual = r2(material + labour)
    return {
      id: p.id, projectNo: p.projectNo, name: p.name, customer: p.party.name, status: p.status, contractValue: p.budget, estCost: p.estCost,
      material, labour, hours, actualCost: actual, costVariance: r2(actual - p.estCost), costUsedPct: p.estCost > 0 ? r2((actual * 100) / p.estCost) : null,
      expectedMargin: r2(p.budget - p.estCost), marginToDate: r2(p.budget - actual), workOrders: p.workOrders.length,
    }
  })
}
