import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { generateJobworkInvoice } from '@/lib/services'

const postSchema = z.object({
  inwardId: z.string().min(1, 'Inward is required'),
  date: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const body = postSchema.parse(await req.json())
    return ok(await generateJobworkInvoice(body.inwardId, body.date))
  } catch (e) {
    return handleError(e)
  }
}
