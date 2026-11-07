import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { optionalDate } from '@/lib/validation'
import { issueCertificate } from '@/lib/services'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

const postSchema = z.object({
  inwardId: z.string().min(1, 'Inward is required'),
  date: optionalDate,
})

export async function POST(req: Request) {
  try {
    const body = postSchema.parse(await req.json())
    const actor = await assertMutationAccess()
    const res = await issueCertificate(body.inwardId, body.date)
    await logAudit('POST', 'JobworkCertificate', res.id, `${res.certNo} issued`, actor?.email)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
