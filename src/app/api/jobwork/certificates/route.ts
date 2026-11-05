import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { issueCertificate } from '@/lib/services'
import { assertCompanyAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

const postSchema = z.object({
  inwardId: z.string().min(1, 'Inward is required'),
  date: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const body = postSchema.parse(await req.json())
    await assertCompanyAccess()
    const res = await issueCertificate(body.inwardId, body.date)
    await logAudit('POST', 'JobworkCertificate', res.id, `${res.certNo} issued`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
