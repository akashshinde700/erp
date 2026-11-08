/**
 * ForgeERP — books controls: organisation ledgers, manual journal vouchers,
 * TDS sections and the books lock (period / financial-year close).
 *
 * Journal vouchers go through postGl, so they are balanced by construction
 * and respect the books lock. System control accounts that are driven by
 * stock or work-in-progress documents (STKV, WIP) cannot be journalised:
 * a manual entry there would make the GL disagree with the stock ledger.
 */
import { Prisma } from '@prisma/client'
import { db } from './db'
import { ACCOUNTS, BusinessError, cancelGlForVoucher, postGl, type GlRowInput } from './accounting'
import { fyCode, r2 } from './erp'
import { tenantCompany } from './tenant'

type Tx = Prisma.TransactionClient

async function org(tx: Tx) {
  const company = await tenantCompany(tx)
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  return company
}

export const ACCOUNT_NATURES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const
export type AccountNature = (typeof ACCOUNT_NATURES)[number]

/** Nature of each system account, for the chart of accounts and P&L. */
const SYSTEM_NATURE: Record<string, AccountNature> = {
  DEBT: 'ASSET', CRED: 'LIABILITY', STKV: 'ASSET', WIP: 'ASSET', LABP: 'LIABILITY', MFGV: 'EXPENSE', OVHA: 'LIABILITY',
  SALS: 'INCOME', JWIN: 'INCOME', PURC: 'EXPENSE', CGSTP: 'LIABILITY', SGSTP: 'LIABILITY', IGSTP: 'LIABILITY',
  CGSTI: 'ASSET', SGSTI: 'ASSET', IGSTI: 'ASSET', CASH: 'ASSET', BANK: 'ASSET', RND: 'EXPENSE', OPEN: 'EQUITY',
  TDSP: 'LIABILITY', TDSR: 'ASSET', STADJ: 'EXPENSE',
}
/** Accounts a manual journal may not touch (their balance must come from stock / production documents). */
const NOT_JOURNALISABLE = new Set(['STKV', 'WIP'])
/** Control accounts that need a party so the sub-ledger stays complete. */
const PARTY_ACCOUNTS = new Set(['DEBT', 'CRED'])

/** Full chart of accounts: system accounts + the organisation's own ledgers. */
export async function chartOfAccounts() {
  const own = await db.ledgerAccount.findMany({ orderBy: { code: 'asc' } })
  const system = Object.values(ACCOUNTS).map((a) => ({
    code: a.code, name: a.name, group: a.group, nature: SYSTEM_NATURE[a.code] ?? 'ASSET', system: true, active: true,
    journalisable: !NOT_JOURNALISABLE.has(a.code), needsParty: PARTY_ACCOUNTS.has(a.code),
  }))
  return [
    ...system,
    ...own.map((a) => ({ id: a.id, code: a.code, name: a.name, group: a.group, nature: a.nature, system: false, active: a.active, journalisable: a.active, needsParty: false })),
  ]
}

export async function natureOf(): Promise<Map<string, AccountNature>> {
  const map = new Map<string, AccountNature>(Object.entries(SYSTEM_NATURE))
  for (const a of await db.ledgerAccount.findMany({ select: { code: true, nature: true } })) map.set(a.code, a.nature as AccountNature)
  return map
}

export async function createLedgerAccount(input: { code: string; name: string; group: string; nature: AccountNature; createdBy?: string }) {
  const code = input.code.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) throw new BusinessError('Ledger code: 2-20 letters, digits, - or _')
  if ((ACCOUNTS as Record<string, unknown>)[code]) throw new BusinessError(`${code} is a system account code`, 409)
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    if (await tx.ledgerAccount.findFirst({ where: { code } })) throw new BusinessError(`Ledger ${code} already exists`, 409)
    return tx.ledgerAccount.create({ data: { companyId: company.id, code, name: input.name.trim(), group: input.group.trim(), nature: input.nature, createdBy: input.createdBy } })
  })
}

export async function setLedgerActive(id: string, active: boolean) {
  const row = await db.ledgerAccount.findFirst({ where: { id } })
  if (!row) throw new BusinessError('Ledger not found', 404)
  return db.ledgerAccount.update({ where: { id }, data: { active } })
}

// ---------------------------------------------------------------- journal vouchers

export interface JournalInput {
  date: Date
  narration: string
  lines: { account: string; partyId?: string | null; debit?: number; credit?: number; remarks?: string | null }[]
  createdBy?: string
}

async function nextJvNo(tx: Tx, companyId: string, date: Date) {
  const display = `JV-${fyCode(date)}`
  const key = `${companyId}:${display}`
  const row = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } })
  return `${display}-${String(row.value).padStart(3, '0')}`
}

export async function postJournal(input: JournalInput) {
  if (input.lines.length < 2) throw new BusinessError('A journal needs at least two lines (one debit, one credit)')
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const own = await tx.ledgerAccount.findMany({ where: { active: true } })
    const rows: GlRowInput[] = []
    for (const [i, l] of input.lines.entries()) {
      const debit = r2(l.debit ?? 0), credit = r2(l.credit ?? 0)
      if (debit < 0 || credit < 0) throw new BusinessError(`Line ${i + 1}: amounts cannot be negative`)
      if ((debit > 0) === (credit > 0)) throw new BusinessError(`Line ${i + 1}: enter either a debit or a credit`)
      const code = l.account.trim().toUpperCase()
      const sys = (ACCOUNTS as Record<string, { code: string; name: string }>)[code]
      const ledger = own.find((a) => a.code === code)
      if (!sys && !ledger) throw new BusinessError(`Line ${i + 1}: ledger ${code} not found or inactive`, 404)
      if (NOT_JOURNALISABLE.has(code)) throw new BusinessError(`Line ${i + 1}: ${sys!.name} is driven by stock and production documents and cannot be journalised`)
      if (PARTY_ACCOUNTS.has(code) && !l.partyId) throw new BusinessError(`Line ${i + 1}: ${sys!.name} needs a party`)
      if (l.partyId && !(await tx.party.findFirst({ where: { id: l.partyId } }))) throw new BusinessError(`Line ${i + 1}: party not found`, 404)
      rows.push({ account: code, accountName: sys?.name ?? ledger!.name, partyId: l.partyId ?? null, debit, credit, remarks: l.remarks ?? null })
    }
    const total = r2(rows.reduce((s, r) => s + (r.debit ?? 0), 0))
    const voucherNo = await nextJvNo(tx, company.id, input.date)
    await postGl(tx, { date: input.date, voucherType: 'JOURNAL', voucherNo }, rows) // asserts Dr = Cr and the books lock
    return tx.journalVoucher.create({
      data: {
        companyId: company.id, voucherNo, date: input.date, narration: input.narration.trim(), total, createdBy: input.createdBy,
        lines: { create: rows.map((r) => ({ account: r.account, accountName: r.accountName!, partyId: r.partyId ?? null, debit: r.debit ?? 0, credit: r.credit ?? 0, remarks: r.remarks ?? null })) },
      },
      include: { lines: true },
    })
  })
}

export async function cancelJournal(input: { id: string; reason: string; actor?: string }) {
  return db.$transaction(async (tx) => {
    const jv = await tx.journalVoucher.findFirst({ where: { id: input.id } })
    if (!jv) throw new BusinessError('Journal not found', 404)
    const upd = await tx.journalVoucher.updateMany({ where: { id: jv.id, status: 'POSTED' }, data: { status: 'CANCELLED', cancelReason: input.reason, cancelledBy: input.actor } })
    if (upd.count !== 1) throw new BusinessError('Journal is already cancelled', 409)
    await cancelGlForVoucher(tx, 'JOURNAL', jv.voucherNo, new Date())
    return tx.journalVoucher.findFirst({ where: { id: jv.id }, include: { lines: true } })
  })
}

export function listJournals() {
  return db.journalVoucher.findMany({ orderBy: [{ date: 'desc' }, { voucherNo: 'desc' }], take: 500, include: { lines: true } })
}

// ---------------------------------------------------------------- TDS sections

/** Common Income-tax Act sections (rates for resident payees with PAN). The
 *  organisation can edit rates and thresholds; nothing is posted automatically. */
export const DEFAULT_TDS_SECTIONS = [
  { section: '194C-IND', description: 'Contractors: individual / HUF', ratePct: 1, thresholdSingle: 30000, thresholdAnnual: 100000 },
  { section: '194C', description: 'Contractors: others (incl. jobwork)', ratePct: 2, thresholdSingle: 30000, thresholdAnnual: 100000 },
  { section: '194J', description: 'Professional / technical services', ratePct: 10, thresholdSingle: 0, thresholdAnnual: 30000 },
  { section: '194H', description: 'Commission or brokerage', ratePct: 5, thresholdSingle: 0, thresholdAnnual: 15000 },
  { section: '194I', description: 'Rent: plant and machinery', ratePct: 2, thresholdSingle: 0, thresholdAnnual: 240000 },
  { section: '194Q', description: 'Purchase of goods', ratePct: 0.1, thresholdSingle: 0, thresholdAnnual: 5000000 },
]

export async function tdsSections() {
  return db.tdsSection.findMany({ orderBy: { section: 'asc' } })
}

export async function upsertTdsSection(input: { section: string; description: string; ratePct: number; thresholdSingle?: number; thresholdAnnual?: number; active?: boolean }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const section = input.section.trim().toUpperCase()
    const data = { description: input.description.trim(), ratePct: input.ratePct, thresholdSingle: input.thresholdSingle ?? 0, thresholdAnnual: input.thresholdAnnual ?? 0, active: input.active ?? true }
    const existing = await tx.tdsSection.findFirst({ where: { section } })
    return existing ? tx.tdsSection.update({ where: { id: existing.id }, data }) : tx.tdsSection.create({ data: { companyId: company.id, section, ...data } })
  })
}

export async function seedDefaultTdsSections() {
  const have = new Set((await db.tdsSection.findMany({ select: { section: true } })).map((s) => s.section))
  for (const s of DEFAULT_TDS_SECTIONS) if (!have.has(s.section)) await upsertTdsSection(s)
  return tdsSections()
}

/** TDS deducted (payable) and suffered (receivable) by section and party. */
export async function tdsReport(from?: Date, to?: Date) {
  const payments = await db.payment.findMany({
    where: { status: 'POSTED', tdsAmount: { gt: 0 }, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: { party: { select: { code: true, name: true } }, tdsSection: true },
    orderBy: { date: 'asc' },
  })
  const rows = payments.map((p) => ({
    paymentNo: p.paymentNo, date: p.date, type: p.type, party: p.party.name, partyCode: p.party.code,
    section: p.tdsSection?.section ?? '', ratePct: p.tdsSection?.ratePct ?? 0, settled: r2(p.amount + p.tdsAmount), tds: p.tdsAmount, net: p.amount,
  }))
  const bySection = new Map<string, { section: string; payable: number; receivable: number; count: number }>()
  for (const r of rows) {
    const s = bySection.get(r.section) ?? { section: r.section, payable: 0, receivable: 0, count: 0 }
    if (r.type === 'PAYMENT') s.payable = r2(s.payable + r.tds); else s.receivable = r2(s.receivable + r.tds)
    s.count++
    bySection.set(r.section, s)
  }
  const gl = await db.accountLedger.groupBy({ by: ['account'], where: { isCancelled: false, account: { in: ['TDSP', 'TDSR'] } }, _sum: { debit: true, credit: true } })
  const bal = (code: string) => { const g = gl.find((x) => x.account === code); return r2((g?._sum.credit ?? 0) - (g?._sum.debit ?? 0)) }
  return {
    rows,
    sections: [...bySection.values()],
    totalPayable: r2(rows.filter((r) => r.type === 'PAYMENT').reduce((s, r) => s + r.tds, 0)),
    totalReceivable: r2(rows.filter((r) => r.type === 'RECEIPT').reduce((s, r) => s + r.tds, 0)),
    // GL balances: TDS payable still to deposit (credit) and receivable still to claim (debit)
    glPayableBalance: bal('TDSP'),
    glReceivableBalance: r2(-bal('TDSR')),
  }
}

// ---------------------------------------------------------------- books lock / financial years

/** Financial years that have postings, with their lock state. */
export async function financialYears() {
  const company = await tenantCompany(db)
  const range = await db.accountLedger.aggregate({ _min: { date: true }, _max: { date: true }, where: { isCancelled: false } })
  const lock = company?.booksLockedUntil ?? null
  const years: { code: string; start: string; end: string; closed: boolean; partlyLocked: boolean }[] = []
  const now = new Date()
  // include closed years even when they hold no postings (e.g. the year before go-live)
  const first = lock && (!range._min.date || lock < range._min.date) ? lock : range._min.date ?? now
  const last = (range._max.date ?? now) > now ? range._max.date! : now
  const fyStartYear = (d: Date) => (d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1)
  for (let y = fyStartYear(first); y <= fyStartYear(last); y++) {
    const start = new Date(Date.UTC(y, 3, 1)), end = new Date(Date.UTC(y + 1, 2, 31))
    years.push({ code: fyCode(start), start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), closed: !!lock && lock >= end, partlyLocked: !!lock && lock >= start && lock < end })
  }
  return { booksLockedUntil: lock ? lock.toISOString().slice(0, 10) : null, booksLockedBy: company?.booksLockedBy ?? null, years: years.reverse() }
}

/**
 * Move the books lock. Moving it forward closes the period up to that date;
 * moving it back (re-opening) is OWNER-only and needs a reason (audited by the route).
 * The lock can never be in the future: today's postings must stay possible.
 */
export async function setBooksLock(input: { until: Date | null; actor: { role: string; email: string | null } | null; reason?: string }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')
    if (input.until && input.until >= today) throw new BusinessError('The lock date must be before today')
    const current = company.booksLockedUntil
    const reopening = !!current && (!input.until || input.until < current)
    if (reopening) {
      if (input.actor && input.actor.role !== 'OWNER' && input.actor.role !== 'SUPER_ADMIN') throw new BusinessError('Only the OWNER can re-open a closed period', 403)
      if (!input.reason?.trim()) throw new BusinessError('A reason is required to re-open a closed period')
    }
    if (!reopening && input.actor && input.actor.role !== 'OWNER' && input.actor.role !== 'ACCOUNTANT' && input.actor.role !== 'SUPER_ADMIN') throw new BusinessError('Only the OWNER or an ACCOUNTANT can close books', 403)
    await tx.company.update({ where: { id: company.id }, data: { booksLockedUntil: input.until, booksLockedBy: input.actor?.email ?? 'setup' } })
    return { booksLockedUntil: input.until ? input.until.toISOString().slice(0, 10) : null, reopened: reopening, previous: current ? current.toISOString().slice(0, 10) : null }
  })
}

/** Close a financial year (e.g. "2526"): lock the books up to its 31 March. */
export async function closeFinancialYear(code: string, actor: { role: string; email: string | null } | null) {
  if (!/^\d{4}$/.test(code)) throw new BusinessError('Financial year code looks like 2526')
  const startYear = 2000 + Number(code.slice(0, 2))
  if (Number(code.slice(2)) !== (startYear + 1) % 100) throw new BusinessError('Financial year code looks like 2526')
  const end = new Date(Date.UTC(startYear + 1, 2, 31))
  const company = await tenantCompany(db)
  if (company?.booksLockedUntil && company.booksLockedUntil >= end) throw new BusinessError(`FY ${code} is already closed`, 409)
  return setBooksLock({ until: end, actor })
}
