import { ok, fail, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { gstinChecksumValid } from '@/lib/erp'
import { accessState, operatingCompany } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET() {
  try {
    const org = await operatingCompany()
    if (!org) return ok(null)
    const st = accessState(org)
    return ok({ ...org, access: { state: st.state, blocked: st.blocked, message: st.message } })
  } catch (e) {
    return handleError(e)
  }
}

const companySchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  legalName: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  stateCode: z.string().length(2).default('27'),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankAcct: z.string().optional().nullable(),
  bankIfsc: z.string().optional().nullable(),
  upiId: z.string().optional().nullable(),
  // Tally export settings (blank = engine defaults)
  tallyCompanyName: z.string().optional().nullable(),
  tallySalesLedger: z.string().optional().nullable(),
  tallyPurchaseLedger: z.string().optional().nullable(),
  tallyCgstLedger: z.string().optional().nullable(),
  tallySgstLedger: z.string().optional().nullable(),
  tallyIgstLedger: z.string().optional().nullable(),
  tallyRoundOffLedger: z.string().optional().nullable(),
})

export async function PUT(req: Request) {
  try {
    const body = companySchema.parse(await req.json())
    if (body.gstin && !gstinChecksumValid(body.gstin)) {
      return fail('Invalid GSTIN — checksum failed (format: 27ABCDE1234F1Z5)')
    }
    // Create/update the OPERATING org (first non-platform company; the
    // platform company is never the ERP workspace).
    const existing = await db.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } })
    const company = existing
      ? await db.company.update({ where: { id: existing.id }, data: body })
      : await db.company.create({ data: body })
    await logAudit(existing ? 'UPDATE' : 'CREATE', 'Company', company.id, company.name)
    return ok(company)
  } catch (e) {
    return handleError(e)
  }
}
