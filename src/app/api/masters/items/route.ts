import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { assertCompanyAccess, assertLimit } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams
    const search = sp.get('search')
    const where: any = {}
    if (search) {
      where.OR = [{ name: { contains: search } }, { code: { contains: search } }]
    }
    return ok(await db.item.findMany({ where, orderBy: { code: 'asc' } }))
  } catch (e) {
    return handleError(e)
  }
}

const itemSchema = z.object({
  code: z.string().min(1, 'Code is required').max(30),
  name: z.string().min(1, 'Name is required'),
  groupName: z.string().default('General'),
  hsn: z.string().optional().nullable(),
  isService: z.boolean().default(false),
  isStockItem: z.boolean().default(true),
  uom: z.enum(['PCS', 'KG', 'MTR', 'LTR', 'BOX']),
  gstRate: z.number().min(0).max(100),
  saleRate: z.number().min(0).default(0),
  costRate: z.number().min(0).default(0),
  reorderLevel: z.number().min(0).default(0),
})

export async function POST(req: Request) {
  try {
    await assertCompanyAccess()
    await assertLimit('items')
    const body = itemSchema.parse(await req.json())
    const item = await db.item.create({
      data: { ...body, hsn: body.hsn || null, isStockItem: body.isService ? false : body.isStockItem },
    })
    await logAudit('CREATE', 'Item', item.id, `${item.code} — ${item.name}`)
    return ok(item)
  } catch (e) {
    return handleError(e)
  }
}
