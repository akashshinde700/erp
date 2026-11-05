import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { cancelPurchaseInvoice } from '@/lib/services'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return ok(
      await db.purchaseInvoice.findUnique({
        where: { id },
        include: { party: true, items: { orderBy: { id: 'asc' } } },
      })
    )
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return ok(await cancelPurchaseInvoice(id))
  } catch (e) {
    return handleError(e)
  }
}
