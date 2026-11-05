import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { postJobworkInward } from '@/lib/services'

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams
    const where: any = {}
    const status = sp.get('status')
    const partyId = sp.get('partyId')
    if (status) where.status = status
    if (partyId) where.partyId = partyId
    return ok(
      await db.jobworkInward.findMany({
        where,
        orderBy: [{ date: 'desc' }, { inwardNo: 'desc' }],
        include: {
          party: { select: { code: true, name: true } },
          items: { include: { item: { select: { code: true, name: true, uom: true } } } },
          jobCards: { where: { status: 'COMPLETED' }, select: { totalAmount: true } },
          certificates: { select: { certNo: true, status: true } },
        },
      })
    )
  } catch (e) {
    return handleError(e)
  }
}

const postSchema = z.object({
  partyId: z.string().min(1, 'Party is required'),
  date: z.string().optional(),
  challanNo: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        batchNo: z.string().optional().nullable(),
        qty: z.number().positive('Quantity must be > 0'),
        weight: z.number().min(0),
        remarks: z.string().optional().nullable(),
      })
    )
    .min(1, 'Add at least one item'),
})

export async function POST(req: Request) {
  try {
    return ok(await postJobworkInward(postSchema.parse(await req.json())))
  } catch (e) {
    return handleError(e)
  }
}
