import { z } from 'zod'
import { fail, handleError, ok } from '@/lib/api'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { cancelReturn, listReturns, postReturn } from '@/lib/returns'

export async function GET() {
  try { await assertCompanyAccess(); return ok(await listReturns()) } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = await req.json()
    if (body.action === 'cancel') {
      const parsed = z.object({ id: z.string().min(1) }).safeParse(body)
      if (!parsed.success) return fail('Return document id is required')
      return ok(await cancelReturn(parsed.data.id))
    }
    const parsed = z.object({
      returnType: z.enum(['SALES_RETURN', 'PURCHASE_RETURN']), sourceInvoiceId: z.string().min(1), warehouseId: z.string().min(1),
      date: z.string().date().optional(), reason: z.string().min(1),
      lines: z.array(z.object({ sourceLineId: z.string().min(1), requestedQty: z.number().positive(), acceptedQty: z.number().nonnegative(), rejectedQty: z.number().nonnegative(), disposition: z.enum(['RESTOCK', 'SCRAP', 'RETURN_TO_VENDOR', 'REJECT_TO_CUSTOMER']).optional(), batchNo: z.string().optional(), qcNotes: z.string().optional() })).min(1),
    }).safeParse(body)
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid return')
    return ok(await postReturn({ ...parsed.data, date: parsed.data.date ? new Date(`${parsed.data.date}T00:00:00.000Z`) : undefined, createdBy: actor?.email ?? undefined }))
  } catch (error) { return handleError(error) }
}
