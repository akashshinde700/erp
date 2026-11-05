import { handleError, ok } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformKey, planOut, PLAN_FEATURE_KEYS } from '@/lib/platform'
import { z } from 'zod'

/** PATCH /api/platform/plans/[id] — update fields (undefined = unchanged). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requirePlatformKey(req)
    const { id } = await params
    const schema = z.object({
      name: z.string().min(1).max(60).optional(),
      priceMonthly: z.number().min(0).optional(),
      priceYearly: z.number().min(0).optional(),
      maxItems: z.number().int().min(0).optional(),
      maxWarehouses: z.number().int().min(0).optional(),
      maxParties: z.number().int().min(0).optional(),
      active: z.boolean().optional(),
      features: z.array(z.enum(PLAN_FEATURE_KEYS)).optional(),
    })
    const body = schema.parse(await req.json())
    const plan = await db.plan.update({
      where: { id },
      data: { ...body, ...(body.features ? { features: body.features.join(',') } : {}) },
    })
    await logAudit('UPDATE', 'Plan', id, `${plan.name} updated`)
    return ok(planOut(plan))
  } catch (e) {
    return handleError(e)
  }
}
