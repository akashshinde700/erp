import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'

const whSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).optional(),
  location: z.string().optional().nullable(),
  active: z.boolean().optional(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = whSchema.parse(await req.json())
    const data: any = { ...body }
    if (body.location !== undefined) data.location = body.location || null
    return ok(await db.warehouse.update({ where: { id }, data }))
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const url = new URL(req.url)
    const activate = url.searchParams.get('activate') === '1'
    return ok(await db.warehouse.update({ where: { id }, data: { active: activate } }))
  } catch (e) {
    return handleError(e)
  }
}
