import { ok, handleError } from '@/lib/api'
import { withIdempotency } from '@/lib/idempotency'
import { db } from '@/lib/db'
import { z } from 'zod'
import { optionalDate } from '@/lib/validation'
import { postPayment } from '@/lib/services'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    const where: any = {}
    const partyId = sp.get('partyId')
    const type = sp.get('type')
    if (partyId) where.partyId = partyId
    if (type) where.type = type
    return ok(
      await db.payment.findMany({
        where,
        orderBy: [{ date: 'desc' }, { paymentNo: 'desc' }],
        include: {
          party: { select: { code: true, name: true } },
          allocations: true,
          tdsSection: { select: { section: true, ratePct: true } },
        },
      })
    )
  } catch (e) {
    return handleError(e)
  }
}

const postSchema = z.object({
  type: z.enum(['RECEIPT', 'PAYMENT']),
  partyId: z.string().min(1, 'Party is required'),
  date: optionalDate,
  amount: z.number().positive('Amount must be > 0').finite().max(1_000_000_000),
  mode: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE']).optional(),
  refNo: z.string().max(60).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  allocations: z
    .array(
      z.object({
        invoiceType: z.enum(['SALES', 'PURCHASE']),
        invoiceNo: z.string().min(1).max(40),
        amount: z.number().positive().finite().max(1_000_000_000),
      })
    )
    .max(100, 'Too many allocations')
    .optional(),
  tdsSectionId: z.string().min(1).optional().nullable(),
  tdsAmount: z.number().min(0, 'TDS cannot be negative').finite().max(1_000_000_000).optional(),
})

async function handlePost(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const res = await postPayment(postSchema.parse(await req.json()))
    await logAudit('POST', 'Payment', res.id, `${res.paymentNo} — ₹${res.amount}`, actor?.email)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'payments', (r) => handlePost(r))
}
