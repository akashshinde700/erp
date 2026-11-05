import { handleError, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformAdmin } from '@/lib/platform'
import { z } from 'zod'

/** POST /api/platform/inquiries/[id]/follow-ups — append a follow-up note. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin(req)
    const { id } = await params
    const inquiry = await db.platformInquiry.findUnique({ where: { id } })
    if (!inquiry) return fail('Inquiry not found', 404)
    const schema = z.object({ note: z.string().min(1, 'Note is required').max(500) })
    const body = schema.parse(await req.json())
    const followUp = await db.platformInquiryFollowUp.create({
      data: { inquiryId: id, note: body.note },
    })
    await logAudit('PLATFORM', 'Inquiry', id, `${inquiry.name}: follow-up logged`)
    return ok(followUp)
  } catch (e) {
    return handleError(e)
  }
}
