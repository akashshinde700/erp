import { ok, fail, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess, assertCompanyAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { deleteWorkCenter, getCalendar, updateWorkCenter } from '@/lib/routing'

/** Calendar read lives here so one URL describes one centre. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCompanyAccess()
    const { id } = await params
    return ok(await getCalendar(id))
  } catch (e) {
    return handleError(e)
  }
}

const patchSchema = z.object({
  code: z.string().min(1).max(30).optional(),
  name: z.string().min(1).max(120).optional(),
  type: z.enum(['MACHINE', 'CELL', 'MANUAL']).optional(),
  machineNo: z.string().max(30).optional().nullable(),
  parallelCapacity: z.number().int().min(1).max(50).optional(),
  dailyHours: z.number().min(0).max(24).optional(),
  costPerHour: z.number().min(0).finite().max(1_000_000).optional(),
  active: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = patchSchema.parse(await req.json())
    const center = await updateWorkCenter(id, body)
    await logAudit('UPDATE', 'WorkCenter', id, `${center.code} — ${center.name}${body.active === false ? ' (retired)' : ''}`, actor?.email)
    return ok(center)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    if (!id) return fail('Work centre id required', 400)
    const res = await deleteWorkCenter(id)
    await logAudit('DELETE', 'WorkCenter', id, 'work centre deleted', actor?.email)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
