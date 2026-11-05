import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { postOpeningStock } from '@/lib/services'

const postSchema = z.object({
  date: z.string().optional(),
  warehouseId: z.string().optional().nullable(),
  rows: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.number().positive('Quantity must be > 0'),
        rate: z.number().min(0),
      })
    )
    .min(1, 'Add at least one row'),
})

export async function POST(req: Request) {
  try {
    return ok(await postOpeningStock(postSchema.parse(await req.json())))
  } catch (e) {
    return handleError(e)
  }
}
