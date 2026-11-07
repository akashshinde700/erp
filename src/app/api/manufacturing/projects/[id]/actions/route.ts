import { ok, fail, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { startProject, completeProject, cancelProject } from '@/lib/manufacturing'

const actionSchema = z.object({ action: z.enum(['start', 'complete', 'cancel']) })

/** The project completion process (and start/cancel) — one guarded endpoint. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const { action } = actionSchema.parse(await req.json())
    if (action === 'start') {
      const p = await startProject(id)
      await logAudit('POST', 'Project', id, `${p.projectNo} started`, actor?.email)
      return ok(p)
    }
    if (action === 'complete') {
      const p = await completeProject(id)
      await logAudit('POST', 'Project', id, `${p.projectNo} COMPLETED`, actor?.email)
      return ok(p)
    }
    if (action === 'cancel') {
      const p = await cancelProject(id)
      await logAudit('CANCEL', 'Project', id, `${p.projectNo} cancelled`, actor?.email)
      return ok(p)
    }
    return fail('Unknown action', 400)
  } catch (e) {
    return handleError(e)
  }
}
