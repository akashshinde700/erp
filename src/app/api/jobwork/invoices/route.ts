import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { generateJobworkInvoice } from '@/lib/services'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

const postSchema = z.object({
  inwardId: z.string().min(1, 'Inward is required'),
  date: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const body = postSchema.parse(await req.json())
    const actor = await assertMutationAccess()
    const res = await generateJobworkInvoice(body.inwardId, body.date)
    await logAudit('POST', 'SalesInvoice', res.id, `${res.invoiceNo} generated from jobwork (JWIN)`, actor?.email)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
