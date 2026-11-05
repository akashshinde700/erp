/**
 * ForgeERP — SaaS platform control plane (patterns from the erpnashilk audit,
 * re-implemented for our single-workspace runtime).
 *
 * The ERP workspace serves the FIRST company (oldest createdAt); organizations
 * created in Platform Admin are real Company rows the platform manages (plan,
 * billing, suspension). Org logins (OrgUser) gate who can use the workspace,
 * and sessions for other orgs are routed to an org portal — full per-request
 * tenant scoping stays a roadmap item, and the UI says so honestly.
 *
 * Enforcement model (single source of truth):
 *  - isPlatform company  → never blocked.
 *  - saasStatus SUSPENDED→ every business mutation returns 403.
 *  - no plan & no dates  → free forever, unlimited (default install).
 *  - paidUntil / trialEndsAt valid to END OF DAY → OK, else 403 expired.
 *  - plan limits (0 = unlimited; org override wins) checked on master create.
 */

import { db } from './db'
import { BusinessError } from './accounting'
import { currentSession } from './auth'

export const PLATFORM_KEY = process.env.PLATFORM_ADMIN_KEY ?? 'forge-admin'

export type LimitKind = 'items' | 'warehouses' | 'parties'

/**
 * Feature keys a plan can toggle — ONLY keys with real enforcement in this
 * runtime are catalogued (assertFeature gates the routes below). Plans store
 * the enabled subset as CSV on Plan.features.
 *
 *  - exportData       → Tally XML/JSON exports + e-Invoice IRP JSON downloads
 *  - advancedReports  → /api/reports (GST returns, trial balance, P&L …)
 */
export const PLAN_FEATURES = [
  { key: 'exportData', label: 'Data export', hint: 'Tally XML & e-Invoice JSON' },
  { key: 'advancedReports', label: 'Advanced reports', hint: 'GST returns, trial balance, P&L' },
] as const

export type PlanFeatureKey = (typeof PLAN_FEATURES)[number]['key']

/** Zod-usable tuple of every valid feature key. */
export const PLAN_FEATURE_KEYS = PLAN_FEATURES.map((f) => f.key) as [PlanFeatureKey, ...PlanFeatureKey[]]

/** Plan row → API shape (features CSV → array). */
export function planOut<T extends { features: string }>(plan: T): Omit<T, 'features'> & { features: string[] } {
  const { features, ...rest } = plan
  return { ...rest, features: [...planFeatures(features)] }
}

/** Parse a Plan.features CSV into a Set (missing/blank → empty). */
export function planFeatures(featuresCsv: string | null | undefined): Set<string> {
  return new Set(
    (featuresCsv ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

/**
 * Guard for plan-gated features on the OPERATING org. Throws 403 when the
 * org's plan explicitly lacks the feature. No plan (or platform org) = every
 * feature included — matches the effectiveLimits model.
 */
export async function assertFeature(feature: PlanFeatureKey): Promise<void> {
  const org = await operatingCompany()
  if (!org || org.isPlatform || !org.plan) return
  const enabled = planFeatures(org.plan.features)
  if (!enabled.has(feature)) {
    throw new BusinessError(`The ${org.plan.name} plan does not include ${feature}. Enable it in Platform Admin.`, 403)
  }
}

export function platformKeyOk(req: Request): boolean {
  const header = req.headers.get('x-platform-key') ?? ''
  if (header.length > 0 && header === PLATFORM_KEY) return true
  // Query-param form for browser downloads from the console (GET /api/backup).
  const q = new URL(req.url).searchParams.get('platformKey') ?? ''
  return q.length > 0 && q === PLATFORM_KEY
}

export function requirePlatformKey(req: Request): void {
  if (!platformKeyOk(req)) throw new BusinessError('Invalid platform admin key', 401)
}

/** First company = the operating org (single-tenant runtime). */
export function operatingCompany() {
  return db.company.findFirst({ orderBy: { createdAt: 'asc' }, include: { plan: true } })
}

function endOfDay(d: Date): Date {
  const t = new Date(d)
  t.setHours(23, 59, 59, 999)
  return t
}

export interface AccessState {
  blocked: boolean
  reason: '' | 'SUSPENDED' | 'EXPIRED_PAID' | 'EXPIRED_TRIAL'
  message: string
  state: 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED'
  paidUntil: Date | null
  trialEndsAt: Date | null
}

/** The single blocking truth for one company row (with plan prefetched). */
export function accessState(
  org: {
    isPlatform: boolean
    saasStatus: string
    paidUntil: Date | null
    trialEndsAt: Date | null
  } | null
): AccessState {
  if (!org || org.isPlatform) {
    return { blocked: false, reason: '', message: '', state: 'ACTIVE', paidUntil: org?.paidUntil ?? null, trialEndsAt: org?.trialEndsAt ?? null }
  }
  if (org.saasStatus === 'SUSPENDED') {
    return { blocked: true, reason: 'SUSPENDED', message: 'This organization is suspended — contact the platform administrator.', state: 'SUSPENDED', paidUntil: org.paidUntil, trialEndsAt: org.trialEndsAt }
  }
  const now = new Date()
  const paidOk = org.paidUntil ? org.paidUntil >= now : false
  const trialOk = org.trialEndsAt ? org.trialEndsAt >= endOfDay(now) : false
  const hasDates = org.paidUntil || org.trialEndsAt
  if (hasDates && !paidOk && !trialOk) {
    const trialOnly = !org.paidUntil
    return {
      blocked: true,
      reason: trialOnly ? 'EXPIRED_TRIAL' : 'EXPIRED_PAID',
      message: trialOnly ? 'The free trial has ended — extend it or pick a plan.' : 'The subscription has expired — renew to continue.',
      state: 'EXPIRED',
      paidUntil: org.paidUntil,
      trialEndsAt: org.trialEndsAt,
    }
  }
  return {
    blocked: false,
    reason: '',
    message: '',
    state: !paidOk && trialOk ? 'TRIAL' : 'ACTIVE',
    paidUntil: org.paidUntil,
    trialEndsAt: org.trialEndsAt,
  }
}

/** Guard for every business mutation route. Throws BusinessError(403/401). */
export async function assertCompanyAccess(): Promise<void> {
  const org = await operatingCompany()
  const st = accessState(org)
  if (st.blocked) throw new BusinessError(st.message, 403)
  // Sign-in gate: once org logins exist, mutations require a session whose
  // org IS the operating org (the workspace this deployment serves).
  const logins = await db.orgUser.count()
  if (logins > 0) {
    const session = await currentSession()
    if (!session) throw new BusinessError('Sign in to your organization first', 401)
    if (session.cid !== org?.id) {
      throw new BusinessError('Your organization has no ERP workspace on this deployment yet', 403)
    }
  }
}

/** Effective limits: org override ?? plan ?? 0 (unlimited). */
export function effectiveLimits(
  org: { maxItems: number | null; maxWarehouses: number | null; maxParties: number | null; plan: { maxItems: number; maxWarehouses: number; maxParties: number } | null } | null
): { items: number; warehouses: number; parties: number } {
  if (!org) return { items: 0, warehouses: 0, parties: 0 }
  return {
    items: org.maxItems ?? org.plan?.maxItems ?? 0,
    warehouses: org.maxWarehouses ?? org.plan?.maxWarehouses ?? 0,
    parties: org.maxParties ?? org.plan?.maxParties ?? 0,
  }
}

/** Plan-limit guard for master creation. Throws BusinessError(403). */
export async function assertLimit(kind: LimitKind, adding = 1): Promise<void> {
  const org = await operatingCompany()
  if (!org || org.isPlatform) return
  const limit = effectiveLimits(org)[kind]
  if (!limit) return // 0 = unlimited
  const used =
    kind === 'items'
      ? await db.item.count()
      : kind === 'warehouses'
        ? await db.warehouse.count()
        : await db.party.count()
  if (used + adding > limit) {
    throw new BusinessError(`Plan limit reached: ${used}/${limit} ${kind}. Upgrade the plan in Platform Admin.`, 403)
  }
}

/** Three starter plans so the console is never empty (idempotent). */
export async function ensurePlans(): Promise<void> {
  const n = await db.plan.count()
  if (n > 0) return
  await db.plan.createMany({
    data: [
      { name: 'Starter', priceMonthly: 499, priceYearly: 4990, maxItems: 500, maxWarehouses: 5, maxParties: 100 },
      { name: 'Growth', priceMonthly: 1499, priceYearly: 14990, maxItems: 5000, maxWarehouses: 20, maxParties: 1000 },
      { name: 'Enterprise', priceMonthly: 0, priceYearly: 0, maxItems: 0, maxWarehouses: 0, maxParties: 0 },
    ],
  })
}

/** Usage counts for one org id. */
export async function usageFor(companyId: string) {
  const [parties, items, warehouses, salesInvoices] = await Promise.all([
    db.party.count({ where: { /* single-tenant: global counts for the operating org */ } }),
    db.item.count(),
    db.warehouse.count(),
    db.salesInvoice.count(),
  ])
  void companyId // counts are global in the single-tenant runtime; param kept for the multi-tenant roadmap
  return { parties, items, warehouses, salesInvoices }
}
