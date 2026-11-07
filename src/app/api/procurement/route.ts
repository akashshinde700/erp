import { z } from 'zod'
import { handleError, ok, fail } from '@/lib/api'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { approvePurchaseOrder, cancelGoodsReceipt, createGoodsReceipt, createPurchaseOrder, createPurchaseRequisition, inspectGoodsReceipt, invoiceAcceptedReceipt, procurementDashboard, transitionRequisition } from '@/lib/procurement'

const line = z.object({ itemId: z.string().min(1), qty: z.number().positive(), rate: z.number().nonnegative().optional(), remarks: z.string().optional() })
const date = z.string().date().optional().transform((value) => value ? new Date(`${value}T00:00:00.000Z`) : undefined)

export async function GET() {
  try {
    await assertCompanyAccess()
    return ok(await procurementDashboard())
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = await req.json()
    const action = String(body.action ?? '')
    if (action === 'create-requisition') {
      const parsed = z.object({ date, requiredBy: date, department: z.string().optional(), purpose: z.string().optional(), lines: z.array(line).min(1) }).safeParse(body)
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid requisition')
      return ok(await createPurchaseRequisition({ ...parsed.data, createdBy: actor?.email ?? undefined }))
    }
    if (action === 'transition-requisition') {
      const parsed = z.object({ id: z.string().min(1), transition: z.enum(['SUBMIT', 'APPROVE', 'REJECT', 'CANCEL']) }).safeParse(body)
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid transition')
      return ok(await transitionRequisition(parsed.data.id, parsed.data.transition, actor?.email ?? undefined))
    }
    if (action === 'create-order') {
      const parsed = z.object({ supplierId: z.string().min(1), requisitionId: z.string().optional(), date, expectedDate: date, overReceiptPct: z.number().min(0).max(25).optional(), taxInclusive: z.boolean().optional(), terms: z.string().optional(), lines: z.array(line).min(1) }).safeParse(body)
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid purchase order')
      return ok(await createPurchaseOrder({ ...parsed.data, createdBy: actor?.email ?? undefined }))
    }
    if (action === 'approve-order') {
      const parsed = z.object({ id: z.string().min(1) }).safeParse(body)
      if (!parsed.success) return fail('Purchase order id is required')
      return ok(await approvePurchaseOrder(parsed.data.id, actor?.email ?? undefined))
    }
    if (action === 'create-receipt') {
      const parsed = z.object({ purchaseOrderId: z.string().min(1), warehouseId: z.string().min(1), supplierDocNo: z.string().optional(), supplierDocDate: date, date, remarks: z.string().optional(), lines: z.array(z.object({ purchaseOrderLineId: z.string().min(1), receivedQty: z.number().positive(), batchNo: z.string().optional(), manufactureDate: date, expiryDate: date })).min(1) }).safeParse(body)
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid goods receipt')
      return ok(await createGoodsReceipt({ ...parsed.data, createdBy: actor?.email ?? undefined }))
    }
    if (action === 'inspect-receipt') {
      const parsed = z.object({ goodsReceiptId: z.string().min(1), notes: z.string().optional(), lines: z.array(z.object({ goodsReceiptLineId: z.string().min(1), acceptedQty: z.number().nonnegative(), rejectedQty: z.number().nonnegative(), rejectionReason: z.string().optional(), results: z.unknown().optional() })).min(1) }).safeParse(body)
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid inspection')
      return ok(await inspectGoodsReceipt({ ...parsed.data, actor: actor?.email ?? undefined }))
    }
    if (action === 'invoice-receipt') {
      const parsed = z.object({ goodsReceiptId: z.string().min(1), date, taxInclusive: z.boolean().optional(), remarks: z.string().optional(), lines: z.array(z.object({ goodsReceiptLineId: z.string().min(1), qty: z.number().positive(), rate: z.number().nonnegative().optional() })).min(1) }).safeParse(body)
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid receipt invoice')
      return ok(await invoiceAcceptedReceipt(parsed.data))
    }
    if (action === 'cancel-receipt') {
      const parsed = z.object({ id: z.string().min(1) }).safeParse(body)
      if (!parsed.success) return fail('Goods receipt id is required')
      return ok(await cancelGoodsReceipt(parsed.data.id))
    }
    return fail('Unknown procurement action')
  } catch (error) { return handleError(error) }
}
