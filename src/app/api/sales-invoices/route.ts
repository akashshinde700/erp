import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { postSalesInvoice } from '@/lib/services'

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams
    const where: any = {}
    const partyId = sp.get('partyId')
    const status = sp.get('status')
    const source = sp.get('source')
    if (partyId) where.partyId = partyId
    if (status) where.status = status
    if (source) where.source = source
    const from = sp.get('from')
    const to = sp.get('to')
    if (from || to) {
      where.date = {}
      if (from) where.date.gte = new Date(from)
      if (to) where.date.lte = new Date(`${to}T23:59:59`)
    }
    const invoices = await db.salesInvoice.findMany({
      where,
      orderBy: [{ date: 'desc' }, { invoiceNo: 'desc' }],
      include: { party: { select: { code: true, name: true, gstin: true, stateCode: true } } },
    })
    return ok(invoices)
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
  pos: z.string().length(2).optional(),
  poNo: z.string().optional().nullable(),
  taxInclusive: z.boolean().optional(),
  warehouseId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'Add at least one line item'),
})

export async function POST(req: Request) {
  try {
    const body = postSchema.parse(await req.json())
    return ok(await postSalesInvoice(body))
  } catch (e) {
    return handleError(e)
  }
}
