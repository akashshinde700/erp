import { ok, fail, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { completeWorkOrder, cancelWorkOrder } from '@/lib/manufacturing'

const actionSchema = z.object({ action: z.enum(['complete', 'cancel']) })

/** Work-order completion (guarded: every task must be completed first). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await assertMutationAccess()
    const { action } = actionSchema.parse(await req.json())
    if (action === 'complete') {
      const wo = await completeWorkOrder(id)
      await logAudit('POST', 'WorkOrder', id, `${wo.woNo} COMPLETED`)
      return ok(wo)
    }
    if (action === 'cancel') {
      const wo = await cancelWorkOrder(id)
      await logAudit('CANCEL', 'WorkOrder', id, `${wo.woNo} cancelled`)
      return ok(wo)
    }
    return fail('Unknown action', 400)
  } catch (e) {
    return handleError(e)
  }
}
