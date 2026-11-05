import { handleError, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformKey } from '@/lib/platform'
import { z } from 'zod'

/**
 * PATCH /api/platform/orgs/[id] — subscription actions:
 *   {action:'setPlan', planId|null}
 *   {action:'markPaid', cycle:'MONTHLY'|'YEARLY'}      (extends from max(paidUntil, now))
 *   {action:'extendTrial', days}                        (1–365, default 7)
 *   {action:'suspend'} | {action:'activate'}
 *   {action:'customize', maxItems?, maxWarehouses?, maxParties?}  (null = plan default)
 *   {action:'resetCustom'}
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requirePlatformKey(req)
    const { id } = await params
    const org = await db.company.findUnique({ where: { id } })
    if (!org) return fail('Organization not found', 404)

    const schema = z.object({
      action: z.enum(['setPlan', 'markPaid', 'extendTrial', 'suspend', 'activate', 'customize', 'resetCustom']),
      planId: z.string().optional().nullable(),
      cycle: z.enum(['MONTHLY', 'YEARLY']).optional(),
      days: z.number().int().min(1).max(365).optional(),
      maxItems: z.number().int().min(0).nullable().optional(),
      maxWarehouses: z.number().int().min(0).nullable().optional(),
      maxParties: z.number().int().min(0).nullable().optional(),
    })
    const body = schema.parse(await req.json())

    let details = ''
    switch (body.action) {
      case 'setPlan': {
        let planName = 'none (unlimited)'
        if (body.planId) {
          const plan = await db.plan.findUnique({ where: { id: body.planId } })
          if (!plan) return fail('Plan not found', 404)
          planName = plan.name
        }
        await db.company.update({ where: { id }, data: { planId: body.planId ?? null } })
        details = `plan set to ${planName}`
        break
      }
      case 'markPaid': {
        const cycle = body.cycle ?? 'MONTHLY'
        const base = org.paidUntil && org.paidUntil > new Date() ? org.paidUntil : new Date()
        const paidUntil = new Date(base)
        if (cycle === 'MONTHLY') paidUntil.setMonth(paidUntil.getMonth() + 1)
        else paidUntil.setFullYear(paidUntil.getFullYear() + 1)
        await db.company.update({ where: { id }, data: { paidUntil, saasStatus: 'ACTIVE', billingCycle: cycle } })
        details = `marked paid (${cycle}) until ${paidUntil.toISOString().slice(0, 10)}`
        break
      }
      case 'extendTrial': {
        const days = body.days ?? 7
        const base = org.trialEndsAt && org.trialEndsAt > new Date() ? org.trialEndsAt : new Date()
        const trialEndsAt = new Date(base.getTime() + days * 86400000)
        await db.company.update({ where: { id }, data: { trialEndsAt } })
        details = `trial extended +${days}d → ${trialEndsAt.toISOString().slice(0, 10)}`
        break
      }
      case 'suspend':
        await db.company.update({ where: { id }, data: { saasStatus: 'SUSPENDED' } })
        details = 'suspended — business mutations blocked'
        break
      case 'activate':
        await db.company.update({ where: { id }, data: { saasStatus: 'ACTIVE' } })
        details = 'activated'
        break
      case 'customize':
        await db.company.update({
          where: { id },
          data: {
            maxItems: body.maxItems ?? null,
            maxWarehouses: body.maxWarehouses ?? null,
            maxParties: body.maxParties ?? null,
          },
        })
        details = `custom limits: items=${body.maxItems ?? 'plan'}, warehouses=${body.maxWarehouses ?? 'plan'}, parties=${body.maxParties ?? 'plan'}`
        break
      case 'resetCustom':
        await db.company.update({ where: { id }, data: { maxItems: null, maxWarehouses: null, maxParties: null } })
        details = 'custom limits removed (plan defaults apply)'
        break
    }

    await logAudit('PLATFORM', 'Company', id, `${org.name}: ${details}`)
    const fresh = await db.company.findUnique({ where: { id }, include: { plan: true } })
    return ok(fresh)
  } catch (e) {
    return handleError(e)
  }
}

/** DELETE /api/platform/orgs/[id]?confirmName=<exact name> — typed-confirm destructive. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requirePlatformKey(req)
    const { id } = await params
    const org = await db.company.findUnique({ where: { id }, include: { plan: true } })
    if (!org) return fail('Organization not found', 404)
    const confirmName = new URL(req.url).searchParams.get('confirmName') ?? ''
    if (confirmName !== org.name) return fail(`Type the organization name "${org.name}" exactly to confirm`, 400)

    const first = await db.company.findFirst({ orderBy: { createdAt: 'asc' } })
    if (first?.id === org.id) {
      // Operating org = the whole install: wipe everything, children before parents.
      await db.stockLedger.deleteMany({})
      await db.accountLedger.deleteMany({})
      await db.paymentAllocation.deleteMany({})
      await db.payment.deleteMany({})
      await db.salesInvoiceItem.deleteMany({})
      await db.salesInvoice.deleteMany({})
      await db.purchaseInvoiceItem.deleteMany({})
      await db.purchaseInvoice.deleteMany({})
      await db.jobCardProcess.deleteMany({})
      await db.jobCard.deleteMany({})
      await db.jobworkCertificate.deleteMany({})
      await db.jobworkInwardItem.deleteMany({})
      await db.jobworkInward.deleteMany({})
      await db.partyProcessRate.deleteMany({})
      await db.party.deleteMany({})
      await db.item.deleteMany({})
      await db.warehouse.deleteMany({})
      await db.process.deleteMany({})
      await db.counter.deleteMany({})
    }
    // Non-operating orgs own no business rows in the single-tenant runtime —
    // removing the Company row is all that is needed.
    await db.company.delete({ where: { id } })
    await logAudit('PLATFORM', 'Company', id, `${org.name} deleted${first?.id === org.id ? ' with ALL business data (operating org)' : ''} (confirmed by name)`)
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
