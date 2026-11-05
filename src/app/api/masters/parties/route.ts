import { ok, fail, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { gstinChecksumValid } from '@/lib/erp'
import { assertCompanyAccess, assertLimit } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams
    const type = sp.get('type')
    const search = sp.get('search')
    const where: any = {}
    if (type) where.types = { contains: type }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
      ]
    }
    const parties = await db.party.findMany({ where, orderBy: { code: 'asc' } })
    return ok(parties)
  } catch (e) {
    return handleError(e)
  }
}

const partySchema = z.object({
  code: z.string().min(1, 'Code is required').max(20),
  name: z.string().min(1, 'Name is required'),
  types: z.array(z.enum(['CUSTOMER', 'SUPPLIER', 'JOBWORKER'])).min(1, 'Pick at least one party type'),
  gstin: z.string().optional().nullable(),
  stateCode: z.string().length(2).default('27'),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  openingBal: z.number().default(0),
})

export async function POST(req: Request) {
  try {
    await assertCompanyAccess()
    await assertLimit('parties')
    const body = partySchema.parse(await req.json())
    if (body.gstin && !gstinChecksumValid(body.gstin)) {
      return fail('Invalid GSTIN — checksum failed (format: 27ABCDE1234F1Z5)')
    }
    const party = await db.party.create({
      data: { ...body, types: body.types.join(','), gstin: body.gstin || null },
    })
    await logAudit('CREATE', 'Party', party.id, `${party.code} — ${party.name}`)
    return ok(party)
  } catch (e) {
    return handleError(e)
  }
}
