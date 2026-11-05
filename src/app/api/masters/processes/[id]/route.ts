import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { assertCompanyAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

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
    await assertCompanyAccess()
    const proc = await db.process.update({ where: { id }, data: processSchema.parse(await req.json()) })
    await logAudit('UPDATE', 'Process', id, `${proc.code} — ${proc.name}`)
    return ok(proc)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await assertCompanyAccess()
    const url = new URL(req.url)
    const activate = url.searchParams.get('activate') === '1'
    const proc = await db.process.update({ where: { id }, data: { active: activate } })
    await logAudit('UPDATE', 'Process', id, `${proc.code} ${activate ? 'reactivated' : 'deactivated'}`)
    return ok(proc)
  } catch (e) {
    return handleError(e)
  }
}
