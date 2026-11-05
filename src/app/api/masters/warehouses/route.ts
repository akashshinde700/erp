import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { assertCompanyAccess, assertLimit } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET() {
  try {
    return ok(await db.warehouse.findMany({ orderBy: { code: 'asc' } }))
  } catch (e) {
    return handleError(e)
  }
}

const warehouseSchema = z.object({
  code: z.string().min(1, 'Code is required').max(20),
  name: z.string().min(1, 'Name is required'),
  location: z.string().optional().nullable(),
})

export async function POST(req: Request) {
  try {
    await assertCompanyAccess()
    await assertLimit('warehouses')
    const body = warehouseSchema.parse(await req.json())
    const wh = await db.warehouse.create({ data: { ...body, location: body.location || null } })
    await logAudit('CREATE', 'Warehouse', wh.id, `${wh.code} — ${wh.name}`)
    return ok(wh)
  } catch (e) {
    return handleError(e)
  }
}
