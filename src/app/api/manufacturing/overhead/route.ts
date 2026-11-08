import { z } from 'zod'
import { ok, handleError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { closeOverheadAbsorption, overheadAdvisor, setOverheadBudget, setOverheadRate, tagOverheadLedger } from '@/lib/overhead'
import { MAX_OVERHEAD_RATE_PCT } from '@/lib/costing'

/**
 * Overhead advisor.
 *  GET ?months=12&whatIf=18          → measured / trend / budget rates, recommendation,
 *                                       absorption tracker, what-if on open orders
 *  POST { action: 'set-rate', ratePct, reason }          OWNER only
 *  POST { action: 'set-budget', overheadAnnual, primeCostAnnual }   (null + null clears)
 *  POST { action: 'tag-ledger', ledgerId, isFactoryOverhead }
 *  POST { action: 'close', upTo: 'YYYY-MM-DD' }           Dr OVHA / Cr OVRC
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    const months = sp.get('months') ? Number(sp.get('months')) : undefined
    const w = sp.get('whatIf')
    const whatIfRatePct = w === null || w === '' ? null : Number(w)
    if (whatIfRatePct !== null && !Number.isFinite(whatIfRatePct)) return handleError(new z.ZodError([{ code: 'custom', path: ['whatIf'], message: 'whatIf must be a number', input: w }]))
    return ok(await overheadAdvisor({ months, whatIfRatePct }))
  } catch (e) {
    return handleError(e)
  }
}

const money = z.number().finite().min(0).max(1e12)
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set-rate'), ratePct: z.number().finite().min(0).max(MAX_OVERHEAD_RATE_PCT), reason: z.string().max(300) }),
  z.object({ action: z.literal('set-budget'), overheadAnnual: money.nullable(), primeCostAnnual: money.nullable() }),
  z.object({ action: z.literal('tag-ledger'), ledgerId: z.string().min(1), isFactoryOverhead: z.boolean() }),
  z.object({ action: z.literal('close'), upTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'upTo must be YYYY-MM-DD') }),
])

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const input = body.parse(await req.json())
    const who = actor?.email ?? null
    if (input.action === 'set-rate') {
      const r = await setOverheadRate({ ratePct: input.ratePct, reason: input.reason, actor })
      await logAudit('UPDATE', 'Company', undefined, `overhead absorption ${r.previous}% → ${r.overheadRatePct}%: ${r.overheadRateReason}`, who)
      return ok(r)
    }
    if (input.action === 'set-budget') {
      const r = await setOverheadBudget({ overheadAnnual: input.overheadAnnual, primeCostAnnual: input.primeCostAnnual, actor })
      await logAudit('UPDATE', 'Company', undefined, `overhead budget: overhead ${r.overheadBudgetAnnual ?? '—'} / prime cost ${r.primeCostBudgetAnnual ?? '—'}`, who)
      return ok(r)
    }
    if (input.action === 'tag-ledger') {
      const r = await tagOverheadLedger({ ledgerId: input.ledgerId, isFactoryOverhead: input.isFactoryOverhead })
      await logAudit('UPDATE', 'LedgerAccount', r.id, `${r.code} ${r.isFactoryOverhead ? 'added to' : 'removed from'} the factory overhead pool`, who)
      return ok(r)
    }
    const r = await closeOverheadAbsorption({ upTo: new Date(`${input.upTo}T00:00:00.000Z`), actor })
    await logAudit('CREATE', 'AccountLedger', r.voucherNo, `absorbed overhead cleared up to ${r.date}: ${r.cleared}`, who)
    return ok(r)
  } catch (e) {
    return handleError(e)
  }
}
