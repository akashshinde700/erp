/**
 * ForgeERP — Report computations (W6).
 * All reports derive from the append-only ledgers with isCancelled = false,
 * so report ≡ print ≡ invoice by construction (shared engine totals).
 */
import { db } from './db'
import { r2 } from './erp'

// ---------- Stock ledger with running balance ----------

export async function stockLedgerReport(filter: {
  itemId?: string
  warehouseId?: string
  from?: string
  to?: string
}) {
  const where: any = { isCancelled: false }
  if (filter.itemId) where.itemId = filter.itemId
  if (filter.warehouseId) where.warehouseId = filter.warehouseId
  if (filter.from || filter.to) {
    where.postingDate = {}
    if (filter.from) where.postingDate.gte = new Date(filter.from)
    if (filter.to) where.postingDate.lte = new Date(`${filter.to}T23:59:59`)
  }
  const rows = await db.stockLedger.findMany({
    where,
    orderBy: [{ postingDate: 'asc' }, { createdAt: 'asc' }],
    include: { item: true, warehouse: true },
  })
  let bal = 0
  let value = 0
  const out = rows.map((r) => {
    bal = r2(bal + r.qtyIn - r.qtyOut)
    const avg = bal > 0 ? r2(r.rate) : 0
    value = r2(value + (r.qtyIn - r.qtyOut) * r.rate)
    return { ...r, balance: bal, value: r2(Math.max(0, value)) , avgCost: avg }
  })
  return out
}

// ---------- Stock summary ----------

export async function stockSummaryReport() {
  const items = await db.item.findMany({ where: { isStockItem: true }, orderBy: { code: 'asc' } })
  const led = await db.stockLedger.findMany({ where: { isCancelled: false } })
  const byItem = new Map<string, { inQty: number; outQty: number; inValue: number }>()
  for (const l of led) {
    const prev = byItem.get(l.itemId) ?? { inQty: 0, outQty: 0, inValue: 0 }
    byItem.set(l.itemId, {
      inQty: r2(prev.inQty + l.qtyIn),
      outQty: r2(prev.outQty + l.qtyOut),
      inValue: r2(prev.inValue + l.qtyIn * l.rate),
    })
  }
  return items.map((it) => {
    const s = byItem.get(it.id) ?? { inQty: 0, outQty: 0, inValue: 0 }
    const closing = r2(s.inQty - s.outQty)
    const avgCost = s.inQty > 0 ? r2(s.inValue / s.inQty) : 0
    return {
      item: { id: it.id, code: it.code, name: it.name, uom: it.uom, reorderLevel: it.reorderLevel, hsn: it.hsn },
      inQty: s.inQty,
      outQty: s.outQty,
      closing,
      avgCost,
      closingValue: r2(closing * avgCost),
      lowStock: it.reorderLevel > 0 && closing < it.reorderLevel,
    }
  })
}

// ---------- GSTR-1 summary (B2B / B2C, rate-wise) ----------

export async function gstr1Report(month: string) {
  // month = 'YYYY-MM'
  const from = new Date(`${month}-01T00:00:00`)
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 0, 23, 59, 59)
  const invoices = await db.salesInvoice.findMany({
    where: { date: { gte: from, lte: to }, status: 'POSTED' },
    include: { items: true, party: true },
  })
  type Bucket = { count: number; taxable: number; cgst: number; sgst: number; igst: number }
  const b2b = new Map<number, Bucket>()
  const b2c = new Map<number, Bucket>()
  const push = (m: Map<number, Bucket>, rate: number, tax: { taxable: number; cgst: number; sgst: number; igst: number }) => {
    const b = m.get(rate) ?? { count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    m.set(rate, {
      count: b.count + 1,
      taxable: r2(b.taxable + tax.taxable),
      cgst: r2(b.cgst + tax.cgst),
      sgst: r2(b.sgst + tax.sgst),
      igst: r2(b.igst + tax.igst),
    })
  }
  let b2bCount = 0
  let b2cCount = 0
  for (const inv of invoices) {
    const isB2b = !!inv.party.gstin
    if (isB2b) b2bCount++
    else b2cCount++
    // group invoice lines by rate — each rate bucket gets only its own lines
    const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>()
    for (const line of inv.items) {
      const b = byRate.get(line.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
      byRate.set(line.gstRate, {
        taxable: r2(b.taxable + line.taxable),
        cgst: r2(b.cgst + line.cgst),
        sgst: r2(b.sgst + line.sgst),
        igst: r2(b.igst + line.igst),
      })
    }
    for (const [rate, tax] of byRate) {
      push(isB2b ? b2b : b2c, rate, tax)
    }
  }
  const total = (m: Map<number, Bucket>) => {
    let taxable = 0, cgst = 0, sgst = 0, igst = 0, count = 0
    for (const b of m.values()) {
      taxable = r2(taxable + b.taxable); cgst = r2(cgst + b.cgst)
      sgst = r2(sgst + b.sgst); igst = r2(igst + b.igst); count += b.count
    }
    return { count, taxable, cgst, sgst, igst }
  }
  return {
    month,
    invoiceCount: invoices.length,
    b2bCount,
    b2cCount,
    b2b: [...b2b.entries()].map(([rate, b]) => ({ rate, ...b })).sort((a, b) => a.rate - b.rate),
    b2c: [...b2c.entries()].map(([rate, b]) => ({ rate, ...b })).sort((a, b) => a.rate - b.rate),
    b2bTotal: total(b2b),
    b2cTotal: total(b2c),
  }
}

// ---------- Trial balance ----------

export async function trialBalanceReport(from?: string, to?: string) {
  const where: any = { isCancelled: false }
  if (from || to) {
    where.date = {}
    if (from) where.date.gte = new Date(from)
    if (to) where.date.lte = new Date(`${to}T23:59:59`)
  }
  const rows = await db.accountLedger.findMany({ where })
  const byAcc = new Map<string, { account: string; accountName: string; debit: number; credit: number }>()
  for (const r of rows) {
    const prev = byAcc.get(r.account) ?? { account: r.account, accountName: r.accountName, debit: 0, credit: 0 }
    byAcc.set(r.account, {
      ...prev,
      debit: r2(prev.debit + r.debit),
      credit: r2(prev.credit + r.credit),
    })
  }
  const accounts = [...byAcc.values()]
    .map((a) => ({ ...a, closing: r2(a.debit - a.credit) }))
    .sort((a, b) => a.account.localeCompare(b.account))
  const totalDr = r2(accounts.reduce((s, a) => s + a.debit, 0))
  const totalCr = r2(accounts.reduce((s, a) => s + a.credit, 0))
  return {
    accounts,
    totalDr,
    totalCr,
    balanced: Math.abs(totalDr - totalCr) <= 0.005,
  }
}

// ---------- Outstanding (receivables / payables) ----------

export async function outstandingReport() {
  const parties = await db.party.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
  const sales = await db.salesInvoice.findMany({ where: { status: 'POSTED' } })
  const purchases = await db.purchaseInvoice.findMany({ where: { status: 'POSTED' } })
  const bySales = new Map<string, number>()
  for (const s of sales) bySales.set(s.partyId, r2((bySales.get(s.partyId) ?? 0) + s.grandTotal - s.paidAmount))
  const byPurch = new Map<string, number>()
  for (const p of purchases) byPurch.set(p.partyId, r2((byPurch.get(p.partyId) ?? 0) + p.grandTotal - p.paidAmount))
  const customers = parties
    .filter((p) => p.types.includes('CUSTOMER'))
    .map((p) => ({
      party: { id: p.id, code: p.code, name: p.name, stateCode: p.stateCode, openingBal: p.openingBal },
      amount: r2((bySales.get(p.id) ?? 0) + Math.max(0, p.openingBal)),
    }))
    .filter((r) => r.amount > 0.004)
  const suppliers = parties
    .filter((p) => p.types.includes('SUPPLIER'))
    .map((p) => ({
      party: { id: p.id, code: p.code, name: p.name, stateCode: p.stateCode, openingBal: p.openingBal },
      amount: r2((byPurch.get(p.id) ?? 0) + Math.max(0, -p.openingBal)),
    }))
    .filter((r) => r.amount > 0.004)
  return {
    customers,
    suppliers,
    totalReceivable: r2(customers.reduce((s, r) => s + r.amount, 0)),
    totalPayable: r2(suppliers.reduce((s, r) => s + r.amount, 0)),
  }
}

// ---------- P&L (period) ----------

export async function pnlReport(from: string, to: string) {
  const fromDate = new Date(from)
  const toDate = new Date(`${to}T23:59:59`)
  const led = await db.accountLedger.findMany({
    where: { isCancelled: false, date: { gte: fromDate, lte: toDate } },
  })
  const net = (code: string) => {
    const rows = led.filter((l) => l.account === code)
    const dr = r2(rows.reduce((s, l) => s + l.debit, 0))
    const cr = r2(rows.reduce((s, l) => s + l.credit, 0))
    return r2(cr - dr) // positive = income-side
  }
  const sales = net('SALS')
  const jobworkIncome = net('JWIN')
  const purchases = -net('PURC') // positive = expense
  const roundOff = net('RND')
  const revenue = r2(sales + jobworkIncome)
  const grossProfit = r2(revenue - purchases)
  return {
    from,
    to,
    sales,
    jobworkIncome,
    purchases,
    roundOff,
    revenue,
    grossProfit,
    netProfit: r2(grossProfit + roundOff),
  }
}

// ---------- Party ledger ----------

export async function partyLedgerReport(partyId: string) {
  const party = await db.party.findUnique({ where: { id: partyId } })
  if (!party) return null
  const rows = await db.accountLedger.findMany({
    where: { partyId, isCancelled: false },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })
  let bal = party.openingBal // + receivable
  const out = rows.map((r) => {
    bal = r2(bal + r.debit - r.credit)
    return { ...r, balance: bal }
  })
  return { party, openingBal: party.openingBal, rows, closing: bal }
}

// ---------- Jobwork pending ----------

export async function jobworkPendingReport() {
  const inwards = await db.jobworkInward.findMany({
    where: { status: { in: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] } },
    include: {
      party: true,
      items: { include: { item: true } },
      jobCards: {
        where: { status: 'COMPLETED' },
        include: { processes: { include: { process: true } } },
      },
    },
    orderBy: { date: 'desc' },
  })
  const processes = await db.process.findMany({ where: { active: true }, orderBy: { seq: 'asc' } })
  return inwards.map((iw) => ({
    inward: { id: iw.id, inwardNo: iw.inwardNo, date: iw.date, status: iw.status, party: { name: iw.party.name, code: iw.party.code } },
    items: iw.items.map((it) => {
      const doneProcessIds = new Set(
        iw.jobCards.flatMap((c) => c.processes.filter((p) => p.inwardItemId === it.id).map((p) => p.processId))
      )
      return {
        item: { id: it.item.id, code: it.item.code, name: it.item.name, uom: it.item.uom },
        batchNo: it.batchNo,
        receivedQty: it.qty,
        processedQty: it.processedQty,
        remainingQty: r2(it.qty - it.processedQty),
        receivedWeight: it.weight,
        processedWeight: it.processedWeight,
        remainingWeight: r2(it.weight - it.processedWeight),
        pendingProcesses: processes
          .filter((p) => !doneProcessIds.has(p.id))
          .map((p) => ({ id: p.id, code: p.code, name: p.name })),
      }
    }),
    cardValue: r2(iw.jobCards.reduce((s, c) => s + c.totalAmount, 0)),
  }))
}

// ---------- Dashboard ----------

export async function dashboardData() {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

  const [salesMonth, purchaseMonth, salesAll, purchaseAll, parties, stockSummary, jobwork, recent] =
    await Promise.all([
      db.salesInvoice.aggregate({ where: { status: 'POSTED', date: { gte: monthStart } }, _sum: { grandTotal: true } }),
      db.purchaseInvoice.aggregate({ where: { status: 'POSTED', date: { gte: monthStart } }, _sum: { grandTotal: true } }),
      db.salesInvoice.findMany({ where: { status: 'POSTED' }, select: { date: true, grandTotal: true } }),
      db.purchaseInvoice.findMany({ where: { status: 'POSTED' }, select: { date: true, grandTotal: true } }),
      db.party.findMany({ where: { active: true } }),
      stockSummaryReport(),
      db.jobworkInward.findMany({
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] } },
        include: { jobCards: { where: { status: 'COMPLETED' } } },
      }),
      db.salesInvoice.findMany({
        where: { status: 'POSTED' },
        orderBy: { date: 'desc' },
        take: 8,
        include: { party: { select: { name: true } } },
      }),
    ])

  // outstanding from live invoices
  const salesPaid = await db.salesInvoice.aggregate({ where: { status: 'POSTED' }, _sum: { paidAmount: true } })
  const purchPaid = await db.purchaseInvoice.aggregate({ where: { status: 'POSTED' }, _sum: { paidAmount: true } })
  const receivables = r2(
    (salesAll.reduce((s, i) => s + i.grandTotal, 0) - (salesPaid._sum.paidAmount ?? 0)) +
      parties.filter((p) => p.types.includes('CUSTOMER')).reduce((s, p) => s + Math.max(0, p.openingBal), 0)
  )
  const payables = r2(
    (purchaseAll.reduce((s, i) => s + i.grandTotal, 0) - (purchPaid._sum.paidAmount ?? 0)) +
      parties.filter((p) => p.types.includes('SUPPLIER')).reduce((s, p) => s + Math.max(0, -p.openingBal), 0)
  )

  // 6-month trend
  const trend: { month: string; label: string; sales: number; purchase: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKey(d)
    trend.push({
      month: key,
      label: d.toLocaleDateString('en-IN', { month: 'short' }),
      sales: r2(salesAll.filter((s) => monthKey(new Date(s.date)) === key).reduce((s, x) => s + x.grandTotal, 0)),
      purchase: r2(purchaseAll.filter((p) => monthKey(new Date(p.date)) === key).reduce((s, x) => s + x.grandTotal, 0)),
    })
  }

  const stockValue = r2(stockSummary.reduce((s, i) => s + i.closingValue, 0))
  const openJobworkValue = r2(
    jobwork.reduce((s, iw) => s + iw.jobCards.reduce((x, c) => x + c.totalAmount, 0), 0)
  )
  const lowStock = stockSummary.filter((i) => i.lowStock)

  return {
    monthSales: r2(salesMonth._sum.grandTotal ?? 0),
    monthPurchase: r2(purchaseMonth._sum.grandTotal ?? 0),
    receivables,
    payables,
    stockValue,
    openJobworkValue,
    trend,
    recentInvoices: recent.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      date: i.date,
      party: i.party.name,
      grandTotal: i.grandTotal,
      paidAmount: i.paidAmount,
      source: i.source,
    })),
    lowStock: lowStock.map((i) => ({
      code: i.item.code,
      name: i.item.name,
      closing: i.closing,
      reorderLevel: i.item.reorderLevel,
      uom: i.item.uom,
    })),
  }
}
