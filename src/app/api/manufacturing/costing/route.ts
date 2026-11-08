import { ok, handleError } from '@/lib/api'
import { manufacturingCostVarianceReport } from '@/lib/reports'
import { overheadRatePct, bomStandardCost } from '@/lib/costing'
import { db } from '@/lib/db'
import { assertCompanyAccess } from '@/lib/platform'

/**
 * GET /api/manufacturing/costing
 *   ?bomId=…    standard cost of one revision (material + routed labour + overhead)
 *   otherwise   expected-vs-actual cost of every work order
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    const rate = await overheadRatePct()
    const bomId = sp.get('bomId')
    if (bomId) {
      const bom = await db.bom.findUnique({ where: { id: bomId }, select: { bomNo: true, revision: true, status: true } })
      const standard = await bomStandardCost(bomId, { overheadRatePct: rate })
      return ok({ bom, overheadRatePct: rate, standard })
    }
    const report = await manufacturingCostVarianceReport({
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      workOrderId: sp.get('workOrderId') ?? undefined,
    })
    return ok({ overheadRatePct: rate, ...report })
  } catch (e) {
    return handleError(e)
  }
}
