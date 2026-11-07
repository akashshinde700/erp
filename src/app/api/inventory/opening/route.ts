import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { optionalDate } from '@/lib/validation'
import { postOpeningStock } from '@/lib/services'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

const postSchema = z.object({
  date: optionalDate,
  warehouseId: z.string().optional().nullable(),
  rows: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.number().positive('Quantity must be > 0').finite().max(10_000_000),
        rate: z.number().min(0).finite().max(100_000_000),
      })
    )
    .min(1, 'Add at least one row')
    .max(200, 'Too many rows'),
})

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const res = await postOpeningStock(postSchema.parse(await req.json()))
    await logAudit('POST', 'OpeningStock', undefined, `${res.rows} row(s) posted — ${res.voucherNo}`, actor?.email)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
