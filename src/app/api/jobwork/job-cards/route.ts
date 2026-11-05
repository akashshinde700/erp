import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { postJobCard } from '@/lib/services'
import { assertCompanyAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

const postSchema = z.object({
  inwardId: z.string().min(1, 'Inward is required'),
  date: z.string().optional(),
  notes: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        inwardItemId: z.string().min(1),
        qty: z.number().positive('Quantity must be > 0'),
        weight: z.number().min(0),
        processIds: z.array(z.string().min(1)).min(1, 'Select at least one process'),
      })
    )
    .min(1, 'Add at least one line'),
})

export async function POST(req: Request) {
  try {
    await assertCompanyAccess()
    const res = await postJobCard(postSchema.parse(await req.json()))
    await logAudit('POST', 'JobCard', res.id, `${res.cardNo} — ₹${res.totalAmount}`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
