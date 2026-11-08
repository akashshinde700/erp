import { z } from 'zod'
import { ok, handleError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { emailOverview, emailSalesInvoice, lastEmailFor, sendOverdueReminders, sendPaymentReminder, sendTestEmail } from '@/lib/notifications'

/**
 * Email notifications.
 *  GET                                   → { smtp status (no secrets), recent 50 emails }
 *  GET ?entity=SalesInvoice&ids=a,b      → last email status per document
 *  POST { action: 'test', to }
 *  POST { action: 'invoice', id, to? }   → email a posted sales invoice
 *  POST { action: 'reminder', partyId, force? }
 *  POST { action: 'reminders-all' }      → every customer with overdue invoices
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    const entity = sp.get('entity')
    if (entity) {
      if (!['SalesInvoice', 'Party'].includes(entity)) return ok({})
      const ids = (sp.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500)
      return ok(await lastEmailFor(entity, ids))
    }
    return ok(await emailOverview())
  } catch (e) {
    return handleError(e)
  }
}

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('test'), to: z.string({ error: 'Recipient is required' }).min(3, 'Recipient is required').max(254) }),
  z.object({ action: z.literal('invoice'), id: z.string().min(1, 'Invoice is required'), to: z.string().max(254).optional().nullable() }),
  z.object({ action: z.literal('reminder'), partyId: z.string().min(1, 'Customer is required'), force: z.boolean().optional() }),
  z.object({ action: z.literal('reminders-all') }),
])

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const input = body.parse(await req.json())
    const who = actor?.email ?? null
    if (input.action === 'test') {
      const r = await sendTestEmail(input.to, who)
      await logAudit('EMAIL', 'EmailLog', r.logId, `test email to ${r.to}`, who)
      return ok(r)
    }
    if (input.action === 'invoice') {
      const r = await emailSalesInvoice(input.id, { to: input.to, actor: who })
      await logAudit('EMAIL', 'SalesInvoice', input.id, `${r.invoiceNo} emailed to ${r.to}`, who)
      return ok(r)
    }
    if (input.action === 'reminder') {
      const r = await sendPaymentReminder(input.partyId, { actor: who, force: input.force })
      await logAudit('EMAIL', 'Party', input.partyId, `payment reminder to ${r.to} (${r.invoices} invoices, ${r.overdue})`, who)
      return ok(r)
    }
    const r = await sendOverdueReminders({ actor: who })
    await logAudit('EMAIL', 'Party', undefined, `overdue reminders: ${r.sent.length} sent, ${r.skipped.length} skipped`, who)
    return ok(r)
  } catch (e) {
    return handleError(e)
  }
}
