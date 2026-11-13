import { z } from 'zod'
import { withIdempotency } from '@/lib/idempotency'
import { fail, handleError, ok } from '@/lib/api'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { applyAdvance, cancelRefund, financeAdjustmentsDashboard, refundReturn, reverseAdvanceApplication, setPaymentSchedule, tagAdvanceToOrder } from '@/lib/finance-adjustments'
const date = z.string().date().transform((value) => new Date(`${value}T00:00:00.000Z`))
export async function GET() { try { await assertCompanyAccess(); return ok(await financeAdjustmentsDashboard()) } catch (error) { return handleError(error) } }
async function handlePost(req: Request) {
  try {
    await assertMutationAccess(); const body = await req.json()
    if (body.action === 'set-schedule') { const p = z.object({ salesOrderId: z.string().min(1), rows: z.array(z.object({ milestone: z.string().trim().min(1), dueDate: date, amount: z.number().positive() })).min(1) }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid schedule'); return ok(await setPaymentSchedule(p.data)) }
    if (body.action === 'apply-advance') { const p = z.object({ advanceId: z.string().min(1), invoiceType: z.enum(['SALES', 'PURCHASE']), invoiceNo: z.string().min(1), amount: z.number().positive() }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid advance allocation'); return ok(await applyAdvance(p.data)) }
    if (body.action === 'refund-return') { const p = z.object({ returnDocumentId: z.string().min(1), amount: z.number().positive(), mode: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE']), refNo: z.string().optional(), notes: z.string().optional() }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid refund'); return ok(await refundReturn(p.data)) }
    if (body.action === 'reverse-advance-application') { const p = z.object({ allocationId: z.string().min(1, 'Advance application id is required'), reason: z.string().trim().min(1, 'A reason is required').max(500) }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid reversal'); return ok(await reverseAdvanceApplication(p.data)) }
    if (body.action === 'cancel-refund') { const p = z.object({ paymentId: z.string().min(1, 'Refund payment id is required'), reason: z.string().trim().min(1, 'A reason is required').max(500) }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid refund cancellation'); return ok(await cancelRefund(p.data)) }
    if (body.action === 'tag-advance') { const p = z.object({ advanceId: z.string().min(1, 'Advance id is required'), salesOrderId: z.string().min(1).nullable() }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid advance tag'); return ok(await tagAdvanceToOrder(p.data)) }
    return fail('Unknown finance-adjustment action')
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'finance-adjustments', (r) => handlePost(r))
}
