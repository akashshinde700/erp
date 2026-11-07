import { ok, fail, handleError } from '@/lib/api'
import { assertCompanyAccess, assertFeature } from '@/lib/platform'
import { dateRangeError, monthString } from '@/lib/validation'
import {
  stockLedgerReport,
  stockSummaryReport,
  inventoryPlanningReport,
  supplierPerformanceReport,
  customerPerformanceReport,
  gstr1Report,
  trialBalanceReport,
  outstandingReport,
  cashBankBookReport,
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
      case 'stock-ledger': {
        const rangeErr = dateRangeError(sp.get('from'), sp.get('to'))
        if (rangeErr) return fail(rangeErr)
        return ok(await stockLedgerReport({
          itemId: sp.get('itemId') ?? undefined,
          warehouseId: sp.get('warehouseId') ?? undefined,
          from: sp.get('from') ?? undefined,
          to: sp.get('to') ?? undefined,
        }))
      }
      case 'stock-summary':
        return ok(await stockSummaryReport())
      case 'inventory-planning':
        return ok(await inventoryPlanningReport())
      case 'supplier-performance':
        return ok(await supplierPerformanceReport())
      case 'customer-performance':
        return ok(await customerPerformanceReport())
      case 'gstr1': {
        const d = new Date()
        const month = sp.get('month') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (!monthString.safeParse(month).success) return fail('month must be YYYY-MM (01–12)')
        return ok(await gstr1Report(month))
      }
      case 'trial-balance': {
        const rangeErr = dateRangeError(sp.get('from'), sp.get('to'))
        if (rangeErr) return fail(rangeErr)
        return ok(await trialBalanceReport(sp.get('from') ?? undefined, sp.get('to') ?? undefined))
      }
      case 'outstanding':
        return ok(await outstandingReport())
      case 'cash-bank-book': {
        const d = new Date()
        const from = sp.get('from') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        const to = sp.get('to') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`
        const rangeErr = dateRangeError(from, to)
        if (rangeErr) return fail(rangeErr)
        return ok(await cashBankBookReport(from, to))
      }
      case 'pnl': {
        const d = new Date()
        const from = sp.get('from') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        const to = sp.get('to') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`
        const rangeErr = dateRangeError(from, to)
        if (rangeErr) return fail(rangeErr)
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
        return fail('Unknown report type. Use: stock-ledger, stock-summary, inventory-planning, supplier-performance, customer-performance, gstr1, trial-balance, outstanding, cash-bank-book, pnl, party-ledger, jobwork-pending')
    }
  } catch (e) {
    return handleError(e)
  }
}
