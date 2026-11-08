import { z } from 'zod'
import { withIdempotency } from '@/lib/idempotency'
import { fail, handleError, ok } from '@/lib/api'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { awardRfq, cancelRfq, createPoFromRfq, createRfq, recordQuote, rfqDashboard } from '@/lib/rfq'

const date = z.string().date('Use YYYY-MM-DD').transform((value) => new Date(`${value}T00:00:00.000Z`))

export async function GET() {
  try { await assertCompanyAccess(); return ok(await rfqDashboard()) } catch (error) { return handleError(error) }
}

async function handlePost(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = await req.json()
    const action = String(body?.action ?? '')
    if (action === 'create-rfq') {
      const p = z.object({
        requisitionId: z.string().min(1).optional(), dueDate: date.optional(), notes: z.string().max(1000).optional(),
        supplierIds: z.array(z.string().min(1)).min(1, 'Invite at least one supplier').max(50),
        lines: z.array(z.object({ itemId: z.string().min(1), qty: z.number().positive('Quantity must be positive').finite() })).max(200).optional(),
      }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid RFQ')
      return ok(await createRfq({ ...p.data, createdBy: actor?.email ?? undefined }))
    }
    if (action === 'record-quote') {
      const p = z.object({
        rfqId: z.string().min(1), supplierId: z.string().min(1), supplierRef: z.string().max(60).optional(), quoteDate: date.optional(), validUntil: date,
        deliveryDays: z.number().int('Delivery days must be whole days').min(0).max(3650), freight: z.number().min(0).finite().optional(), paymentTerms: z.string().max(200).optional(),
        lines: z.array(z.object({ rfqLineId: z.string().min(1), rate: z.number().min(0).finite(), discountPct: z.number().min(0).max(100).optional(), gstRate: z.number().min(0).max(100).optional() })).min(1, 'Quote every RFQ line'),
      }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid quotation')
      return ok(await recordQuote({ ...p.data, createdBy: actor?.email ?? undefined }))
    }
    if (action === 'award') {
      const p = z.object({ rfqId: z.string().min(1), quoteId: z.string().min(1), reason: z.string().trim().min(1, 'A selection reason is required').max(1000) }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid award')
      return ok(await awardRfq({ ...p.data, actor }))
    }
    if (action === 'create-po') {
      const p = z.object({ rfqId: z.string().min(1) }).safeParse(body)
      if (!p.success) return fail('RFQ id is required')
      return ok(await createPoFromRfq({ rfqId: p.data.rfqId, createdBy: actor?.email ?? undefined }))
    }
    if (action === 'cancel') {
      const p = z.object({ rfqId: z.string().min(1), reason: z.string().trim().min(1, 'A cancellation reason is required').max(1000) }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid cancellation')
      return ok(await cancelRfq(p.data))
    }
    return fail('Unknown RFQ action')
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'rfq', () => handlePost(req))
}
