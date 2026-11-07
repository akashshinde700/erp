import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { updateBom } from '@/lib/manufacturing'

const bomLineSchema = z.object({
  itemId: z.string().min(1),
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

const bomUpdateSchema = z.object({
  productName: z.string().min(1).max(160).optional(),
  drawingRef: z.string().max(80).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  lines: z.array(bomLineSchema).min(1).max(200),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = bomUpdateSchema.parse(await req.json())
    const bom = await updateBom(id, body)
    await logAudit('UPDATE', 'Bom', id, `${bom.bomNo} revised (${body.lines.length} lines)`, actor?.email)
    return ok(bom)
  } catch (e) {
    return handleError(e)
  }
}
