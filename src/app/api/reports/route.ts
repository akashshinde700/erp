import { ok, fail, handleError } from '@/lib/api'
import { assertCompanyAccess, assertFeature } from '@/lib/platform'
import { dateRangeError, monthString } from '@/lib/validation'
import {
  stockLedgerReport,
  stockSummaryReport,
  inventoryPlanningReport,
  supplierPerformanceReport,
  customerPerformanceReport,
  productionCostVarianceReport,
  productionEfficiencyReport,
  manufacturingCostVarianceReport,
  workflowActionCenterReport,
  gstr1Report,
  gstr3bReport,
  hsnSummaryReport,
  trialBalanceReport,
  outstandingReport,
  cashBankBookReport,
  pnlReport,
  partyLedgerReport,
  jobworkPendingReport,
} from '@/lib/reports'
import { agingReport, backOrderReport, pnlByLedgerReport, projectProfitabilityReport, purchaseBySupplierReport, salesAnalysisReport } from '@/lib/reports-extra'

/** from/to query range; defaults to the current financial year up to today. */
function range(sp: URLSearchParams): { from: Date; to: Date } | string {
  const now = new Date()
  const fyStart = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const from = sp.get('from') ?? `${fyStart}-04-01`
  const to = sp.get('to') ?? now.toISOString().slice(0, 10)
  const err = dateRangeError(from, to)
  if (err) return err
  return { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${to}T23:59:59.999Z`) }
}

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
      case 'production-cost-variance':
        return ok(await productionCostVarianceReport())
      case 'production-efficiency':
        return ok(await productionEfficiencyReport())
      case 'manufacturing-cost-variance':
        return ok(
          await manufacturingCostVarianceReport({
            from: sp.get('from') ?? undefined,
            to: sp.get('to') ?? undefined,
            workOrderId: sp.get('workOrderId') ?? undefined,
          })
        )
      case 'action-center':
        return ok(await workflowActionCenterReport())
      case 'gstr1': {
        const d = new Date()
        const month = sp.get('month') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (!monthString.safeParse(month).success) return fail('month must be YYYY-MM (01–12)')
        return ok(await gstr1Report(month))
      }
      case 'gstr3b': {
        const d = new Date()
        const month = sp.get('month') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (!monthString.safeParse(month).success) return fail('month must be YYYY-MM (01–12)')
        return ok(await gstr3bReport(month))
      }
      case 'hsn-summary': {
        const d = new Date()
        const month = sp.get('month') ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (!monthString.safeParse(month).success) return fail('month must be YYYY-MM (01–12)')
        return ok(await hsnSummaryReport(month))
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
      case 'back-orders':
        return ok(await backOrderReport())
      case 'aging': {
        const kind = (sp.get('kind') ?? 'sales').toLowerCase()
        if (kind !== 'sales' && kind !== 'purchase') return fail('kind is sales or purchase')
        return ok(await agingReport(kind === 'sales' ? 'SALES' : 'PURCHASE'))
      }
      case 'sales-analysis': {
        const r = range(sp)
        if (typeof r === 'string') return fail(r)
        return ok(await salesAnalysisReport(r.from, r.to))
      }
      case 'purchase-by-supplier': {
        const r = range(sp)
        if (typeof r === 'string') return fail(r)
        return ok(await purchaseBySupplierReport(r.from, r.to))
      }
      case 'pnl-ledger': {
        const r = range(sp)
        if (typeof r === 'string') return fail(r)
        return ok(await pnlByLedgerReport(r.from, r.to))
      }
      case 'project-profitability':
        return ok(await projectProfitabilityReport())
      default:
        return fail('Unknown report type. Use: stock-ledger, stock-summary, inventory-planning, supplier-performance, customer-performance, production-cost-variance, production-efficiency, manufacturing-cost-variance, action-center, gstr1, gstr3b, trial-balance, outstanding, cash-bank-book, pnl, party-ledger, jobwork-pending, back-orders, aging, sales-analysis, purchase-by-supplier, pnl-ledger, project-profitability')
    }
  } catch (e) {
    return handleError(e)
  }
}
