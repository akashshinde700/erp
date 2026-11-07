import { z } from 'zod'
import { fail, handleError, ok } from '@/lib/api'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { approveSalesOrder, createDeliveryChallan, createQuotation, inspectAndDispatch, orderToCashDashboard, quotationToOrder, reviseQuotation, transitionQuotation } from '@/lib/order-to-cash'

const date = z.string().date().transform((value) => new Date(`${value}T00:00:00.000Z`))
const line = z.object({ itemId: z.string().min(1), qty: z.number().positive(), rate: z.number().nonnegative(), discountPct: z.number().min(0).max(100).optional(), remarks: z.string().optional() })
export async function GET() { try { await assertCompanyAccess(); return ok(await orderToCashDashboard()) } catch (error) { return handleError(error) } }
export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess(); const body = await req.json(); const action = String(body.action ?? '')
    if (action === 'create-quotation') { const p = z.object({ partyId: z.string().min(1), date: date.optional(), validUntil: date, terms: z.string().optional(), lines: z.array(line).min(1) }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid quotation'); return ok(await createQuotation({ ...p.data, createdBy: actor?.email ?? undefined })) }
    if (action === 'revise-quotation') { const p = z.object({ id: z.string().min(1), validUntil: date, terms: z.string().optional(), lines: z.array(line).min(1) }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid revision'); return ok(await reviseQuotation(p.data.id, { ...p.data, createdBy: actor?.email ?? undefined })) }
    if (action === 'transition-quotation') { const p = z.object({ id: z.string().min(1), transition: z.enum(['SUBMIT', 'APPROVE', 'REJECT']) }).safeParse(body); if (!p.success) return fail('Invalid transition'); return ok(await transitionQuotation(p.data.id, p.data.transition, actor?.email ?? undefined)) }
    if (action === 'quotation-to-order') { const p = z.object({ id: z.string().min(1), deliveryDate: date.optional(), customerPoNo: z.string().optional() }).safeParse(body); if (!p.success) return fail('Invalid order request'); return ok(await quotationToOrder(p.data.id, { ...p.data, actor: actor?.email ?? undefined })) }
    if (action === 'approve-order') { const p = z.object({ id: z.string().min(1) }).safeParse(body); if (!p.success) return fail('Order id required'); return ok(await approveSalesOrder(p.data.id, actor?.email ?? undefined)) }
    if (action === 'create-challan') { const p = z.object({ salesOrderId: z.string().min(1), warehouseId: z.string().min(1), date: date.optional(), vehicleNo: z.string().optional(), transporter: z.string().optional(), lines: z.array(z.object({ salesOrderLineId: z.string().min(1), qty: z.number().positive(), batchNo: z.string().optional() })).min(1) }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid challan'); return ok(await createDeliveryChallan({ ...p.data, createdBy: actor?.email ?? undefined })) }
    if (action === 'inspect-dispatch') { const p = z.object({ deliveryChallanId: z.string().min(1), lines: z.array(z.object({ deliveryChallanLineId: z.string().min(1), acceptedQty: z.number().nonnegative(), rejectedQty: z.number().nonnegative(), qcNotes: z.string().optional() })).min(1) }).safeParse(body); if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid dispatch QC'); return ok(await inspectAndDispatch({ ...p.data, actor: actor?.email ?? undefined })) }
    return fail('Unknown order-to-cash action')
  } catch (error) { return handleError(error) }
}
