import { z } from 'zod'
import { fail, handleError, ok } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { withIdempotency } from '@/lib/idempotency'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { ADJUSTMENT_REASONS, adjustmentsDashboard, approveAdjustment, cancelAdjustment, rejectAdjustment, requestAdjustment } from '@/lib/stock-adjustments'

const day = z.string().date('Use YYYY-MM-DD').transform((v) => new Date(`${v}T00:00:00.000Z`))

export async function GET() {
  try { await assertCompanyAccess(); return ok(await adjustmentsDashboard()) } catch (error) { return handleError(error) }
}

async function handlePost(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = await req.json()
    const action = String(body?.action ?? '')
    const who = actor?.email ?? undefined
    if (action === 'request') {
      const p = z.object({
        date: day, warehouseId: z.string().min(1, 'Warehouse is required'), reasonCode: z.enum(ADJUSTMENT_REASONS), notes: z.string().max(1000).optional(),
        lines: z.array(z.object({ itemId: z.string().min(1), qtyChange: z.number().finite().refine((v) => v !== 0, 'Quantity change cannot be zero'), rate: z.number().min(0).finite().optional() })).min(1, 'Add at least one item').max(200),
      }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid adjustment')
      const adj = await requestAdjustment({ ...p.data, requestedBy: who })
      await logAudit('CREATE', 'StockAdjustment', adj.id, `${adj.adjNo} ${adj.reasonCode} requested (${adj.lines.length} lines)`, who)
      return ok(adj)
    }
    const p = z.object({ id: z.string().min(1), note: z.string().trim().max(1000).optional(), reason: z.string().trim().max(1000).optional() }).safeParse(body)
    if (!p.success) return fail('Adjustment id is required')
    if (action === 'approve') {
      const adj = await approveAdjustment({ id: p.data.id, actor, note: p.data.note })
      await logAudit('APPROVE', 'StockAdjustment', adj.id, `${adj.adjNo} approved, value ₹${adj.value}`, who)
      return ok(adj)
    }
    if (action === 'reject') {
      if (!p.data.note) return fail('A rejection reason is required')
      const adj = await rejectAdjustment({ id: p.data.id, actor, note: p.data.note })
      await logAudit('REJECT', 'StockAdjustment', p.data.id, `${adj?.adjNo}: ${p.data.note}`, who)
      return ok(adj)
    }
    if (action === 'cancel') {
      if (!p.data.reason) return fail('A cancellation reason is required')
      const adj = await cancelAdjustment({ id: p.data.id, actor, reason: p.data.reason })
      await logAudit('CANCEL', 'StockAdjustment', p.data.id, `${adj?.adjNo}: ${p.data.reason}`, who)
      return ok(adj)
    }
    return fail('Unknown stock-adjustment action')
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'stock-adjustments', (r) => handlePost(r))
}
