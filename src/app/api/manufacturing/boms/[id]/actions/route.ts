import { ok, fail, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { approveBom, cancelBom } from '@/lib/manufacturing'

const actionSchema = z.object({ action: z.enum(['approve', 'cancel']) })

/** BOM approval / cancellation (approval recalculates project estimated cost). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const { action } = actionSchema.parse(await req.json())
    if (action === 'approve') {
      const bom = await approveBom(id)
      await logAudit('POST', 'Bom', id, `${bom.bomNo} APPROVED — est ₹${bom.estCost}`, actor?.email)
      return ok(bom)
    }
    if (action === 'cancel') {
      const bom = await cancelBom(id)
      await logAudit('CANCEL', 'Bom', id, `${bom.bomNo} cancelled`, actor?.email)
      return ok(bom)
    }
    return fail('Unknown action', 400)
  } catch (e) {
    return handleError(e)
  }
}
