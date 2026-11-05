import { handleError, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { ensurePlans, requirePlatformKey } from '@/lib/platform'
import { z } from 'zod'

/** GET /api/platform/plans — list with org counts. */
export async function GET(req: Request) {
  try {
    requirePlatformKey(req)
    await ensurePlans()
    const plans = await db.plan.findMany({
      orderBy: { priceMonthly: 'asc' },
      include: { _count: { select: { companies: true } } },
    })
    return ok(plans)
  } catch (e) {
    return handleError(e)
  }
}

const planSchema = z.object({
  name: z.string().min(1, 'Plan name is required').max(60),
  priceMonthly: z.number().min(0).default(0),
  priceYearly: z.number().min(0).default(0),
  maxItems: z.number().int().min(0).default(0),
  maxWarehouses: z.number().int().min(0).default(0),
  maxParties: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
})

/** POST /api/platform/plans — create. */
export async function POST(req: Request) {
  try {
    requirePlatformKey(req)
    const body = planSchema.parse(await req.json())
    const plan = await db.plan.create({ data: body })
    await logAudit('CREATE', 'Plan', plan.id, `${plan.name} ₹${plan.priceMonthly}/mo`)
    return ok(plan)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(req: Request) {
  try {
    requirePlatformKey(req)
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!id) return fail('id is required', 400)
    const inUse = await db.company.count({ where: { planId: id } })
    if (inUse > 0) return fail(`${inUse} organization(s) use this plan — move them first`, 409)
    const plan = await db.plan.delete({ where: { id } })
    await logAudit('DELETE', 'Plan', id, plan.name)
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
