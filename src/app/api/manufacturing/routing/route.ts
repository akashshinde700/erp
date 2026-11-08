import { ok, fail, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { listRouting, saveRouting } from '@/lib/routing'

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const bomId = new URL(req.url).searchParams.get('bomId')
    if (!bomId) return fail('bomId is required', 400)
    return ok(await listRouting(bomId))
  } catch (e) {
    return handleError(e)
  }
}

const routingSchema = z.object({
  bomId: z.string().min(1, 'BOM is required'),
  operations: z
    .array(
      z.object({
        seq: z.number().int().min(1).max(99),
        operation: z.string().min(1).max(30),
        workCenterId: z.string().min(1, 'Work centre is required'),
        runMinutesPerUnit: z.number().min(0).max(100_000).default(0),
        setupMinutes: z.number().min(0).max(100_000).default(0),
        queueMinutes: z.number().min(0).max(100_000).default(0),
        moveMinutes: z.number().min(0).max(100_000).default(0),
        inspectionMinutes: z.number().min(0).max(100_000).default(0),
        parallel: z.boolean().default(false),
        notes: z.string().max(500).optional().nullable(),
      })
    )
    .min(1, 'Add at least one operation')
    .max(50),
})

export async function PUT(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = routingSchema.parse(await req.json())
    const ops = await saveRouting(body.bomId, body.operations)
    await logAudit('UPDATE', 'Bom', body.bomId, `routing saved (${ops.length} operation(s))`, actor?.email)
    return ok(ops)
  } catch (e) {
    return handleError(e)
  }
}
