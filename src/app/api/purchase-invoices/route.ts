import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { postPurchaseInvoice } from '@/lib/services'

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams
    const where: any = {}
    const partyId = sp.get('partyId')
    const status = sp.get('status')
    if (partyId) where.partyId = partyId
    if (status) where.status = status
    const from = sp.get('from')
    const to = sp.get('to')
    if (from || to) {
      where.date = {}
      if (from) where.date.gte = new Date(from)
      if (to) where.date.lte = new Date(`${to}T23:59:59`)
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
  detail: z.string().optional().nullable(),
  qty: z.number().positive('Quantity must be > 0'),
  rate: z.number().min(0),
  discPct: z.number().min(0).max(100).optional(),
})

const postSchema = z.object({
  partyId: z.string().min(1, 'Party is required'),
  date: z.string().optional(),
  poNo: z.string().optional().nullable(),
  taxInclusive: z.boolean().optional(),
  warehouseId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'Add at least one line item'),
})

export async function POST(req: Request) {
  try {
    return ok(await postPurchaseInvoice(postSchema.parse(await req.json())))
  } catch (e) {
    return handleError(e)
  }
}
