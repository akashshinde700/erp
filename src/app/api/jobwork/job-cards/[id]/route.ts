import { ok, handleError } from '@/lib/api'
import { cancelJobCard } from '@/lib/services'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await assertMutationAccess()
    const res = await cancelJobCard(id)
    await logAudit('CANCEL', 'JobCard', id, `${res.cardNo} cancelled`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
