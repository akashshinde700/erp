import { z } from 'zod'
import { fail, handleError, ok } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { withIdempotency } from '@/lib/idempotency'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import {
  SERVICE_PRIORITIES, assignServiceCall, cancelServiceCall, closeServiceCall, createServiceCall, invoiceServiceCall, resolveServiceCall, serviceDashboard,
} from '@/lib/service-calls'

export async function GET() {
  try { await assertCompanyAccess(); return ok(await serviceDashboard()) } catch (error) { return handleError(error) }
}

async function handlePost(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = await req.json()
    const action = String(body?.action ?? '')
    const who = actor?.email ?? undefined
    if (action === 'create') {
      const p = z.object({ partyId: z.string().min(1, 'Customer is required'), itemId: z.string().min(1).optional().nullable(), serialNo: z.string().trim().max(60).optional().nullable(), complaint: z.string().trim().min(5, 'Describe the complaint').max(2000), priority: z.enum(SERVICE_PRIORITIES).optional(), underWarranty: z.boolean().optional() }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid service call')
      const call = await createServiceCall({ ...p.data, createdBy: who })
      await logAudit('CREATE', 'ServiceCall', call.id, `${call.callNo} ${call.priority}`, who)
      return ok(call)
    }
    const id = z.string().min(1).safeParse(body?.id)
    if (!id.success) return fail('Service call id is required')
    if (action === 'assign') {
      const p = z.object({ employeeId: z.string().min(1, 'Choose an engineer') }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Choose an engineer')
      return ok(await assignServiceCall({ id: id.data, employeeId: p.data.employeeId }))
    }
    if (action === 'resolve') {
      const p = z.object({ resolution: z.string().trim().min(3, 'Describe what was done').max(2000), serviceCharge: z.number().min(0).finite().max(100_000_000).optional() }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid resolution')
      const call = await resolveServiceCall({ id: id.data, ...p.data })
      await logAudit('UPDATE', 'ServiceCall', id.data, `${call?.callNo} resolved, charge ₹${call?.serviceCharge}`, who)
      return ok(call)
    }
    if (action === 'close') return ok(await closeServiceCall(id.data))
    if (action === 'cancel') {
      const p = z.object({ reason: z.string().trim().min(1, 'A cancellation reason is required').max(1000) }).safeParse({ reason: String(body?.reason ?? '') })
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'A cancellation reason is required')
      const call = await cancelServiceCall({ id: id.data, reason: p.data.reason })
      await logAudit('CANCEL', 'ServiceCall', id.data, `${call?.callNo}: ${p.data.reason}`, who)
      return ok(call)
    }
    if (action === 'invoice') {
      const p = z.object({ serviceItemId: z.string().min(1, 'Choose the service item for the invoice') }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Choose the service item')
      const inv = await invoiceServiceCall({ id: id.data, serviceItemId: p.data.serviceItemId })
      await logAudit('POST', 'SalesInvoice', inv.id, `${inv.invoiceNo} for service call`, who)
      return ok(inv)
    }
    return fail('Unknown service-call action')
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'service-calls', () => handlePost(req))
}
