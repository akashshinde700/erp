import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { nullableDate } from '@/lib/validation'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { updateWorkOrder } from '@/lib/manufacturing'

const woUpdateSchema = z.object({
  startDate: nullableDate,
  endDate: nullableDate,
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  notes: z.string().max(1000).optional().nullable(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = woUpdateSchema.parse(await req.json())
    const wo = await updateWorkOrder(id, body)
    await logAudit('UPDATE', 'WorkOrder', id, `${wo.woNo} schedule updated`, actor?.email)
    return ok(wo)
  } catch (e) {
    return handleError(e)
  }
}
