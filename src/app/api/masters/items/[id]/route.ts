import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

const itemUpdateSchema = z.object({
  code: z.string().min(1).max(30).optional(),
  name: z.string().min(1).optional(),
  groupName: z.string().optional(),
  hsn: z.string().optional().nullable(),
  isService: z.boolean().optional(),
  isStockItem: z.boolean().optional(),
  uom: z.enum(['PCS', 'KG', 'MTR', 'LTR', 'BOX']).optional(),
  gstRate: z.number().min(0).max(100).optional(),
  saleRate: z.number().min(0).optional(),
  costRate: z.number().min(0).optional(),
  reorderLevel: z.number().min(0).optional(),
  active: z.boolean().optional(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await assertMutationAccess()
    const body = itemUpdateSchema.parse(await req.json())
    const data: any = { ...body }
    if (body.hsn !== undefined) data.hsn = body.hsn || null
    const item = await db.item.update({ where: { id }, data })
    await logAudit('UPDATE', 'Item', id, `${item.code} — ${item.name}`)
    return ok(item)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await assertMutationAccess()
    const url = new URL(req.url)
    const activate = url.searchParams.get('activate') === '1'
    const item = await db.item.update({ where: { id }, data: { active: activate } })
    await logAudit('UPDATE', 'Item', id, `${item.code} ${activate ? 'reactivated' : 'deactivated'}`)
    return ok(item)
  } catch (e) {
    return handleError(e)
  }
}
