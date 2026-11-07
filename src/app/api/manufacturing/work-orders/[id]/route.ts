import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { updateWorkOrder } from '@/lib/manufacturing'

const woUpdateSchema = z.object({
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  notes: z.string().max(1000).optional().nullable(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await assertMutationAccess()
    const body = woUpdateSchema.parse(await req.json())
    const wo = await updateWorkOrder(id, body)
    await logAudit('UPDATE', 'WorkOrder', id, `${wo.woNo} schedule updated`)
    return ok(wo)
  } catch (e) {
    return handleError(e)
  }
}
