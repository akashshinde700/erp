import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { listBoms, createBom } from '@/lib/manufacturing'

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const params = new URL(req.url).searchParams
    const projectId = params.get('projectId') ?? undefined
    const itemId = params.get('itemId') ?? undefined
    const status = params.get('status') ?? undefined
    return ok(await listBoms({ projectId: projectId || undefined, itemId: itemId || undefined, status: status || undefined }))
  } catch (e) {
    return handleError(e)
  }
}

const bomLineSchema = z.object({
  itemId: z.string({ error: 'Material is required' }).min(1, 'Material is required'),
  grade: z.string().max(40).optional().nullable(),
  thickness: z.number().min(0).finite().max(10_000).default(0),
  length: z.number().min(0).finite().max(10_000_000).default(0),
  width: z.number().min(0).finite().max(10_000_000).default(0),
  qty: z.number().positive('Quantity must be > 0').finite().max(10_000_000),
  uom: z.string().min(1).max(10),
  wastagePct: z.number().min(0).max(50).finite().default(0),
  rate: z.number().min(0).finite().max(10_000_000).default(0),
  drawingRef: z.string().max(80).optional().nullable(),
  remarks: z.string().max(240).optional().nullable(),
})

const bomSchema = z.object({
  /** Optional: omit (or null) for a standard BOM used by stock production. */
  projectId: z.string().min(1).optional().nullable(),
  /** Output item — the link MRP explodes demand through. */
  itemId: z.string({ error: 'Output item is required' }).min(1, 'Output item is required'),
  productName: z.string().max(160).optional(),
  drawingRef: z.string().max(80).optional().nullable(),
  effectiveFrom: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  /** UNIT = quantities per output unit; BATCH = quantities for one batch of batchQty units. */
  lineBasis: z.enum(['BATCH', 'UNIT'], { error: 'Line basis must be BATCH or UNIT' }).optional(),
  batchQty: z.number().positive('Batch size must be > 0').finite().max(1_000_000).optional(),
  lines: z.array(bomLineSchema).min(1, 'Add at least one material line').max(200),
})

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = bomSchema.parse(await req.json())
    const bom = await createBom(body)
    await logAudit('CREATE', 'Bom', bom.id, `${bom.bomNo} rev ${bom.revision} — ${bom.productName} for ${bom.item?.code ?? bom.itemId} (${body.lines.length} lines)`, actor?.email)
    return ok(bom)
  } catch (e) {
    return handleError(e)
  }
}
