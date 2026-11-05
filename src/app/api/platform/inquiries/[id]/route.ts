import { handleError, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformKey } from '@/lib/platform'
import { z } from 'zod'

/**
 * PATCH /api/platform/inquiries/[id] — update status / contact fields.
 * DELETE /api/platform/inquiries/[id] — remove (follow-ups cascade).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requirePlatformKey(req)
    const { id } = await params
    const inquiry = await db.platformInquiry.findUnique({ where: { id } })
    if (!inquiry) return fail('Inquiry not found', 404)
    const schema = z.object({
      status: z.enum(['new', 'contacted', 'converted', 'closed']).optional(),
      contactName: z.string().max(80).optional(),
      email: z.string().max(120).optional(),
      phone: z.string().max(20).optional(),
      city: z.string().max(60).optional(),
      message: z.string().max(2000).optional(),
    })
    const body = schema.parse(await req.json())
    const updated = await db.platformInquiry.update({ where: { id }, data: body })
    await logAudit('PLATFORM', 'Inquiry', id, `${updated.name} → ${updated.status}`)
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requirePlatformKey(req)
    const { id } = await params
    const inquiry = await db.platformInquiry.findUnique({ where: { id } })
    if (!inquiry) return fail('Inquiry not found', 404)
    await db.platformInquiry.delete({ where: { id } })
    await logAudit('PLATFORM', 'Inquiry', id, `${inquiry.name} deleted (with follow-ups)`)
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
