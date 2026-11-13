import { z } from 'zod'
import { withIdempotency } from '@/lib/idempotency'
import { fail, handleError, ok } from '@/lib/api'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { createQualityTemplate, qualityDashboard, recordQualityInspection } from '@/lib/quality'

export async function GET() { try { await assertCompanyAccess(); return ok(await qualityDashboard()) } catch (error) { return handleError(error) } }
async function handlePost(req: Request) {
  try {
    const actor = await assertMutationAccess(); const body = await req.json()
    if (body.action === 'create-template') {
      const p = z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), inspectionType: z.enum(['INWARD', 'PRODUCTION', 'DISPATCH', 'RETURN']), itemId: z.string().optional(), notes: z.string().optional(), parameters: z.array(z.object({ name: z.string().trim().min(1), dataType: z.enum(['NUMBER', 'TEXT', 'BOOLEAN']), unit: z.string().optional(), minValue: z.number().optional(), maxValue: z.number().optional(), expectedText: z.string().optional(), required: z.boolean().optional(), seq: z.number().int().nonnegative().optional() })).min(1, 'At least one QC parameter is required').max(100, 'A template can have at most 100 parameters') }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid QC template')
      return ok(await createQualityTemplate(p.data))
    }
    if (body.action === 'inspect') {
      const p = z.object({ templateId: z.string().min(1), referenceType: z.string().min(1), referenceId: z.string().min(1), itemId: z.string().optional(), disposition: z.enum(['ACCEPT', 'REWORK', 'SCRAP', 'RETURN_TO_VENDOR', 'QUARANTINE']).optional(), notes: z.string().optional(), measurements: z.array(z.object({ parameterId: z.string().min(1), numberValue: z.number().optional(), textValue: z.string().optional(), booleanValue: z.boolean().optional(), remarks: z.string().optional() })) }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid inspection')
      return ok(await recordQualityInspection({ ...p.data, inspectedBy: actor?.email ?? undefined }))
    }
    return fail('Unknown quality action')
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'quality', (r) => handlePost(r))
}
