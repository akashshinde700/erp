import { z } from 'zod'
import { fail, handleError, ok } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { withIdempotency } from '@/lib/idempotency'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import {
  ACCOUNT_NATURES, cancelJournal, chartOfAccounts, closeFinancialYear, createLedgerAccount, financialYears, listJournals,
  postJournal, seedDefaultTdsSections, setBooksLock, setLedgerActive, tdsReport, tdsSections, upsertTdsSection,
} from '@/lib/books'

const day = z.string().date('Use YYYY-MM-DD').transform((v) => new Date(`${v}T00:00:00.000Z`))
const money = z.number().min(0).finite().max(1_000_000_000)

/** GET /api/books — chart of accounts, journals, TDS sections, financial years.
 *  GET /api/books?report=tds&from=&to= — TDS deducted / suffered. */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    if (sp.get('report') === 'tds') {
      const from = sp.get('from'), to = sp.get('to')
      return ok(await tdsReport(from ? new Date(`${from}T00:00:00.000Z`) : undefined, to ? new Date(`${to}T23:59:59.999Z`) : undefined))
    }
    const [accounts, journals, tds, years] = await Promise.all([chartOfAccounts(), listJournals(), tdsSections(), financialYears()])
    return ok({ accounts, journals, tdsSections: tds, ...years })
  } catch (error) { return handleError(error) }
}

async function handlePost(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = await req.json()
    const action = String(body?.action ?? '')
    const who = actor?.email ?? undefined
    if (action === 'create-ledger') {
      const p = z.object({ code: z.string().trim().min(2).max(20), name: z.string().trim().min(2, 'Ledger name is required').max(80), group: z.string().trim().min(2, 'Group is required').max(60), nature: z.enum(ACCOUNT_NATURES) }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid ledger')
      const row = await createLedgerAccount({ ...p.data, createdBy: who })
      await logAudit('CREATE', 'LedgerAccount', row.id, `${row.code} ${row.name} (${row.nature})`, who)
      return ok(row)
    }
    if (action === 'set-ledger-active') {
      const p = z.object({ id: z.string().min(1), active: z.boolean() }).safeParse(body)
      if (!p.success) return fail('Ledger id and active flag are required')
      return ok(await setLedgerActive(p.data.id, p.data.active))
    }
    if (action === 'post-journal') {
      const p = z.object({
        date: day, narration: z.string().trim().min(3, 'Narration is required').max(1000),
        lines: z.array(z.object({ account: z.string().trim().min(2).max(20), partyId: z.string().min(1).optional().nullable(), debit: money.optional(), credit: money.optional(), remarks: z.string().max(200).optional().nullable() })).min(2, 'A journal needs at least two lines').max(50),
      }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid journal')
      const jv = await postJournal({ ...p.data, createdBy: who })
      await logAudit('POST', 'JournalVoucher', jv.id, `${jv.voucherNo} ₹${jv.total}: ${jv.narration}`, who)
      return ok(jv)
    }
    if (action === 'cancel-journal') {
      const p = z.object({ id: z.string().min(1), reason: z.string().trim().min(1, 'A cancellation reason is required').max(1000) }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid cancellation')
      const jv = await cancelJournal({ ...p.data, actor: who })
      await logAudit('CANCEL', 'JournalVoucher', p.data.id, `${jv?.voucherNo}: ${p.data.reason}`, who)
      return ok(jv)
    }
    if (action === 'upsert-tds-section') {
      const p = z.object({ section: z.string().trim().min(3).max(20), description: z.string().trim().min(2).max(120), ratePct: z.number().min(0).max(40), thresholdSingle: money.optional(), thresholdAnnual: money.optional(), active: z.boolean().optional() }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid TDS section')
      const row = await upsertTdsSection(p.data)
      await logAudit('UPDATE', 'TdsSection', row.id, `${row.section} @ ${row.ratePct}%`, who)
      return ok(row)
    }
    if (action === 'seed-tds-sections') return ok(await seedDefaultTdsSections())
    if (action === 'lock-books') {
      const p = z.object({ until: day.nullable(), reason: z.string().trim().max(1000).optional() }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid lock date')
      const res = await setBooksLock({ until: p.data.until, actor, reason: p.data.reason })
      await logAudit(res.reopened ? 'REOPEN' : 'LOCK', 'Books', undefined, `books locked until ${res.booksLockedUntil ?? 'none'} (was ${res.previous ?? 'none'})${p.data.reason ? `: ${p.data.reason}` : ''}`, who)
      return ok(res)
    }
    if (action === 'close-fy') {
      const p = z.object({ fy: z.string().regex(/^\d{4}$/, 'Financial year code looks like 2526') }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid financial year')
      const res = await closeFinancialYear(p.data.fy, actor)
      await logAudit('LOCK', 'Books', undefined, `FY ${p.data.fy} closed: books locked until ${res.booksLockedUntil}`, who)
      return ok(res)
    }
    return fail('Unknown books action')
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'books', (r) => handlePost(r))
}
