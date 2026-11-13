import { z } from 'zod'
import { ok, handleError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { cancelProforma, convertProforma, createProforma, getProforma, listProformas } from '@/lib/proforma'

/**
 * Proforma invoices (PI) — post nothing until converted.
 *  GET            → list (newest 300)        GET ?id=… → one PI with lines
 *  POST { action: 'create', partyId, validUntil, salesOrderId?, terms?, lines? }
 *  POST { action: 'cancel', id, reason }
 *  POST { action: 'convert', id, warehouseId }   → standalone PI becomes a tax invoice, once
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const id = new URL(req.url).searchParams.get('id')
    return ok(id ? await getProforma(id) : await listProformas())
  } catch (e) {
    return handleError(e)
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').transform((v) => new Date(`${v}T00:00:00.000Z`))
const line = z.object({ itemId: z.string().min(1, 'Item is required'), qty: z.number().positive('Quantity must be > 0').max(10_000_000), rate: z.number().min(0).max(1e9), discPct: z.number().min(0).max(100).optional() })
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), partyId: z.string().min(1, 'Customer is required'), date: day.optional(), validUntil: day, salesOrderId: z.string().min(1).optional().nullable(), terms: z.string().max(2000).optional().nullable(), lines: z.array(line).max(200).optional() }),
  z.object({ action: z.literal('cancel'), id: z.string().min(1), reason: z.string().max(190) }),
  z.object({ action: z.literal('convert'), id: z.string().min(1), warehouseId: z.string().min(1, 'Pick the warehouse to dispatch from') }),
])

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const input = body.parse(await req.json())
    const who = actor?.email ?? null
    if (input.action === 'create') {
      const pi = await createProforma({ ...input, createdBy: who })
      await logAudit('CREATE', 'ProformaInvoice', pi.id, `${pi.piNo} for ${pi.party.name} ₹${pi.grandTotal}${pi.salesOrder ? ` (order ${pi.salesOrder.orderNo})` : ''}`, who)
      return ok(pi)
    }
    if (input.action === 'cancel') {
      const pi = await cancelProforma(input.id, input.reason)
      await logAudit('CANCEL', 'ProformaInvoice', pi.id, `${pi.piNo}: ${input.reason}`, who)
      return ok(pi)
    }
    const r = await convertProforma(input.id, { warehouseId: input.warehouseId, actor: who })
    await logAudit('POST', 'SalesInvoice', r.invoiceId, `${r.invoiceNo} from proforma ${r.piNo}`, who)
    return ok(r)
  } catch (e) {
    return handleError(e)
  }
}
