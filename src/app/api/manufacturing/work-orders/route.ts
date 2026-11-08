import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { optionalDate, nullableDate } from '@/lib/validation'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { listWorkOrders, createWorkOrder } from '@/lib/manufacturing'

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const projectId = new URL(req.url).searchParams.get('projectId') ?? undefined
    return ok(await listWorkOrders(projectId || undefined))
  } catch (e) {
    return handleError(e)
  }
}

const woLineSchema = z.object({
  itemId: z.string().min(1, 'Material is required'),
  description: z.string().max(160).optional().nullable(),
  plannedQty: z.number().positive('Planned quantity must be > 0').finite().max(10_000_000),
  uom: z.string().min(1).max(10),
  bomItemId: z.string().optional().nullable(),
})

const woSchema = z.object({
  projectId: z.string().min(1, 'Project is required'),
  bomId: z.string().optional().nullable(),
  date: optionalDate,
  startDate: nullableDate,
  endDate: nullableDate,
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  notes: z.string().max(1000).optional().nullable(),
  lines: z.array(woLineSchema).max(200).optional(),
  /** What the order makes; defaults to the BOM output item. */
  outputItemId: z.string().optional().nullable(),
  /** Batch size — component lines scale by it (default 1). */
  outputQty: z.number().positive().finite().max(1_000_000).optional(),
})

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = woSchema.parse(await req.json())
    const wo = await createWorkOrder(body)
    await logAudit('CREATE', 'WorkOrder', wo.id, `${wo.woNo} — ${body.bomId ? 'from BOM' : 'manual'} (${body.lines?.length ?? 0} lines)`, actor?.email)
    return ok(wo)
  } catch (e) {
    return handleError(e)
  }
}
