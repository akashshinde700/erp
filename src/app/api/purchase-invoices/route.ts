import { ok, fail, handleError } from '@/lib/api'
import { withIdempotency } from '@/lib/idempotency'
import { db } from '@/lib/db'
import { z } from 'zod'
import { optionalDate, dateRangeError } from '@/lib/validation'
import { postPurchaseInvoice } from '@/lib/services'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    const where: any = {}
    const partyId = sp.get('partyId')
    const status = sp.get('status')
    if (partyId) where.partyId = partyId
    if (status) where.status = status
    const from = sp.get('from')
    const to = sp.get('to')
    const rangeErr = dateRangeError(from, to)
    if (rangeErr) return fail(rangeErr)
    if (from || to) {
      where.date = {}
      // Voucher dates are stored at UTC midnight; use UTC day boundaries so
      // a non-UTC host never drops day-1 rows or includes the next day.
      if (from) where.date.gte = new Date(`${from}T00:00:00.000Z`)
      if (to) where.date.lte = new Date(`${to}T23:59:59.999Z`)
    }
    return ok(
      await db.purchaseInvoice.findMany({
        where,
        orderBy: [{ date: 'desc' }, { invoiceNo: 'desc' }],
        include: { party: { select: { code: true, name: true, gstin: true, stateCode: true } } },
      })
    )
  } catch (e) {
    return handleError(e)
  }
}

const lineSchema = z.object({
  itemId: z.string().min(1),
  detail: z.string().max(240).optional().nullable(),
  qty: z.number().positive('Quantity must be > 0').finite().max(10_000_000),
  rate: z.number().min(0).finite().max(100_000_000),
  discPct: z.number().min(0).max(100).finite().optional(),
})

const postSchema = z.object({
  partyId: z.string().min(1, 'Party is required'),
  date: optionalDate,
  poNo: z.string().max(40).optional().nullable(),
  taxInclusive: z.boolean().optional(),
  warehouseId: z.string().optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
  lines: z.array(lineSchema).min(1, 'Add at least one line item').max(200, 'Too many line items'),
})

async function handlePost(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const res = await postPurchaseInvoice(postSchema.parse(await req.json()))
    await logAudit('POST', 'PurchaseInvoice', res.id, `${res.invoiceNo} — ₹${res.grandTotal}`, actor?.email)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'purchase-invoices', () => handlePost(req))
}
