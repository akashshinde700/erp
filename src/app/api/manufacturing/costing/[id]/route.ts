import { ok, fail, handleError } from '@/lib/api'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { workOrderCost, workOrderCostVariance, trueUpWorkOrderOverhead } from '@/lib/costing'

/** GET — cost roll-up (material / labour / absorbed overhead) for one work order. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const [rollUp, variance] = await Promise.all([workOrderCost(id), workOrderCostVariance(id)])
    return ok({ ...variance, rollUp })
  } catch (e) {
    return handleError(e)
  }
}

/**
 * POST { action: 'true-up' } — restate absorbed overhead to the current policy
 * rate. Idempotent; posts one equalising entry and refuses a locked period
 * rather than silently dropping the difference.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    if (body.action !== 'true-up') return fail('Unknown action — use { "action": "true-up" }', 400)
    const res = await trueUpWorkOrderOverhead(id)
    await logAudit(
      'UPDATE',
      'WorkOrder',
      id,
      `${res.woNo} overhead true-up ${res.posted >= 0 ? '+' : ''}${res.posted} at ${res.overheadRatePct}%` +
        (res.date ? ` (posted ${res.date})` : ' (nothing to post)'),
      actor?.email
    )
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
