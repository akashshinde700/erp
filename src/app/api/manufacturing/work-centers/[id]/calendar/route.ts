import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { saveCalendar } from '@/lib/routing'

const calendarSchema = z.object({
  workDays: z.string().max(30).optional(),
  shifts: z
    .array(
      z.object({
        name: z.string().max(30).optional(),
        startMin: z.number().int().min(0).max(1439),
        durationMin: z.number().int().min(1).max(1440),
        active: z.boolean().optional(),
      })
    )
    .max(7),
  holidays: z
    .array(z.object({ date: z.string().min(8).max(10), reason: z.string().max(120).optional().nullable() }))
    .max(200)
    .optional(),
})

/** Replace a centre's working week, shifts and holidays atomically. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = calendarSchema.parse(await req.json())
    const calendar = await saveCalendar(id, body)
    await logAudit(
      'UPDATE',
      'ShiftCalendar',
      calendar?.id ?? id,
      `${body.shifts.length} shift(s), workDays ${body.workDays ?? '1,2,3,4,5,6'}, ${body.holidays?.length ?? 0} holiday(s)`,
      actor?.email
    )
    return ok(calendar)
  } catch (e) {
    return handleError(e)
  }
}
