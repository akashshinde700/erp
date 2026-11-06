import { ok, fail, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { gstinChecksumValid } from '@/lib/erp'
import { accessState, assertCompanyAccess, assertMutationAccess, operatingCompany, orgLoginCount } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/masters/company — the operating org's profile (incl. bank details
 * printed on invoices). PUBLIC ONLY while no org login exists (first-boot
 * setup probe). Once logins exist the caller must hold a signed-in session
 * for the operating org — bank details are never served anonymously.
 */
export async function GET() {
  try {
    // ORG logins gate the profile (platform SUPER_ADMIN never counts — it
    // belongs to the operator's company, not the operating org).
    const logins = await orgLoginCount()
    if (logins > 0) {
      // Authenticated path: session must belong to the operating org.
      await assertCompanyAccess()
    }
    const org = await operatingCompany()
    if (!org) return ok(null)
    const st = accessState(org)
    return ok({ ...org, access: { state: st.state, blocked: st.blocked, message: st.message } })
  } catch (e) {
    return handleError(e)
  }
}

const companySchema = z.object({
  name: z.string().min(1, 'Company name is required').max(120),
  legalName: z.string().max(160).optional().nullable(),
  gstin: z.string().max(20).optional().nullable(),
  stateCode: z.string().length(2).default('27'),
  address: z.string().max(240).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  pincode: z.string().max(12).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().max(120).optional().nullable(),
  bankName: z.string().max(120).optional().nullable(),
  bankAcct: z.string().max(40).optional().nullable(),
  bankIfsc: z.string().max(20).optional().nullable(),
  upiId: z.string().max(80).optional().nullable(),
  // Tally export settings (blank = engine defaults)
  tallyCompanyName: z.string().max(120).optional().nullable(),
  tallySalesLedger: z.string().max(80).optional().nullable(),
  tallyPurchaseLedger: z.string().max(80).optional().nullable(),
  tallyCgstLedger: z.string().max(80).optional().nullable(),
  tallySgstLedger: z.string().max(80).optional().nullable(),
  tallyIgstLedger: z.string().max(80).optional().nullable(),
  tallyRoundOffLedger: z.string().max(80).optional().nullable(),
})

export async function PUT(req: Request) {
  try {
    const body = companySchema.parse(await req.json())
    if (body.gstin && !gstinChecksumValid(body.gstin)) {
      return fail('Invalid GSTIN — checksum failed (format: 27ABCDE1234F1Z5)')
    }
    // First boot (no operating org / no logins yet): the setup wizard may
    // create the company anonymously — exactly once. After that this is a
    // privileged mutation (bank details feed every printed invoice): a
    // signed-in OWNER/ACCOUNTANT session is required (VIEWER is read-only).
    const existing = await db.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } })
    const logins = await orgLoginCount()
    if (logins > 0) {
      await assertMutationAccess()
    }
    const company = existing
      ? await db.company.update({ where: { id: existing.id }, data: body })
      : await db.company.create({ data: body })
    await logAudit(existing ? 'UPDATE' : 'CREATE', 'Company', company.id, company.name)
    return ok(company)
  } catch (e) {
    return handleError(e)
  }
}
