import { ok, fail, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { closeMrpRun, createDocumentsFromMrp } from '@/lib/mrp'

const schema = z.object({
  action: z.enum(['create-documents', 'close']),
  /** Suggestion line ids the user approved. Required for create-documents. */
  lineIds: z.array(z.string().min(1)).max(500).optional(),
  /** Project that executes the planned work orders (MAKE lines). */
  projectId: z.string().optional().nullable(),
  department: z.string().max(60).optional().nullable(),
})

/**
 * The ONLY step that turns a plan into documents: one DRAFT purchase
 * requisition (still needs submit + approve) and/or one work order per MAKE
 * line. All-or-nothing inside a single transaction.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = schema.parse(await req.json())
    if (body.action === 'close') {
      const run = await closeMrpRun(id, actor?.email ?? undefined)
      await logAudit('CANCEL', 'MrpRun', id, `${run.runNo} closed`, actor?.email)
      return ok(run)
    }
    if (!body.lineIds?.length) return fail('Select at least one suggestion', 400)
    const res = await createDocumentsFromMrp(id, {
      lineIds: body.lineIds,
      projectId: body.projectId ?? null,
      department: body.department ?? null,
      actor: actor?.email ?? undefined,
    })
    const docs = [res.requisition?.reqNo, ...res.workOrders.map((wo) => wo.woNo)].filter(Boolean)
    await logAudit(
      'POST',
      'MrpRun',
      id,
      `${res.run.runNo} approved — created ${docs.join(', ') || 'no documents'}`,
      actor?.email
    )
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
