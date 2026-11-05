import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { cancelSalesInvoice } from '@/lib/services'
import { assertCompanyAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

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
    await assertCompanyAccess()
    const res = await cancelSalesInvoice(id)
    await logAudit('CANCEL', 'SalesInvoice', id, `${res.invoiceNo} cancelled (reversal entries)`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
