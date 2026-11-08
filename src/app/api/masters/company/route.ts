import { ok, fail, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { gstinChecksumValid } from '@/lib/erp'
import { gstStateCode } from '@/lib/validation'
import { accessState, assertCompanyAccess, assertMutationAccess, operatingCompany, orgLoginCount } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { tenantCompany } from '@/lib/tenant'
import { MAX_OVERHEAD_RATE_PCT } from '@/lib/costing'

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
  stateCode: gstStateCode.default('27'),
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
  // Factory overhead absorption: percentage of prime cost (material + labour)
  // added to WIP when an operation completes. 0 switches absorption off.
  overheadRatePct: z.coerce
    .number()
    .min(0, 'Overhead rate cannot be negative')
    .max(MAX_OVERHEAD_RATE_PCT, `Overhead rate above ${MAX_OVERHEAD_RATE_PCT}% is almost certainly a typo`)
    .optional(),
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
    const existing = await tenantCompany(db)
    const logins = await orgLoginCount()
    let actorEmail: string | null = null
    let actorRole: string | null = null
    if (logins > 0) {
      const actor = await assertMutationAccess()
      actorEmail = actor?.email ?? null
      actorRole = actor?.role ?? null
    }
    // The absorption rate is accounting policy: once logins exist only the
    // OWNER may change it, and who/when is recorded (the overhead advisor
    // also asks for a reason).
    const rateChanged = body.overheadRatePct !== undefined && body.overheadRatePct !== (existing?.overheadRatePct ?? 0)
    if (rateChanged && logins > 0 && actorRole !== 'OWNER') {
      return fail('Only the OWNER can change the overhead absorption rate', 403)
    }
    const data = rateChanged
      ? { ...body, overheadRateSetAt: new Date(), overheadRateSetBy: actorEmail ?? 'setup', overheadRateReason: 'Changed from the company profile' }
      : body
    const company = existing
      ? await db.company.update({ where: { id: existing.id }, data })
      : await db.company.create({ data })
    const detail =
      body.overheadRatePct !== undefined && body.overheadRatePct !== (existing?.overheadRatePct ?? 0)
        ? `${body.overheadRatePct}% overhead absorption (was ${existing?.overheadRatePct ?? 0}%) — already-completed operations keep their absorbed amount until a true-up is run`
        : company.name
    await logAudit(existing ? 'UPDATE' : 'CREATE', 'Company', company.id, detail, actorEmail ?? 'setup')
    return ok(company)
  } catch (e) {
    return handleError(e)
  }
}
