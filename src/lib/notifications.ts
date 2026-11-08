/**
 * ForgeERP — email notifications: invoice to customer, payment reminders for
 * overdue invoices, and a test message. Every attempt (sent or failed) is
 * written to EmailLog so the UI can show an "email status" next to documents.
 */
import { db } from './db'
import { BusinessError } from './accounting'
import { r2 } from './erp'
import { tenantCompany } from './tenant'
import { agingReport } from './reports-extra'
import { deliver, esc, mailStatus, normaliseAddress, type OutgoingMail } from './mailer'

const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
const day = (d: Date) => d.toISOString().slice(0, 10)

async function org() {
  const company = await tenantCompany(db)
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  return company
}

type Kind = 'TEST' | 'INVOICE' | 'REMINDER'

/** Send and log. A failure is logged and re-thrown so the caller sees it. */
async function sendLogged(
  companyId: string,
  kind: Kind,
  mail: OutgoingMail,
  meta: { entityType?: string; entityId?: string; actor?: string | null }
) {
  try {
    const { messageId } = await deliver(mail)
    return await db.emailLog.create({
      data: { companyId, kind, toAddress: mail.to, subject: mail.subject.slice(0, 300), status: 'SENT', messageId: messageId?.slice(0, 300) ?? null, entityType: meta.entityType ?? null, entityId: meta.entityId ?? null, createdBy: meta.actor ?? null },
    })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db.emailLog.create({
      data: { companyId, kind, toAddress: mail.to, subject: mail.subject.slice(0, 300), status: 'FAILED', error: error.slice(0, 300), entityType: meta.entityType ?? null, entityId: meta.entityId ?? null, createdBy: meta.actor ?? null },
    })
    throw e
  }
}

function frame(companyName: string, title: string, body: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1f2a44;color:#ffffff;padding:16px 24px;font-size:16px;font-weight:600">${esc(companyName)}</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:18px">${esc(title)}</h1>${body}</td></tr>
<tr><td style="padding:12px 24px;background:#f9fafb;color:#6b7280;font-size:12px">${footer}</td></tr>
</table></td></tr></table></body></html>`
}

function signature(company: { name: string; phone: string | null; email: string | null; gstin: string | null }) {
  return [esc(company.name), company.gstin ? `GSTIN ${esc(company.gstin)}` : '', company.phone ? esc(company.phone) : '', company.email ? esc(company.email) : '']
    .filter(Boolean)
    .join(' · ')
}

// ---------- test ----------

export async function sendTestEmail(to: string, actor?: string | null) {
  const company = await org()
  const address = normaliseAddress(to)
  const subject = `${company.name} — ForgeERP test email`
  const html = frame(company.name, 'Email is working', `<p>This is a test message from ForgeERP. If you can read it, outgoing email is configured correctly.</p>`, signature(company))
  const log = await sendLogged(company.id, 'TEST', { to: address, subject, html, text: `This is a test message from ForgeERP (${company.name}). Outgoing email is configured correctly.`, replyTo: company.email }, { actor })
  return { sent: true, to: address, logId: log.id }
}

// ---------- invoice ----------

export async function emailSalesInvoice(invoiceId: string, opts: { to?: string | null; actor?: string | null } = {}) {
  const company = await org()
  const inv = await db.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: { party: { select: { name: true, email: true, creditDays: true } }, items: { include: { item: { select: { code: true, name: true } } } } },
  })
  if (!inv) throw new BusinessError('Invoice not found', 404)
  if (inv.status !== 'POSTED') throw new BusinessError(`Invoice is ${inv.status} — only posted invoices can be emailed`, 409)
  const raw = opts.to?.trim() || inv.party.email
  if (!raw) throw new BusinessError(`${inv.party.name} has no email address — add one in Masters → Parties or type an address`, 400)
  const to = normaliseAddress(raw)
  const due = new Date(inv.date.getTime() + inv.party.creditDays * 86_400_000)
  const balance = r2(inv.grandTotal - inv.paidAmount)
  const rows = inv.items
    .map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(l.item.name)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${esc(l.qty)} ${esc(l.uom)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${inr(l.rate)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${inr(l.total)}</td></tr>`)
    .join('')
  const tax = r2(inv.cgst + inv.sgst + inv.igst)
  const body = `<p>Dear ${esc(inv.party.name)},</p>
<p>Please find the details of invoice <b>${esc(inv.invoiceNo)}</b> dated ${day(inv.date)}.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin:12px 0">
<tr style="background:#f3f4f6"><th align="left" style="padding:6px 8px">Item</th><th align="right" style="padding:6px 8px">Qty</th><th align="right" style="padding:6px 8px">Rate</th><th align="right" style="padding:6px 8px">Amount</th></tr>
${rows}
<tr><td colspan="3" align="right" style="padding:6px 8px">Taxable</td><td align="right" style="padding:6px 8px">${inr(inv.taxable)}</td></tr>
<tr><td colspan="3" align="right" style="padding:6px 8px">GST</td><td align="right" style="padding:6px 8px">${inr(tax)}</td></tr>
<tr><td colspan="3" align="right" style="padding:6px 8px;font-weight:600">Invoice total</td><td align="right" style="padding:6px 8px;font-weight:600">${inr(inv.grandTotal)}</td></tr>
</table>
<p>Amount due: <b>${inr(balance)}</b> by <b>${day(due)}</b>${inv.party.creditDays ? ` (${inv.party.creditDays} days credit)` : ''}.</p>
<p>Thank you for your business.</p>`
  const subject = `Invoice ${inv.invoiceNo} from ${company.name} — ${inr(inv.grandTotal)}`
  const text = `Dear ${inv.party.name},\n\nInvoice ${inv.invoiceNo} dated ${day(inv.date)}: total ${inr(inv.grandTotal)}, amount due ${inr(balance)} by ${day(due)}.\n\n${company.name}`
  const log = await sendLogged(company.id, 'INVOICE', { to, subject, html: frame(company.name, `Invoice ${inv.invoiceNo}`, body, signature(company)), text, replyTo: company.email }, { entityType: 'SalesInvoice', entityId: inv.id, actor: opts.actor })
  return { sent: true, to, invoiceNo: inv.invoiceNo, logId: log.id }
}

// ---------- payment reminders ----------

const REMINDER_COOLDOWN_MS = 20 * 60 * 60 * 1000 // at most one reminder per customer per day

export async function sendPaymentReminder(partyId: string, opts: { actor?: string | null; force?: boolean } = {}) {
  const company = await org()
  const party = await db.party.findUnique({ where: { id: partyId }, select: { id: true, name: true, email: true } })
  if (!party) throw new BusinessError('Customer not found', 404)
  const aging = await agingReport('SALES')
  const overdue = aging.invoices.filter((i) => i.partyId === partyId && i.daysOverdue > 0)
  if (!overdue.length) throw new BusinessError(`${party.name} has no overdue invoices — nothing to remind`, 409)
  if (!party.email) throw new BusinessError(`${party.name} has no email address — add one in Masters → Parties`, 400)
  const to = normaliseAddress(party.email)
  if (!opts.force) {
    const recent = await db.emailLog.findFirst({
      where: { companyId: company.id, kind: 'REMINDER', entityId: partyId, status: 'SENT', createdAt: { gte: new Date(Date.now() - REMINDER_COOLDOWN_MS) } },
      select: { createdAt: true },
    })
    if (recent) throw new BusinessError(`${party.name} was already reminded at ${recent.createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC — one reminder per day`, 409)
  }
  const total = r2(overdue.reduce((s, i) => s + i.balance, 0))
  const rows = overdue
    .map((i) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(i.invoiceNo)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${day(i.dueDate)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${i.daysOverdue}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${inr(i.balance)}</td></tr>`)
    .join('')
  const body = `<p>Dear ${esc(party.name)},</p>
<p>Our records show the following invoice${overdue.length > 1 ? 's are' : ' is'} past due:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin:12px 0">
<tr style="background:#f3f4f6"><th align="left" style="padding:6px 8px">Invoice</th><th align="left" style="padding:6px 8px">Due</th><th align="right" style="padding:6px 8px">Days overdue</th><th align="right" style="padding:6px 8px">Balance</th></tr>
${rows}
<tr><td colspan="3" align="right" style="padding:6px 8px;font-weight:600">Total overdue</td><td align="right" style="padding:6px 8px;font-weight:600">${inr(total)}</td></tr>
</table>
<p>Please arrange payment at the earliest. If you have already paid, kindly share the payment reference and ignore this reminder.</p>`
  const subject = `Payment reminder: ${inr(total)} overdue — ${company.name}`
  const text = `Dear ${party.name},\n\nOverdue invoices: ${overdue.map((i) => `${i.invoiceNo} (${inr(i.balance)}, ${i.daysOverdue} days)`).join('; ')}. Total overdue ${inr(total)}.\n\n${company.name}`
  const log = await sendLogged(company.id, 'REMINDER', { to, subject, html: frame(company.name, 'Payment reminder', body, signature(company)), text, replyTo: company.email }, { entityType: 'Party', entityId: partyId, actor: opts.actor })
  return { sent: true, to, party: party.name, invoices: overdue.length, overdue: total, logId: log.id }
}

/** Remind every customer with overdue invoices; never throws for one bad party. */
export async function sendOverdueReminders(opts: { actor?: string | null } = {}) {
  const status = mailStatus()
  if (!status.configured) throw new BusinessError(`Email is not set up: ${status.reason}. Ask the administrator to configure SMTP.`, 409)
  const aging = await agingReport('SALES')
  const partyIds = [...new Set(aging.invoices.filter((i) => i.daysOverdue > 0).map((i) => i.partyId))]
  const sent: { party: string; to: string; overdue: number }[] = []
  const skipped: { partyId: string; reason: string }[] = []
  for (const id of partyIds) {
    try {
      const r = await sendPaymentReminder(id, { actor: opts.actor })
      sent.push({ party: r.party, to: r.to, overdue: r.overdue })
    } catch (e) {
      skipped.push({ partyId: id, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  return { customersOverdue: partyIds.length, sent, skipped }
}

// ---------- overview ----------

export async function emailOverview() {
  const company = await org()
  const recent = await db.emailLog.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, kind: true, toAddress: true, subject: true, status: true, error: true, entityType: true, entityId: true, createdBy: true, createdAt: true },
  })
  return { smtp: mailStatus(), recent }
}

/** Last email status per document, for "email status" columns. */
export async function lastEmailFor(entityType: string, entityIds: string[]) {
  if (!entityIds.length) return {}
  const rows = await db.emailLog.findMany({
    where: { entityType, entityId: { in: entityIds } },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, status: true, toAddress: true, createdAt: true },
  })
  const out: Record<string, { status: string; to: string; at: Date }> = {}
  for (const r of rows) if (r.entityId && !out[r.entityId]) out[r.entityId] = { status: r.status, to: r.toAddress, at: r.createdAt }
  return out
}
