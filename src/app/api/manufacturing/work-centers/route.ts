import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { createWorkCenter, listWorkCenters } from '@/lib/routing'

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const includeInactive = new URL(req.url).searchParams.get('all') === '1'
    return ok(await listWorkCenters(includeInactive))
  } catch (e) {
    return handleError(e)
  }
}

const centerSchema = z.object({
  code: z.string().min(1, 'Code is required').max(30),
  name: z.string().min(1, 'Name is required').max(120),
  type: z.enum(['MACHINE', 'CELL', 'MANUAL']).default('MACHINE'),
  machineNo: z.string().max(30).optional().nullable(),
  parallelCapacity: z.number().int().min(1).max(50).default(1),
  dailyHours: z.number().min(0).max(24).default(8),
  costPerHour: z.number().min(0).finite().max(1_000_000).default(0),
  active: z.boolean().default(true),
  notes: z.string().max(2000).optional().nullable(),
})

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = centerSchema.parse(await req.json())
    const center = await createWorkCenter(body)
    await logAudit('CREATE', 'WorkCenter', center.id, `${center.code} — ${center.name} (${center.type}, ×${center.parallelCapacity})`, actor?.email)
    return ok(center)
  } catch (e) {
    return handleError(e)
  }
}
