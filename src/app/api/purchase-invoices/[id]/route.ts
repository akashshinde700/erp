import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { cancelPurchaseInvoice } from '@/lib/services'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCompanyAccess()
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
    await assertMutationAccess()
    const res = await cancelPurchaseInvoice(id)
    await logAudit('CANCEL', 'PurchaseInvoice', id, `${res.invoiceNo} cancelled (reversal entries)`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
