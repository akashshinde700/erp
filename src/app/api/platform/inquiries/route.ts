import { handleError, ok } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformKey } from '@/lib/platform'
import { z } from 'zod'

/**
 * GET /api/platform/inquiries — every lead with follow-ups + new count.
 * POST /api/platform/inquiries — log a new inquiry.
 */
export async function GET(req: Request) {
  try {
    requirePlatformKey(req)
    const inquiries = await db.platformInquiry.findMany({
      orderBy: { createdAt: 'desc' },
      include: { followUps: { orderBy: { createdAt: 'desc' } } },
    })
    const newCount = inquiries.filter((i) => i.status === 'new').length
    return ok({ inquiries, newCount })
  } catch (e) {
    return handleError(e)
  }
}

const inquirySchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(120),
  contactName: z.string().max(80).optional(),
  email: z.string().max(120).optional(),
  phone: z.string().max(20).optional(),
  city: z.string().max(60).optional(),
  message: z.string().max(2000).optional(),
  status: z.enum(['new', 'contacted', 'converted', 'closed']).default('new'),
})

export async function POST(req: Request) {
  try {
    requirePlatformKey(req)
    const body = inquirySchema.parse(await req.json())
    const inquiry = await db.platformInquiry.create({
      data: {
        name: body.name,
        contactName: body.contactName || null,
        email: body.email || null,
        phone: body.phone || null,
        city: body.city || null,
        message: body.message || null,
        status: body.status,
      },
    })
    await logAudit('PLATFORM', 'Inquiry', inquiry.id, `${inquiry.name} logged (${inquiry.status})`)
    return ok(inquiry)
  } catch (e) {
    return handleError(e)
  }
}
