import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { postOpeningStock } from '@/lib/services'
import { assertCompanyAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

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
    await assertCompanyAccess()
    const res = await postOpeningStock(postSchema.parse(await req.json()))
    await logAudit('POST', 'OpeningStock', undefined, `${res.rows} row(s) posted — ${res.voucherNo}`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
