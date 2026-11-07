import { ok, fail, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { gstinChecksumValid } from '@/lib/erp'
import { gstStateCode } from '@/lib/validation'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { syncPartyOpeningBalance } from '@/lib/services'

const partyUpdateSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).optional(),
  types: z.array(z.enum(['CUSTOMER', 'SUPPLIER', 'JOBWORKER'])).min(1).optional(),
  gstin: z.string().optional().nullable(),
  stateCode: gstStateCode.optional(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  pincode: z
    .string()
    .regex(/^\d{6}$/, 'Pincode must be 6 digits')
    .optional()
    .nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  openingBal: z.number().optional(),
  active: z.boolean().optional(),
})

function parsePin(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined
  const t = typeof raw === 'string' ? raw.trim() : ''
  return t === '' ? null : t
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = partyUpdateSchema.parse(await req.json())
    if (body.gstin && !gstinChecksumValid(body.gstin)) {
      return fail('Invalid GSTIN — checksum failed')
    }
    const data: any = { ...body }
    if (body.types) data.types = body.types.join(',')
    if (body.gstin !== undefined) data.gstin = body.gstin || null
    const pin = parsePin(body.pincode)
    if (pin !== undefined) data.pincode = pin
    const party = await db.party.update({ where: { id }, data })
    // Opening balance changed (or legacy party never GL-posted) → mirror it
    // into the GL so outstanding / party ledger reconcile with trial balance.
    if (body.openingBal !== undefined) {
      await syncPartyOpeningBalance(id)
    }
    await logAudit('UPDATE', 'Party', id, `${party.code} — ${party.name}`, actor?.email)
    return ok(party)
  } catch (e) {
    return handleError(e)
  }
}

/** Soft toggle: parties with transactions are never hard-deleted (audit trail). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const url = new URL(req.url)
    const activate = url.searchParams.get('activate') === '1'
    const party = await db.party.update({ where: { id }, data: { active: activate } })
    await logAudit('UPDATE', 'Party', id, `${party.code} ${activate ? 'reactivated' : 'deactivated'}`, actor?.email)
    return ok(party)
  } catch (e) {
    return handleError(e)
  }
}
