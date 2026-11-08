import { ok, fail, handleError } from '@/lib/api'
import { pageParams } from '@/lib/paging'
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
    const page = pageParams(sp)
    if (page.q) where.OR = [{ invoiceNo: { contains: page.q } }, { party: { name: { contains: page.q } } }, { party: { code: { contains: page.q } } }]
    if (from || to) {
      where.date = {}
      // Voucher dates are stored at UTC midnight; use UTC day boundaries so
      // a non-UTC host never drops day-1 rows or includes the next day.
      if (from) where.date.gte = new Date(`${from}T00:00:00.000Z`)
      if (to) where.date.lte = new Date(`${to}T23:59:59.999Z`)
    }
    const query = {
      where,
      orderBy: [{ date: 'desc' as const }, { invoiceNo: 'desc' as const }],
      include: { party: { select: { code: true, name: true, gstin: true, stateCode: true } } },
    }
    if (!page.paged) return ok(await db.purchaseInvoice.findMany(query))
    // Paged list: one page of rows + total + posted summary for the whole filter.
    const [rows, total, posted] = await Promise.all([
      db.purchaseInvoice.findMany({ ...query, skip: page.offset, take: page.limit }),
      db.purchaseInvoice.count({ where }),
      db.purchaseInvoice.aggregate({ where: { ...where, status: 'POSTED' }, _sum: { grandTotal: true, paidAmount: true }, _count: true }),
    ])
    return ok({ rows, total, offset: page.offset, limit: page.limit, summary: { count: posted._count, grand: posted._sum.grandTotal ?? 0, paid: posted._sum.paidAmount ?? 0 } })
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
