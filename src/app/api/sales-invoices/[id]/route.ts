import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { cancelSalesInvoice } from '@/lib/services'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const invoice = await db.salesInvoice.findUnique({
      where: { id },
      include: {
        party: true,
        items: { orderBy: { id: 'asc' } },
      },
    })
    return ok(invoice)
  } catch (e) {
    return handleError(e)
  }
}

/** Cancel = reversal rows, never delete (append-only ledgers). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return ok(await cancelSalesInvoice(id))
  } catch (e) {
    return handleError(e)
  }
}
