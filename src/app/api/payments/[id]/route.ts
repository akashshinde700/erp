import { ok, handleError } from '@/lib/api'
import { cancelPayment } from '@/lib/services'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await assertMutationAccess()
    const res = await cancelPayment(id)
    await logAudit('CANCEL', 'Payment', id, `${res.paymentNo} cancelled`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
