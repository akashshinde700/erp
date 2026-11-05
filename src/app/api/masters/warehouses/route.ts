import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'

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
    const body = warehouseSchema.parse(await req.json())
    return ok(await db.warehouse.create({ data: { ...body, location: body.location || null } }))
  } catch (e) {
    return handleError(e)
  }
}
