import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { DOWNTIME_REASONS, closeDowntime, listDowntime, recordDowntime } from '@/lib/routing'

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const p = new URL(req.url).searchParams
    return ok(
      await listDowntime({
        workCenterId: p.get('workCenterId') ?? undefined,
        from: p.get('from') ?? undefined,
        to: p.get('to') ?? undefined,
        openOnly: p.get('open') === '1',
      })
    )
  } catch (e) {
    return handleError(e)
  }
}

const downtimeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('record'),
    workCenterId: z.string().min(1, 'Work centre is required'),
    startedAt: z.string().min(10),
    endedAt: z.string().min(10).optional().nullable(),
    reason: z.enum(DOWNTIME_REASONS),
    planned: z.boolean().optional(),
    notes: z.string().max(1000).optional().nullable(),
  }),
  z.object({
    action: z.literal('close'),
    id: z.string().min(1),
    endedAt: z.string().min(10).optional().nullable(),
  }),
])

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = downtimeSchema.parse(await req.json())
    if (body.action === 'close') {
      const row = await closeDowntime(body.id, body.endedAt ?? undefined)
      await logAudit('UPDATE', 'MachineDowntime', body.id, `downtime closed (${row.reason})`, actor?.email)
      return ok(row)
    }
    const row = await recordDowntime(
      {
        workCenterId: body.workCenterId,
        startedAt: body.startedAt,
        endedAt: body.endedAt ?? null,
        reason: body.reason,
        planned: body.planned,
        notes: body.notes,
      },
      actor?.email ?? undefined
    )
    await logAudit('CREATE', 'MachineDowntime', row.id, `${row.reason} on ${body.workCenterId}`, actor?.email)
    return ok(row)
  } catch (e) {
    return handleError(e)
  }
}
