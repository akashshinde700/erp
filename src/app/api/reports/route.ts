import { ok, fail, handleError } from '@/lib/api'
import { assertCompanyAccess, assertFeature } from '@/lib/platform'
import {
  stockLedgerReport,
  stockSummaryReport,
  gstr1Report,
  trialBalanceReport,
  outstandingReport,
  pnlReport,
  partyLedgerReport,
  jobworkPendingReport,
} from '@/lib/reports'

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    await assertFeature('advancedReports')
    const url = new URL(req.url)
    const sp = url.searchParams
    const type = sp.get('type')
    switch (type) {
      case 'stock-ledger':
        return ok(await stockLedgerReport({
          itemId: sp.get('itemId') ?? undefined,
          warehouseId: sp.get('warehouseId') ?? undefined,
          from: sp.get('from') ?? undefined,
          to: sp.get('to') ?? undefined,
        }))
      case 'stock-summary':
        return ok(await stockSummaryReport())
      case 'gstr1': {
        const d = new Date()
        const month = sp.get('month') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (!/^\d{4}-\d{2}$/.test(month)) return fail('month must be YYYY-MM')
        return ok(await gstr1Report(month))
      }
      case 'trial-balance':
        return ok(await trialBalanceReport(sp.get('from') ?? undefined, sp.get('to') ?? undefined))
      case 'outstanding':
        return ok(await outstandingReport())
      case 'pnl': {
        const d = new Date()
        const from = sp.get('from') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        const to = sp.get('to') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`
        return ok(await pnlReport(from, to))
      }
      case 'party-ledger': {
        const partyId = sp.get('partyId')
        if (!partyId) return fail('partyId is required')
        const data = await partyLedgerReport(partyId)
        if (!data) return fail('Party not found', 404)
        return ok(data)
      }
      case 'jobwork-pending':
        return ok(await jobworkPendingReport())
      default:
        return fail('Unknown report type. Use: stock-ledger, stock-summary, gstr1, trial-balance, outstanding, pnl, party-ledger, jobwork-pending')
    }
  } catch (e) {
    return handleError(e)
  }
}
