import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { postPayment } from '@/lib/services'
import { assertCompanyAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET(req: Request) {
  try {
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
  date: z.string().optional(),
  amount: z.number().positive('Amount must be > 0'),
  mode: z.enum(['CASH', 'BANK', 'UPI', 'CHEQUE']).optional(),
  refNo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  allocations: z
    .array(
      z.object({
        invoiceType: z.enum(['SALES', 'PURCHASE']),
        invoiceNo: z.string().min(1),
        amount: z.number().positive(),
      })
    )
    .optional(),
})

export async function POST(req: Request) {
  try {
    await assertCompanyAccess()
    const res = await postPayment(postSchema.parse(await req.json()))
    await logAudit('POST', 'Payment', res.id, `${res.paymentNo} — ₹${res.amount}`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
