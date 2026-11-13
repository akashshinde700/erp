import { z } from 'zod'
import { withIdempotency } from '@/lib/idempotency'
import { fail, handleError, ok } from '@/lib/api'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { cancelProductionReceipt, listProductionReceipts, postProductionReceipt, previewProductionReceipt, workOrderReadiness } from '@/lib/production-output'

const date = z.string().date().optional().transform((value) => value ? new Date(`${value}T00:00:00.000Z`) : undefined)
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    if (sp.get('readiness') === '1') return ok(await workOrderReadiness())
    if (sp.get('preview') === '1') {
      const p = z.object({ workOrderId: z.string().min(1), producedQty: z.coerce.number().positive('Produced quantity must be positive').finite(), acceptedQty: z.coerce.number().nonnegative().finite() }).safeParse(Object.fromEntries(sp))
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid preview')
      return ok(await previewProductionReceipt(p.data))
    }
    return ok(await listProductionReceipts(sp.get('workOrderId') ?? undefined))
  } catch (error) { return handleError(error) }
}
async function handlePost(req: Request) {
  try {
    const actor = await assertMutationAccess(); const body = await req.json()
    if (body.action === 'cancel') { const p = z.object({ id: z.string().min(1) }).safeParse(body); if (!p.success) return fail('Receipt id required'); return ok(await cancelProductionReceipt(p.data.id)) }
    const p = z.object({ workOrderId: z.string().min(1), outputItemId: z.string().min(1), warehouseId: z.string().min(1), date, batchNo: z.string().optional(), manufacturedAt: date, expiryDate: date, producedQty: z.number().positive(), acceptedQty: z.number().nonnegative(), rejectedQty: z.number().nonnegative().optional(), reworkQty: z.number().nonnegative().optional(), scrapQty: z.number().nonnegative().optional(), qcNotes: z.string().optional(), serialNumbers: z.array(z.string().trim().min(1)).optional(), parentLots: z.array(z.object({ parentLotId: z.string().min(1), consumedQty: z.number().positive() })).optional() }).safeParse(body)
    if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid production receipt')
    return ok(await postProductionReceipt({ ...p.data, createdBy: actor?.email ?? undefined }))
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'production-receipts', (r) => handlePost(r))
}
