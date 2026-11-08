/**
 * ForgeERP — CRM: salespersons, leads (enquiries) with a follow-up trail,
 * conversion of a qualified lead into a customer, pipeline and
 * salesperson performance.
 *
 * Lead stages: NEW -> CONTACTED -> QUALIFIED -> PROPOSAL -> WON | LOST.
 * LOST needs a reason; WON needs a customer (convert first). WON and LOST
 * are terminal except that the OWNER may re-open a lost lead.
 */
import { Prisma } from '@prisma/client'
import { db } from './db'
import { BusinessError } from './accounting'
import { fyCode, gstinChecksumValid, isStateCode, r2 } from './erp'
import { tenantCompany } from './tenant'

type Tx = Prisma.TransactionClient

export const LEAD_SOURCES = ['WEBSITE', 'REFERRAL', 'EXHIBITION', 'COLD_CALL', 'MARKETPLACE', 'EXISTING_CUSTOMER', 'OTHER'] as const
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'] as const
export const ACTIVITY_TYPES = ['CALL', 'MEETING', 'EMAIL', 'VISIT', 'NOTE'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

/** Allowed moves between lead stages. */
const NEXT: Record<LeadStatus, LeadStatus[]> = {
  NEW: ['CONTACTED', 'QUALIFIED', 'LOST'],
  CONTACTED: ['QUALIFIED', 'PROPOSAL', 'LOST'],
  QUALIFIED: ['PROPOSAL', 'WON', 'LOST'],
  PROPOSAL: ['WON', 'LOST', 'QUALIFIED'],
  WON: [],
  LOST: ['CONTACTED'],
}
/** Default win probability when a lead enters a stage. */
const STAGE_PROBABILITY: Record<LeadStatus, number> = { NEW: 10, CONTACTED: 20, QUALIFIED: 40, PROPOSAL: 60, WON: 100, LOST: 0 }

async function org(tx: Tx) {
  const company = await tenantCompany(tx)
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  return company
}

// ---------------------------------------------------------------- salespersons

export function listSalespersons() {
  return db.salesperson.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] })
}

export async function saveSalesperson(input: { id?: string; code: string; name: string; phone?: string | null; email?: string | null; monthlyTarget?: number; active?: boolean }) {
  const code = input.code.trim().toUpperCase()
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const clash = await tx.salesperson.findFirst({ where: { code, ...(input.id ? { id: { not: input.id } } : {}) } })
    if (clash) throw new BusinessError(`Salesperson code ${code} is already used by ${clash.name}`, 409)
    const data = { code, name: input.name.trim(), phone: input.phone || null, email: input.email || null, monthlyTarget: r2(input.monthlyTarget ?? 0), active: input.active ?? true }
    if (input.id) {
      if (!(await tx.salesperson.findFirst({ where: { id: input.id } }))) throw new BusinessError('Salesperson not found', 404)
      return tx.salesperson.update({ where: { id: input.id }, data })
    }
    return tx.salesperson.create({ data: { companyId: company.id, ...data } })
  })
}

// ---------------------------------------------------------------- leads

export interface LeadInput {
  contactName: string
  organisation?: string | null
  phone?: string | null
  email?: string | null
  city?: string | null
  stateCode?: string | null
  gstin?: string | null
  source?: (typeof LEAD_SOURCES)[number]
  requirement?: string | null
  expectedValue?: number
  expectedCloseDate?: Date | null
  nextFollowUpAt?: Date | null
  salespersonId?: string | null
  createdBy?: string
}

function checkContact(input: { phone?: string | null; email?: string | null; gstin?: string | null; stateCode?: string | null }) {
  if (!input.phone && !input.email) throw new BusinessError('Give a phone number or an email so the lead can be followed up')
  if (input.gstin && !gstinChecksumValid(input.gstin.toUpperCase())) throw new BusinessError('GSTIN is not valid (format or check digit)')
  if (input.stateCode && !isStateCode(input.stateCode)) throw new BusinessError('State code is not valid')
}

export async function createLead(input: LeadInput) {
  checkContact(input)
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    if (input.salespersonId && !(await tx.salesperson.findFirst({ where: { id: input.salespersonId, active: true } }))) throw new BusinessError('Salesperson not found or inactive', 404)
    // duplicate guard: the same phone / email already has an open lead
    const or = [input.phone ? { phone: input.phone } : null, input.email ? { email: input.email.toLowerCase() } : null].filter(Boolean) as Prisma.LeadWhereInput[]
    const dup = await tx.lead.findFirst({ where: { OR: or, status: { notIn: ['WON', 'LOST'] } } })
    if (dup) throw new BusinessError(`An open lead already exists for this contact: ${dup.leadNo} (${dup.contactName})`, 409)
    const date = new Date()
    const display = `LD-${fyCode(date)}`
    const key = `${company.id}:${display}`
    const counter = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } })
    return tx.lead.create({
      data: {
        companyId: company.id, leadNo: `${display}-${String(counter.value).padStart(3, '0')}`, date,
        contactName: input.contactName.trim(), organisation: input.organisation || null, phone: input.phone || null, email: input.email ? input.email.toLowerCase() : null,
        city: input.city || null, stateCode: input.stateCode || null, gstin: input.gstin ? input.gstin.toUpperCase() : null, source: input.source ?? 'OTHER',
        requirement: input.requirement || null, expectedValue: r2(input.expectedValue ?? 0), expectedCloseDate: input.expectedCloseDate ?? null,
        nextFollowUpAt: input.nextFollowUpAt ?? null, salespersonId: input.salespersonId ?? null, createdBy: input.createdBy,
        probability: STAGE_PROBABILITY.NEW,
      },
    })
  })
}

export async function updateLead(id: string, input: Partial<LeadInput> & { probability?: number }) {
  const lead = await db.lead.findFirst({ where: { id } })
  if (!lead) throw new BusinessError('Lead not found', 404)
  if (lead.status === 'WON' || lead.status === 'LOST') throw new BusinessError(`Lead is ${lead.status.toLowerCase()}; re-open it first`, 409)
  checkContact({ phone: input.phone ?? lead.phone, email: input.email ?? lead.email, gstin: input.gstin, stateCode: input.stateCode })
  if (input.salespersonId && !(await db.salesperson.findFirst({ where: { id: input.salespersonId, active: true } }))) throw new BusinessError('Salesperson not found or inactive', 404)
  if (input.probability !== undefined && (input.probability < 0 || input.probability > 100)) throw new BusinessError('Probability is 0 to 100')
  const { createdBy: _ignored, ...rest } = input
  return db.lead.update({ where: { id }, data: { ...rest, email: rest.email ? rest.email.toLowerCase() : rest.email, gstin: rest.gstin ? rest.gstin.toUpperCase() : rest.gstin, expectedValue: rest.expectedValue !== undefined ? r2(rest.expectedValue) : undefined } })
}

export async function moveLead(input: { id: string; status: LeadStatus; reason?: string; actor?: { role: string; email: string | null } | null }) {
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: input.id } })
    if (!lead) throw new BusinessError('Lead not found', 404)
    const from = lead.status as LeadStatus
    if (!NEXT[from].includes(input.status)) throw new BusinessError(`A ${from.toLowerCase()} lead cannot move to ${input.status.toLowerCase()}`, 409)
    if (input.status === 'LOST' && !input.reason?.trim()) throw new BusinessError('Say why the lead was lost')
    if (input.status === 'WON' && !lead.partyId) throw new BusinessError('Convert the lead into a customer before marking it won', 409)
    if (from === 'LOST' && input.actor && input.actor.role !== 'OWNER' && input.actor.role !== 'SUPER_ADMIN') throw new BusinessError('Only the OWNER can re-open a lost lead', 403)
    const terminal = input.status === 'WON' || input.status === 'LOST'
    const upd = await tx.lead.updateMany({
      where: { id: lead.id, status: from },
      data: { status: input.status, probability: STAGE_PROBABILITY[input.status], lostReason: input.status === 'LOST' ? input.reason!.trim() : from === 'LOST' ? null : lead.lostReason, closedAt: terminal ? new Date() : null, ...(terminal ? { nextFollowUpAt: null } : {}) },
    })
    if (upd.count !== 1) throw new BusinessError('Lead was changed by someone else; refresh', 409)
    await tx.leadActivity.create({ data: { leadId: lead.id, type: 'NOTE', notes: `Stage ${from} -> ${input.status}${input.reason ? `: ${input.reason.trim()}` : ''}`, doneAt: new Date(), createdBy: input.actor?.email ?? undefined } })
    return tx.lead.findFirst({ where: { id: lead.id } })
  })
}

export async function addActivity(input: { leadId: string; type: (typeof ACTIVITY_TYPES)[number]; notes: string; dueAt?: Date | null; done?: boolean; createdBy?: string }) {
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: input.leadId } })
    if (!lead) throw new BusinessError('Lead not found', 404)
    if (!input.done && !input.dueAt) throw new BusinessError('A planned follow-up needs a due date')
    const act = await tx.leadActivity.create({ data: { leadId: lead.id, type: input.type, notes: input.notes.trim(), dueAt: input.dueAt ?? null, doneAt: input.done ? new Date() : null, createdBy: input.createdBy } })
    // the earliest open follow-up drives the lead's next follow-up date
    const nextOpen = await tx.leadActivity.findFirst({ where: { leadId: lead.id, doneAt: null, dueAt: { not: null } }, orderBy: { dueAt: 'asc' } })
    await tx.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: nextOpen?.dueAt ?? null, ...(lead.status === 'NEW' && input.done ? { status: 'CONTACTED', probability: STAGE_PROBABILITY.CONTACTED } : {}) } })
    return act
  })
}

export async function completeActivity(input: { id: string; outcome?: string }) {
  return db.$transaction(async (tx) => {
    const act = await tx.leadActivity.findFirst({ where: { id: input.id }, include: { lead: true } })
    if (!act) throw new BusinessError('Activity not found', 404)
    if (act.doneAt) throw new BusinessError('Activity is already done', 409)
    await tx.leadActivity.update({ where: { id: act.id }, data: { doneAt: new Date(), notes: input.outcome ? `${act.notes}\nOutcome: ${input.outcome.trim()}` : act.notes } })
    const nextOpen = await tx.leadActivity.findFirst({ where: { leadId: act.leadId, doneAt: null, dueAt: { not: null } }, orderBy: { dueAt: 'asc' } })
    await tx.lead.update({ where: { id: act.leadId }, data: { nextFollowUpAt: nextOpen?.dueAt ?? null, ...(act.lead.status === 'NEW' ? { status: 'CONTACTED', probability: STAGE_PROBABILITY.CONTACTED } : {}) } })
    return tx.leadActivity.findFirst({ where: { id: act.id } })
  })
}

/**
 * Turn a lead into a customer: link an existing customer, or create one from
 * the lead's details. The lead becomes QUALIFIED (if earlier) and keeps the link,
 * so a quotation can be raised for it straight away.
 */
export async function convertLead(input: { id: string; partyId?: string; code?: string }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const lead = await tx.lead.findFirst({ where: { id: input.id } })
    if (!lead) throw new BusinessError('Lead not found', 404)
    if (lead.partyId) throw new BusinessError('Lead is already converted', 409)
    if (lead.status === 'LOST') throw new BusinessError('A lost lead cannot be converted; re-open it first', 409)
    let partyId = input.partyId
    if (partyId) {
      const party = await tx.party.findFirst({ where: { id: partyId, active: true } })
      if (!party) throw new BusinessError('Customer not found', 404)
      if (!party.types.split(',').includes('CUSTOMER')) await tx.party.update({ where: { id: party.id }, data: { types: `${party.types},CUSTOMER` } })
    } else {
      const code = (input.code ?? '').trim().toUpperCase()
      if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) throw new BusinessError('Give the new customer a code (2-20 letters, digits, - or _)')
      if (await tx.party.findFirst({ where: { code } })) throw new BusinessError(`Party code ${code} already exists`, 409)
      const party = await tx.party.create({
        data: {
          companyId: company.id, code, name: lead.organisation || lead.contactName, types: 'CUSTOMER', gstin: lead.gstin, stateCode: lead.stateCode || (lead.gstin ? lead.gstin.slice(0, 2) : company.stateCode),
          city: lead.city, phone: lead.phone, email: lead.email,
        },
      })
      partyId = party.id
    }
    const early = ['NEW', 'CONTACTED'].includes(lead.status)
    await tx.lead.update({ where: { id: lead.id }, data: { partyId, ...(early ? { status: 'QUALIFIED', probability: STAGE_PROBABILITY.QUALIFIED } : {}) } })
    await tx.leadActivity.create({ data: { leadId: lead.id, type: 'NOTE', notes: 'Converted to customer', doneAt: new Date() } })
    return tx.lead.findFirst({ where: { id: lead.id }, include: { party: { select: { id: true, code: true, name: true } } } })
  })
}

export async function crmDashboard() {
  const [leads, salespersons] = await Promise.all([
    db.lead.findMany({ orderBy: [{ status: 'asc' }, { nextFollowUpAt: 'asc' }, { createdAt: 'desc' }], take: 1000, include: { salesperson: { select: { id: true, name: true } }, party: { select: { id: true, code: true, name: true } }, activities: { orderBy: { createdAt: 'desc' }, take: 20 } } }),
    listSalespersons(),
  ])
  const now = new Date()
  const open = leads.filter((l) => l.status !== 'WON' && l.status !== 'LOST')
  const pipeline = LEAD_STATUSES.map((status) => {
    const rows = leads.filter((l) => l.status === status)
    return { status, count: rows.length, value: r2(rows.reduce((s, l) => s + l.expectedValue, 0)), weighted: r2(rows.reduce((s, l) => s + (l.expectedValue * l.probability) / 100, 0)) }
  })
  const closed = leads.filter((l) => l.status === 'WON' || l.status === 'LOST')
  return {
    leads,
    salespersons,
    pipeline,
    overdueFollowUps: open.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt < now).length,
    noFollowUp: open.filter((l) => !l.nextFollowUpAt).length,
    winRate: closed.length ? r2((closed.filter((l) => l.status === 'WON').length * 100) / closed.length) : null,
    lostReasons: Object.entries(leads.filter((l) => l.status === 'LOST').reduce<Record<string, number>>((m, l) => { const k = (l.lostReason ?? 'unspecified').trim().toLowerCase(); m[k] = (m[k] ?? 0) + 1; return m }, {})).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  }
}

/**
 * Salesperson performance for a month: invoiced value (taxable, posted
 * invoices; a challan invoice is credited to its sales order's salesperson),
 * target achievement, open pipeline and won leads.
 */
export async function salespersonReport(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BusinessError('Month looks like 2026-11')
  const [y, m] = month.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1)), to = new Date(Date.UTC(y, m, 1))
  const [people, invoices, leads, quotes] = await Promise.all([
    db.salesperson.findMany({ orderBy: { name: 'asc' } }),
    db.salesInvoice.findMany({ where: { status: 'POSTED', date: { gte: from, lt: to } }, select: { taxable: true, grandTotal: true, salespersonId: true } }),
    db.lead.findMany({ select: { salespersonId: true, status: true, expectedValue: true, probability: true, closedAt: true } }),
    db.salesQuotation.findMany({ where: { date: { gte: from, lt: to }, status: { notIn: ['SUPERSEDED', 'CANCELLED'] } }, select: { salespersonId: true, grandTotal: true } }),
  ])
  const rows = people.map((p) => {
    const inv = invoices.filter((i) => i.salespersonId === p.id)
    const invoiced = r2(inv.reduce((s, i) => s + i.taxable, 0))
    const mine = leads.filter((l) => l.salespersonId === p.id)
    const openLeads = mine.filter((l) => l.status !== 'WON' && l.status !== 'LOST')
    return {
      id: p.id, code: p.code, name: p.name, active: p.active, target: p.monthlyTarget, invoiced, invoices: inv.length,
      achievementPct: p.monthlyTarget > 0 ? r2((invoiced * 100) / p.monthlyTarget) : null,
      quoted: r2(quotes.filter((q) => q.salespersonId === p.id).reduce((s, q) => s + q.grandTotal, 0)),
      openLeads: openLeads.length, pipelineWeighted: r2(openLeads.reduce((s, l) => s + (l.expectedValue * l.probability) / 100, 0)),
      wonInMonth: mine.filter((l) => l.status === 'WON' && l.closedAt && l.closedAt >= from && l.closedAt < to).length,
    }
  })
  const unassigned = invoices.filter((i) => !i.salespersonId)
  return { month, rows, unassignedInvoiced: r2(unassigned.reduce((s, i) => s + i.taxable, 0)), unassignedInvoices: unassigned.length }
}
