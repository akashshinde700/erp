import { handleError, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformAdmin, ensurePlans } from '@/lib/platform'
import { hashPassword } from '@/lib/auth'
import { z } from 'zod'

/**
 * GET /api/platform/orgs — customer organizations (the platform company is
 *                              never listed or billed) with plan, limits, usage, state.
 * POST /api/platform/orgs — create organization (Company row + plan + trial
 *                           + optional owner login so that org can sign in).
 */
export async function GET(req: Request) {
  try {
    await requirePlatformAdmin(req)
    await ensurePlans()
    const orgs = await db.company.findMany({
      where: { isPlatform: false },
      orderBy: { createdAt: 'asc' },
      include: { plan: true, users: { orderBy: { createdAt: 'asc' }, select: { id: true, email: true } } },
    })
    const [parties, items, warehouses, salesInvoices] = await Promise.all([
      db.party.count(),
      db.item.count(),
      db.warehouse.count(),
      db.salesInvoice.count(),
    ])
    // Single-workspace runtime: usage is global; attached to the operating (first) org.
    const rows = orgs.map((org, idx) => ({
      id: org.id,
      name: org.name,
      gstin: org.gstin,
      city: org.city,
      email: org.email,
      isPlatform: org.isPlatform,
      operating: idx === 0,
      ownerEmail: org.users[0]?.email ?? null,
      userCount: org.users.length,
      plan: org.plan ? { id: org.plan.id, name: org.plan.name, priceMonthly: org.plan.priceMonthly } : null,
      customized: org.maxItems !== null || org.maxWarehouses !== null || org.maxParties !== null,
      limits: {
        items: org.maxItems ?? org.plan?.maxItems ?? 0,
        warehouses: org.maxWarehouses ?? org.plan?.maxWarehouses ?? 0,
        parties: org.maxParties ?? org.plan?.maxParties ?? 0,
      },
      usage: idx === 0 ? { parties, items, warehouses, salesInvoices } : { parties: 0, items: 0, warehouses: 0, salesInvoices: 0 },
      saasStatus: org.saasStatus,
      billingCycle: org.billingCycle,
      paidUntil: org.paidUntil,
      trialEndsAt: org.trialEndsAt,
      createdAt: org.createdAt,
    }))
    const active = rows.filter((r) => r.saasStatus === 'ACTIVE').length
    const suspended = rows.filter((r) => r.saasStatus === 'SUSPENDED').length
    const mrr = rows.filter((r) => r.saasStatus === 'ACTIVE' && r.plan).reduce((s, r) => s + (r.plan?.priceMonthly ?? 0), 0)
    return ok({ orgs: rows, stats: { total: rows.length, active, suspended, mrr, parties, items, warehouses, salesInvoices } })
  } catch (e) {
    return handleError(e)
  }
}

const createSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(80),
  gstin: z.string().length(15, 'GSTIN must be 15 characters').optional().or(z.literal('')),
  city: z.string().max(60).optional(),
  email: z.string().max(120).optional(),
  planId: z.string().optional().nullable(),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  trialDays: z.number().int().min(0).max(365).default(14),
  // Owner login (optional): lets this organization sign in on the login screen.
  ownerName: z.string().trim().min(2, 'Owner name must be at least 2 characters').max(80).optional().or(z.literal('')),
  ownerEmail: z.string().trim().toLowerCase().email('Enter a valid owner email').optional().or(z.literal('')),
  ownerPassword: z.string().min(6, 'Owner password must be at least 6 characters').max(72).optional().or(z.literal('')),
})

export async function POST(req: Request) {
  try {
    await requirePlatformAdmin(req)
    const body = createSchema.parse(await req.json())
    if ((body.ownerName || body.ownerEmail || body.ownerPassword) && !(body.ownerName && body.ownerEmail && body.ownerPassword)) {
      return fail('Owner login needs all three: name, email and password', 400)
    }
    const exists = await db.company.findFirst({ where: { name: body.name } })
    if (exists) return fail('An organization with this name already exists', 409)
    if (body.ownerEmail) {
      const emailTaken = await db.orgUser.findUnique({ where: { email: body.ownerEmail } })
      if (emailTaken) return fail('A login with this owner email already exists', 409)
    }
    let plan = null
    if (body.planId) {
      plan = await db.plan.findUnique({ where: { id: body.planId } })
      if (!plan) return fail('Plan not found', 404)
    }
    const org = await db.company.create({
      data: {
        name: body.name,
        gstin: body.gstin || null,
        city: body.city || null,
        email: body.email || null,
        planId: plan?.id ?? null,
        billingCycle: body.billingCycle,
        trialEndsAt: body.trialDays > 0 ? new Date(Date.now() + body.trialDays * 86400000) : null,
      },
    })
    if (body.ownerEmail && body.ownerPassword && body.ownerName) {
      await db.orgUser.create({
        data: {
          name: body.ownerName,
          email: body.ownerEmail,
          passwordHash: hashPassword(body.ownerPassword),
          role: 'OWNER',
          companyId: org.id,
        },
      })
    }
    await logAudit(
      'CREATE',
      'Company',
      org.id,
      `${org.name} created (plan: ${plan?.name ?? 'none'}, trial ${body.trialDays}d${body.ownerEmail ? `, owner login ${body.ownerEmail}` : ''})`
    )
    return ok(org)
  } catch (e) {
    return handleError(e)
  }
}
