import { ok, fail, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { approveBom, cancelBom, reviseBom } from '@/lib/manufacturing'

const actionSchema = z.object({
  action: z.enum(['approve', 'cancel', 'revise']),
  notes: z.string().max(1000).optional().nullable(),
  effectiveFrom: z.string().optional().nullable(),
})

/**
 * BOM lifecycle actions. An approved revision is immutable: `revise` creates a
 * new DRAFT revision (revision N+1) that supersedes it only once approved.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const { action, notes, effectiveFrom } = actionSchema.parse(await req.json())
    if (action === 'approve') {
      const bom = await approveBom(id)
      await logAudit(
        'POST',
        'Bom',
        id,
        `${bom.bomNo} rev ${bom.revision} APPROVED — est ₹${bom.estCost}${bom.supersededBomNo ? `; supersedes ${bom.supersededBomNo}` : ''}`,
        actor?.email
      )
      return ok(bom)
    }
    if (action === 'revise') {
      const bom = await reviseBom(id, { notes, effectiveFrom })
      await logAudit('CREATE', 'Bom', bom.id, `${bom.bomNo} rev ${bom.revision} created from rev ${bom.supersedes?.revision ?? ''}`, actor?.email)
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
