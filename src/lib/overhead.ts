/**
 * ForgeERP — overhead advisor.
 *
 * Instead of asking someone to guess an absorption percentage, the advisor
 * measures it from the books and keeps measuring it:
 *
 *   1. POOL      — organisation ledgers tagged as factory overhead (power,
 *                  factory rent, plant depreciation, consumables, supervision…).
 *                  Incurred overhead = Σ (Dr − Cr) on those ledgers.
 *   2. BASE      — prime cost (material + labour) of operations completed in
 *                  the same months — the base the absorption rate applies to.
 *   3. RATES     — actual (incurred ÷ prime over the window), trend (the same
 *                  ratio with recent months weighted more — an exponentially
 *                  weighted moving average, so a new power tariff shows up in
 *                  weeks, not at year end) and budget (predetermined: budgeted
 *                  annual overhead ÷ budgeted annual prime cost, if entered).
 *   4. ADVICE    — recommended rate = budget if entered (the accounting
 *                  standard for absorption), else trend; with a confidence
 *                  grade and the reasons behind it.
 *   5. TRACKER   — absorbed vs incurred per month: over- / under-absorption,
 *                  and what is still parked in OVHA.
 *   6. WHAT-IF   — the effect of a candidate rate on open work orders (the
 *                  true-up it would post) and on next month's absorption.
 *   7. CLOSE     — period-end clearing: Dr OVHA / Cr OVRC for the absorbed
 *                  balance, so P&L shows incurred − recovered = the real
 *                  under/over-absorption instead of a growing accrual.
 *
 * Nothing here changes the absorption rate on its own: applying a rate is an
 * explicit OWNER action with a written reason, audited.
 */
import { db } from './db'
import { BusinessError, assertPeriodOpen, postGl } from './accounting'
import { EPS, r2 } from './erp'
import { tenantCompany } from './tenant'
import { MAX_OVERHEAD_RATE_PCT, OVERHEAD_ACCOUNT } from './costing'

const RECOVERY_ACCOUNT = 'OVRC' as const
/** Weight decay per month for the trend rate (0.35 → last 3 months ≈ 70 % of the weight). */
const TREND_ALPHA = 0.35
const ABSORB_VOUCHERS = ['MFG_OVERHEAD', 'MFG_OVERHEAD_TRUEUP']
export const CLOSE_VOUCHER = 'MFG_OVERHEAD_CLOSE'

const monthKey = (d: Date) => d.toISOString().slice(0, 7)
const round05 = (n: number) => Math.round(n * 2) / 2
const pct = (num: number, den: number) => (den > EPS ? r2((num / den) * 100) : null)

async function org() {
  const company = await tenantCompany(db)
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  return company
}

export interface AdvisorMonth {
  month: string
  incurred: number
  primeCost: number
  absorbed: number
  /** absorbed − incurred: positive = over-absorbed, negative = under-absorbed. */
  overUnder: number
  actualRatePct: number | null
  tasks: number
}

export async function overheadAdvisor(input: { months?: number; asOf?: Date; whatIfRatePct?: number | null } = {}) {
  const company = await org()
  const months = Math.min(24, Math.max(3, Math.trunc(input.months ?? 12)))
  const asOf = input.asOf ?? new Date()
  const end = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), 23, 59, 59, 999))
  const from = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (months - 1), 1))
  const keys: string[] = []
  for (let i = 0; i < months; i++) keys.push(monthKey(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1))))
  const bucket = new Map<string, AdvisorMonth>(keys.map((k) => [k, { month: k, incurred: 0, primeCost: 0, absorbed: 0, overUnder: 0, actualRatePct: null, tasks: 0 }]))

  // 1. pool
  const ledgers = await db.ledgerAccount.findMany({ where: { companyId: company.id, nature: 'EXPENSE' }, orderBy: { code: 'asc' } })
  const pool = ledgers.filter((l) => l.isFactoryOverhead)
  const poolCodes = pool.map((l) => l.code)
  const spend = poolCodes.length
    ? await db.accountLedger.findMany({ where: { companyId: company.id, account: { in: poolCodes }, isCancelled: false, date: { gte: from, lte: end } }, select: { account: true, date: true, debit: true, credit: true } })
    : []
  const byLedger = new Map<string, number>()
  for (const r of spend) {
    const b = bucket.get(monthKey(r.date)); if (!b) continue
    b.incurred = r2(b.incurred + r.debit - r.credit)
    byLedger.set(r.account, r2((byLedger.get(r.account) ?? 0) + r.debit - r.credit))
  }
  // 2. base
  const tasks = await db.productionTask.findMany({
    where: { status: 'COMPLETED', completedAt: { gte: from, lte: end } },
    select: { completedAt: true, materialCost: true, labourCost: true, hours: true },
  })
  let hours = 0
  for (const t of tasks) {
    const b = bucket.get(monthKey(t.completedAt!)); if (!b) continue
    b.primeCost = r2(b.primeCost + t.materialCost + t.labourCost)
    b.tasks++
    hours += t.hours
  }
  // 5. absorbed (accrual + true-ups; the period-end clearing is not absorption)
  const absorbedRows = await db.accountLedger.findMany({
    where: { companyId: company.id, account: OVERHEAD_ACCOUNT, voucherType: { in: ABSORB_VOUCHERS }, isCancelled: false, date: { gte: from, lte: end } },
    select: { date: true, debit: true, credit: true },
  })
  for (const r of absorbedRows) {
    const b = bucket.get(monthKey(r.date)); if (b) b.absorbed = r2(b.absorbed + r.credit - r.debit)
  }
  const series = keys.map((k) => {
    const b = bucket.get(k)!
    return { ...b, overUnder: r2(b.absorbed - b.incurred), actualRatePct: pct(b.incurred, b.primeCost) }
  })
  const incurred = r2(series.reduce((s, m) => s + m.incurred, 0))
  const primeCost = r2(series.reduce((s, m) => s + m.primeCost, 0))
  const absorbed = r2(series.reduce((s, m) => s + m.absorbed, 0))
  const taskCount = series.reduce((s, m) => s + m.tasks, 0)

  // 3. rates
  const actualRatePct = pct(incurred, primeCost)
  let wInc = 0, wPrime = 0
  series.forEach((m, i) => {
    const w = Math.pow(1 - TREND_ALPHA, series.length - 1 - i)
    wInc += w * m.incurred
    wPrime += w * m.primeCost
  })
  const trendRatePct = pct(wInc, wPrime)
  const budgetRatePct =
    company.overheadBudgetAnnual != null && company.primeCostBudgetAnnual != null && company.primeCostBudgetAnnual > EPS
      ? r2((company.overheadBudgetAnnual / company.primeCostBudgetAnnual) * 100)
      : null

  // 4. advice
  const source = budgetRatePct != null ? 'BUDGET' : trendRatePct != null ? 'TREND' : null
  const raw = source === 'BUDGET' ? budgetRatePct! : source === 'TREND' ? trendRatePct! : null
  const recommendedRatePct = raw == null ? null : Math.min(MAX_OVERHEAD_RATE_PCT, Math.max(0, round05(raw)))
  const monthsWithData = series.filter((m) => m.primeCost > EPS && m.incurred > EPS)
  const rates = monthsWithData.map((m) => m.actualRatePct!)
  const mean = rates.length ? rates.reduce((s, x) => s + x, 0) / rates.length : 0
  const cv = rates.length > 1 && mean > EPS ? Math.sqrt(rates.reduce((s, x) => s + (x - mean) ** 2, 0) / (rates.length - 1)) / mean : null
  const reasons: string[] = []
  let score = 0
  if (!pool.length) reasons.push('No ledger is tagged as factory overhead yet — tag power, factory rent, plant depreciation, consumables and supervision ledgers')
  else score += 1
  if (monthsWithData.length >= 6) score += 2
  else if (monthsWithData.length >= 3) { score += 1; reasons.push(`Only ${monthsWithData.length} months have both overhead spend and production — 6+ give a steadier rate`) }
  else reasons.push(`${monthsWithData.length} month(s) with both overhead spend and production — too little history to trust a measured rate`)
  if (taskCount >= 20) score += 1
  else reasons.push(`${taskCount} operations completed in the window — the base is thin`)
  if (cv != null && cv <= 0.35) score += 1
  else if (cv != null) reasons.push(`Monthly rates swing a lot (variation ${Math.round(cv * 100)}%) — seasonal spend or lumpy production`)
  if (source === 'BUDGET') { score += 1; reasons.push('Recommendation uses your budget (predetermined rate); the measured trend is shown for comparison') }
  const confidence = recommendedRatePct == null ? 'NONE' : score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW'

  // tracker: OVHA still parked (absorbed and not yet cleared), all time
  const ovha = await db.accountLedger.aggregate({ where: { companyId: company.id, account: OVERHEAD_ACCOUNT, isCancelled: false, date: { lte: end } }, _sum: { debit: true, credit: true } })
  const ovhaBalance = r2((ovha._sum.credit ?? 0) - (ovha._sum.debit ?? 0))
  const lastClose = await db.accountLedger.findFirst({ where: { companyId: company.id, voucherType: CLOSE_VOUCHER, isCancelled: false }, orderBy: { date: 'desc' }, select: { date: true, voucherNo: true } })

  // 6. what-if
  const candidate = input.whatIfRatePct ?? recommendedRatePct
  let whatIf: {
    ratePct: number
    openOrders: number
    openOrderTrueUp: number
    orders: { woNo: string; current: number; atRate: number; delta: number }[]
    projectedMonthlyAbsorption: number
    projectedMonthlyIncurred: number
    projectedMonthlyOverUnder: number
  } | null = null
  if (candidate != null) {
    if (!(candidate >= 0 && candidate <= MAX_OVERHEAD_RATE_PCT)) throw new BusinessError(`What-if rate must be between 0 and ${MAX_OVERHEAD_RATE_PCT}%`, 400)
    const open = await db.workOrder.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: { woNo: true, overheadCost: true, tasks: { where: { status: 'COMPLETED' }, select: { materialCost: true, labourCost: true } } },
    })
    let trueUp = 0
    const orders: { woNo: string; current: number; atRate: number; delta: number }[] = []
    for (const wo of open) {
      const prime = wo.tasks.reduce((s, t) => s + t.materialCost + t.labourCost, 0)
      if (prime <= EPS) continue
      const atRate = r2(prime * (candidate / 100))
      const delta = r2(atRate - wo.overheadCost)
      trueUp = r2(trueUp + delta)
      if (Math.abs(delta) > EPS) orders.push({ woNo: wo.woNo, current: wo.overheadCost, atRate, delta })
    }
    const recent = series.slice(-3).filter((m) => m.primeCost > EPS)
    const basis = recent.length ? recent : monthsWithData
    const avgPrime = basis.length ? r2(basis.reduce((s, m) => s + m.primeCost, 0) / basis.length) : 0
    const avgIncurred = basis.length ? r2(basis.reduce((s, m) => s + m.incurred, 0) / basis.length) : 0
    const monthlyAbsorption = r2(avgPrime * (candidate / 100))
    whatIf = {
      ratePct: candidate,
      openOrders: orders.length,
      openOrderTrueUp: trueUp,
      orders: orders.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10),
      projectedMonthlyAbsorption: monthlyAbsorption,
      projectedMonthlyIncurred: avgIncurred,
      projectedMonthlyOverUnder: r2(monthlyAbsorption - avgIncurred),
    }
  }

  return {
    window: { from: from.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), months },
    current: {
      ratePct: company.overheadRatePct,
      setAt: company.overheadRateSetAt,
      setBy: company.overheadRateSetBy,
      reason: company.overheadRateReason,
    },
    budget: { overheadAnnual: company.overheadBudgetAnnual, primeCostAnnual: company.primeCostBudgetAnnual },
    rates: { actualRatePct, trendRatePct, budgetRatePct, labourHourRate: hours > EPS ? r2(incurred / hours) : null },
    recommendation: {
      ratePct: recommendedRatePct,
      source,
      confidence,
      reasons,
      gapPct: recommendedRatePct == null ? null : r2(recommendedRatePct - company.overheadRatePct),
    },
    totals: { incurred, primeCost, absorbed, overUnder: r2(absorbed - incurred), tasks: taskCount, hours: r2(hours) },
    ovha: { balance: ovhaBalance, lastClose: lastClose ? { date: lastClose.date.toISOString().slice(0, 10), voucherNo: lastClose.voucherNo } : null },
    ledgers: ledgers.map((l) => ({ id: l.id, code: l.code, name: l.name, group: l.group, active: l.active, isFactoryOverhead: l.isFactoryOverhead, incurred: byLedger.get(l.code) ?? 0 })),
    series,
    whatIf,
  }
}

// ---------------------------------------------------------------- actions

type Actor = { role: string; email: string | null } | null

/** Apply an absorption rate. OWNER only, with a written reason — this is accounting policy. */
export async function setOverheadRate(input: { ratePct: number; reason: string; actor: Actor }) {
  if (input.actor && input.actor.role !== 'OWNER') throw new BusinessError('Only the OWNER can change the overhead absorption rate', 403)
  const rate = Number(input.ratePct)
  if (!(rate >= 0 && rate <= MAX_OVERHEAD_RATE_PCT)) throw new BusinessError(`Absorption rate must be between 0 and ${MAX_OVERHEAD_RATE_PCT}%`, 400)
  const reason = String(input.reason ?? '').trim()
  if (reason.length < 10) throw new BusinessError('Give the reason for this rate (at least 10 characters) — e.g. "FY27 budget approved by CA"', 400)
  const company = await org()
  const previous = company.overheadRatePct
  const updated = await db.company.update({
    where: { id: company.id },
    data: { overheadRatePct: r2(rate), overheadRateSetAt: new Date(), overheadRateSetBy: input.actor?.email ?? null, overheadRateReason: reason.slice(0, 300) },
    select: { overheadRatePct: true, overheadRateSetAt: true, overheadRateSetBy: true, overheadRateReason: true },
  })
  return { previous, ...updated }
}

export async function setOverheadBudget(input: { overheadAnnual: number | null; primeCostAnnual: number | null; actor: Actor }) {
  if (input.actor && input.actor.role === 'VIEWER') throw new BusinessError('Read-only login', 403)
  const both = input.overheadAnnual != null && input.primeCostAnnual != null
  const none = input.overheadAnnual == null && input.primeCostAnnual == null
  if (!both && !none) throw new BusinessError('Enter both budgeted overhead and budgeted prime cost, or clear both', 400)
  if (both && (!(input.overheadAnnual! >= 0) || !(input.primeCostAnnual! > 0))) throw new BusinessError('Budgeted overhead must be ≥ 0 and budgeted prime cost > 0', 400)
  if (both && (input.overheadAnnual! / input.primeCostAnnual!) * 100 > MAX_OVERHEAD_RATE_PCT) {
    throw new BusinessError(`That budget implies a rate above ${MAX_OVERHEAD_RATE_PCT}% — check the figures`, 400)
  }
  const company = await org()
  return db.company.update({
    where: { id: company.id },
    data: { overheadBudgetAnnual: both ? r2(input.overheadAnnual!) : null, primeCostBudgetAnnual: both ? r2(input.primeCostAnnual!) : null },
    select: { overheadBudgetAnnual: true, primeCostBudgetAnnual: true },
  })
}

export async function tagOverheadLedger(input: { ledgerId: string; isFactoryOverhead: boolean }) {
  const company = await org()
  const ledger = await db.ledgerAccount.findFirst({ where: { id: input.ledgerId, companyId: company.id } })
  if (!ledger) throw new BusinessError('Ledger not found', 404)
  if (input.isFactoryOverhead && ledger.nature !== 'EXPENSE') throw new BusinessError(`${ledger.code} is a ${ledger.nature} ledger — only expense ledgers can be factory overhead`, 400)
  return db.ledgerAccount.update({ where: { id: ledger.id }, data: { isFactoryOverhead: input.isFactoryOverhead }, select: { id: true, code: true, isFactoryOverhead: true } })
}

/**
 * Period-end clearing of absorbed overhead: Dr OVHA / Cr OVRC for the OVHA
 * balance up to `upTo`. Idempotent per date; refuses a locked period.
 */
export async function closeOverheadAbsorption(input: { upTo: Date; actor: Actor }) {
  if (input.actor && input.actor.role === 'VIEWER') throw new BusinessError('Read-only login', 403)
  const upTo = new Date(Date.UTC(input.upTo.getUTCFullYear(), input.upTo.getUTCMonth(), input.upTo.getUTCDate()))
  if (Number.isNaN(upTo.getTime())) throw new BusinessError('Invalid date', 400)
  if (upTo.getTime() > Date.now()) throw new BusinessError('Absorption can only be closed up to today', 400)
  return db.$transaction(async (tx) => {
    const company = await tenantCompany(tx)
    if (!company) throw new BusinessError('Operating company is not configured', 409)
    const voucherNo = `OVC-${upTo.toISOString().slice(0, 10).replace(/-/g, '')}`
    const dup = await tx.accountLedger.findFirst({ where: { companyId: company.id, voucherType: CLOSE_VOUCHER, voucherNo, isCancelled: false }, select: { id: true } })
    if (dup) throw new BusinessError(`Absorbed overhead was already closed up to ${upTo.toISOString().slice(0, 10)} (${voucherNo})`, 409)
    const end = new Date(upTo.getTime() + 86_400_000 - 1)
    const agg = await tx.accountLedger.aggregate({ where: { companyId: company.id, account: OVERHEAD_ACCOUNT, isCancelled: false, date: { lte: end } }, _sum: { debit: true, credit: true } })
    const balance = r2((agg._sum.credit ?? 0) - (agg._sum.debit ?? 0))
    if (balance <= 0.004) throw new BusinessError('Nothing to close: no absorbed overhead is parked in Factory Overhead Absorbed', 409)
    await assertPeriodOpen(tx, upTo)
    await postGl(tx, { date: upTo, voucherType: CLOSE_VOUCHER, voucherNo }, [
      { account: OVERHEAD_ACCOUNT, debit: balance, remarks: `Clear absorbed overhead up to ${upTo.toISOString().slice(0, 10)}` },
      { account: RECOVERY_ACCOUNT, credit: balance, remarks: `Overhead recovered through production up to ${upTo.toISOString().slice(0, 10)}` },
    ])
    return { voucherNo, date: upTo.toISOString().slice(0, 10), cleared: balance }
  })
}
