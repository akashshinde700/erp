import { z } from 'zod'
import { fail, handleError, ok } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { withIdempotency } from '@/lib/idempotency'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import {
  ACTIVITY_TYPES, LEAD_SOURCES, LEAD_STATUSES, addActivity, completeActivity, convertLead, createLead, crmDashboard, moveLead,
  listSalespersons, saveSalesperson, salespersonReport, updateLead,
} from '@/lib/crm'

const day = z.string().date('Use YYYY-MM-DD').transform((v) => new Date(`${v}T00:00:00.000Z`))
const opt = (s: z.ZodString) => s.optional().nullable()
const leadFields = {
  contactName: z.string().trim().min(2, 'Contact name is required').max(80),
  organisation: opt(z.string().trim().max(120)),
  phone: opt(z.string().trim().regex(/^[0-9+\- ]{6,20}$/, 'Phone number looks wrong')),
  email: opt(z.string().trim().email('Email looks wrong').max(120)),
  city: opt(z.string().trim().max(60)),
  stateCode: opt(z.string().trim().max(2)),
  gstin: opt(z.string().trim().length(15, 'GSTIN has 15 characters')),
  source: z.enum(LEAD_SOURCES).optional(),
  requirement: opt(z.string().trim().max(2000)),
  expectedValue: z.number().min(0).finite().max(10_000_000_000).optional(),
  expectedCloseDate: day.optional().nullable(),
  nextFollowUpAt: day.optional().nullable(),
  salespersonId: z.string().min(1).optional().nullable(),
}

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    if (sp.get('view') === 'salespersons') return ok({ salespersons: await listSalespersons() })
    if (sp.get('report') === 'salesperson') return ok(await salespersonReport(sp.get('month') ?? new Date().toISOString().slice(0, 7)))
    return ok(await crmDashboard())
  } catch (error) { return handleError(error) }
}

async function handlePost(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = await req.json()
    const action = String(body?.action ?? '')
    const who = actor?.email ?? undefined
    if (action === 'save-salesperson') {
      const p = z.object({ id: z.string().min(1).optional(), code: z.string().trim().min(2).max(20), name: z.string().trim().min(2, 'Name is required').max(80), phone: opt(z.string().trim().max(20)), email: opt(z.string().trim().email().max(120)), monthlyTarget: z.number().min(0).finite().optional(), active: z.boolean().optional() }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid salesperson')
      const row = await saveSalesperson(p.data)
      await logAudit(p.data.id ? 'UPDATE' : 'CREATE', 'Salesperson', row.id, `${row.code} ${row.name}`, who)
      return ok(row)
    }
    if (action === 'create-lead') {
      const p = z.object(leadFields).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid lead')
      const lead = await createLead({ ...p.data, createdBy: who })
      await logAudit('CREATE', 'Lead', lead.id, `${lead.leadNo} ${lead.contactName}`, who)
      return ok(lead)
    }
    if (action === 'update-lead') {
      const p = z.object({ id: z.string().min(1), ...Object.fromEntries(Object.entries(leadFields).map(([k, v]) => [k, v.optional()])), probability: z.number().int().min(0).max(100).optional() }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid lead')
      const { id, ...rest } = p.data as { id: string } & Record<string, unknown>
      return ok(await updateLead(id, rest))
    }
    if (action === 'move-lead') {
      const p = z.object({ id: z.string().min(1), status: z.enum(LEAD_STATUSES), reason: z.string().trim().max(1000).optional() }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid stage')
      const lead = await moveLead({ ...p.data, actor })
      await logAudit('UPDATE', 'Lead', p.data.id, `${lead?.leadNo} -> ${p.data.status}${p.data.reason ? `: ${p.data.reason}` : ''}`, who)
      return ok(lead)
    }
    if (action === 'add-activity') {
      const p = z.object({ leadId: z.string().min(1), type: z.enum(ACTIVITY_TYPES), notes: z.string().trim().min(2, 'Write what happened or what to do').max(2000), dueAt: day.optional().nullable(), done: z.boolean().optional() }).safeParse(body)
      if (!p.success) return fail(p.error.issues[0]?.message ?? 'Invalid activity')
      return ok(await addActivity({ ...p.data, createdBy: who }))
    }
    if (action === 'complete-activity') {
      const p = z.object({ id: z.string().min(1), outcome: z.string().trim().max(1000).optional() }).safeParse(body)
      if (!p.success) return fail('Activity id is required')
      return ok(await completeActivity(p.data))
    }
    if (action === 'convert-lead') {
      const p = z.object({ id: z.string().min(1), partyId: z.string().min(1).optional(), code: z.string().trim().max(20).optional() }).safeParse(body)
      if (!p.success) return fail('Lead id is required')
      const lead = await convertLead(p.data)
      await logAudit('UPDATE', 'Lead', p.data.id, `${lead?.leadNo} converted to customer ${lead?.party?.code}`, who)
      return ok(lead)
    }
    return fail('Unknown CRM action')
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'crm', (r) => handlePost(r))
}
