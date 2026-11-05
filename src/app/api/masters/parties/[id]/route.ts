import { ok, fail, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { gstinChecksumValid } from '@/lib/erp'

const partyUpdateSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).optional(),
  types: z.array(z.enum(['CUSTOMER', 'SUPPLIER', 'JOBWORKER'])).min(1).optional(),
  gstin: z.string().optional().nullable(),
  stateCode: z.string().length(2).optional(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  openingBal: z.number().optional(),
  active: z.boolean().optional(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = partyUpdateSchema.parse(await req.json())
    if (body.gstin && !gstinChecksumValid(body.gstin)) {
      return fail('Invalid GSTIN — checksum failed')
    }
    const data: any = { ...body }
    if (body.types) data.types = body.types.join(',')
    if (body.gstin !== undefined) data.gstin = body.gstin || null
    const party = await db.party.update({ where: { id }, data })
    return ok(party)
  } catch (e) {
    return handleError(e)
  }
}

/** Soft toggle: parties with transactions are never hard-deleted (audit trail). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const url = new URL(req.url)
    const activate = url.searchParams.get('activate') === '1'
    const party = await db.party.update({ where: { id }, data: { active: activate } })
    return ok(party)
  } catch (e) {
    return handleError(e)
  }
}
