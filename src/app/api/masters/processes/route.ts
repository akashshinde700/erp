import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET() {
  try {
    await assertCompanyAccess()
    return ok(await db.process.findMany({ orderBy: { seq: 'asc' } }))
  } catch (e) {
    return handleError(e)
  }
}

const processSchema = z.object({
  code: z.string().min(1, 'Code is required').max(20),
  name: z.string().min(1, 'Name is required'),
  seq: z.number().int().min(0).default(0),
  basis: z.enum(['WEIGHT', 'QTY']),
  rate: z.number().min(0).default(0),
  lotCharge: z.number().min(0).default(0),
})

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const proc = await db.process.create({ data: processSchema.parse(await req.json()) })
    await logAudit('CREATE', 'Process', proc.id, `${proc.code} — ${proc.name}`, actor?.email)
    return ok(proc)
  } catch (e) {
    return handleError(e)
  }
}
