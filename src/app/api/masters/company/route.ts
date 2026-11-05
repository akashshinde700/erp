import { ok, fail, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { gstinChecksumValid } from '@/lib/erp'

export async function GET() {
  try {
    return ok(await db.company.findFirst())
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
})

export async function PUT(req: Request) {
  try {
    const body = companySchema.parse(await req.json())
    if (body.gstin && !gstinChecksumValid(body.gstin)) {
      return fail('Invalid GSTIN — checksum failed (format: 27ABCDE1234F1Z5)')
    }
    const existing = await db.company.findFirst()
    const company = existing
      ? await db.company.update({ where: { id: existing.id }, data: body })
      : await db.company.create({ data: body })
    return ok(company)
  } catch (e) {
    return handleError(e)
  }
}
