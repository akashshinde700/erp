import { ok, handleError } from '@/lib/api'
import { cancelPayment } from '@/lib/services'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return ok(await cancelPayment(id))
  } catch (e) {
    return handleError(e)
  }
}
