import { handleError, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformAdmin } from '@/lib/platform'
import { createSessionToken, hashPassword, setSessionCookie } from '@/lib/auth'
import { buildSessionInfo } from '@/app/api/auth/_session'
import { NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * PATCH /api/platform/orgs/[id] — subscription actions:
 *   {action:'setPlan', planId|null}
 *   {action:'markPaid', cycle:'MONTHLY'|'YEARLY'}      (extends from max(paidUntil, now))
 *   {action:'extendTrial', days}                        (1–365, default 7)
 *   {action:'suspend'} | {action:'activate'}
 *   {action:'customize', maxItems?, maxWarehouses?, maxParties?}  (null = plan default)
 *   {action:'resetCustom'}
 *   {action:'resetLogin', email, password}              (set/replace the org's owner login)
 *   {action:'loginAs'}                                   (impersonate the org's owner — sets session cookie)
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin(req)
    const { id } = await params
    const org = await db.company.findUnique({ where: { id } })
    if (!org) return fail('Organization not found', 404)

    const schema = z.object({
      action: z.enum(['setPlan', 'markPaid', 'extendTrial', 'suspend', 'activate', 'customize', 'resetCustom', 'resetLogin', 'loginAs']),
      planId: z.string().optional().nullable(),
      cycle: z.enum(['MONTHLY', 'YEARLY']).optional(),
      days: z.number().int().min(1).max(365).optional(),
      maxItems: z.number().int().min(0).nullable().optional(),
      maxWarehouses: z.number().int().min(0).nullable().optional(),
      maxParties: z.number().int().min(0).nullable().optional(),
      email: z.string().trim().toLowerCase().email().optional(),
      password: z.string().min(6, 'Password must be at least 6 characters').max(72).optional(),
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
      case 'resetLogin': {
        if (!body.email || !body.password) return fail('resetLogin needs email and password', 400)
        const taken = await db.orgUser.findUnique({ where: { email: body.email } })
        if (taken && taken.companyId !== id) return fail('This email belongs to another organization', 409)
        if (taken) {
          await db.orgUser.update({ where: { id: taken.id }, data: { passwordHash: hashPassword(body.password) } })
        } else {
          await db.orgUser.create({
            data: { name: org.name, email: body.email, passwordHash: hashPassword(body.password), role: 'OWNER', companyId: id },
          })
        }
        details = `owner login ${body.email} ${taken ? 'password reset' : 'created'}`
        break
      }
      case 'loginAs': {
        // Impersonate the org's owner (first login): sets the httpOnly session
        // cookie and returns the session info so the console can hand the
        // browser over to that organization's workspace honestly.
        if (org.isPlatform) return fail('The platform company has no ERP workspace to open', 400)
        const target = await db.orgUser.findFirst({
          where: { companyId: id },
          orderBy: { createdAt: 'asc' }, // first login = the owner (create/bootstrap flow)
          include: { company: { include: { plan: true } } },
        })
        if (!target) return fail('This organization has no login yet — create one with “Reset pwd” first', 404)
        await db.orgUser.update({ where: { id: target.id }, data: { lastLoginAt: new Date() } })
        await logAudit('PLATFORM', 'OrgUser', target.id, `${org.name}: platform admin signed in as ${target.email}`)
        const session = await buildSessionInfo(target)
        const res: NextResponse = NextResponse.json({ success: true, data: session })
        return setSessionCookie(res, createSessionToken(target.id, target.companyId))
      }
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
    await requirePlatformAdmin(req)
    const { id } = await params
    const org = await db.company.findUnique({ where: { id }, include: { plan: true } })
    if (!org) return fail('Organization not found', 404)
    const confirmName = new URL(req.url).searchParams.get('confirmName') ?? ''
    if (confirmName !== org.name) return fail(`Type the organization name "${org.name}" exactly to confirm`, 400)

    const first = await db.company.findFirst({
      where: { isPlatform: false },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
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
