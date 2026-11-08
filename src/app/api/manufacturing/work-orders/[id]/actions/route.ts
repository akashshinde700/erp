import { ok, fail, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { completeWorkOrder, cancelWorkOrder, generateWorkOrderTasks } from '@/lib/manufacturing'

const actionSchema = z.object({
  action: z.enum(['complete', 'cancel', 'generate-tasks']),
  /** regenerate: drop untouched tasks and rebuild from the routing */
  replace: z.boolean().optional(),
})

/** Work-order completion (guarded: every task must be completed first). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const { action, replace } = actionSchema.parse(await req.json())
    if (action === 'generate-tasks') {
      const res = await generateWorkOrderTasks(id, { replace })
      await logAudit(
        'CREATE',
        'WorkOrder',
        id,
        `routing → ${res.created.length} task(s) created, ${res.updated} updated (${res.skipped} already present)`,
        actor?.email
      )
      return ok(res)
    }
    if (action === 'complete') {
      const wo = await completeWorkOrder(id)
      await logAudit('POST', 'WorkOrder', id, `${wo.woNo} COMPLETED`, actor?.email)
      return ok(wo)
    }
    if (action === 'cancel') {
      const wo = await cancelWorkOrder(id)
      await logAudit('CANCEL', 'WorkOrder', id, `${wo.woNo} cancelled`, actor?.email)
      return ok(wo)
    }
    return fail('Unknown action', 400)
  } catch (e) {
    return handleError(e)
  }
}
