import { ok, handleError } from '@/lib/api'
import { cancelJobCard } from '@/lib/services'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return ok(await cancelJobCard(id))
  } catch (e) {
    return handleError(e)
  }
}
