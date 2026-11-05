import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'

const processSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).optional(),
  seq: z.number().int().min(0).optional(),
  basis: z.enum(['WEIGHT', 'QTY']).optional(),
  rate: z.number().min(0).optional(),
  lotCharge: z.number().min(0).optional(),
  active: z.boolean().optional(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return ok(await db.process.update({ where: { id }, data: processSchema.parse(await req.json()) }))
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const url = new URL(req.url)
    const activate = url.searchParams.get('activate') === '1'
    return ok(await db.process.update({ where: { id }, data: { active: activate } }))
  } catch (e) {
    return handleError(e)
  }
}
