/**
 * ForgeERP — tenant (organisation) context.
 *
 * Every business row belongs to one organisation (Company). The active tenant
 * for a database call is resolved in this order:
 *   1. an explicit override from runAsTenant() — seeding, platform jobs, tests;
 *   2. the signed session cookie of the current request (its company id),
 *      unless that company is the platform operator's own company;
 *   3. none — platform/admin code and scripts run unscoped.
 *
 * The Prisma extension in db.ts reads this on every query, so service code
 * cannot forget a tenant filter. Authentication (token version, suspension,
 * roles) is still enforced per request by assertCompanyAccess().
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Prisma } from '@prisma/client'
import { readSessionToken, SESSION_COOKIE } from './auth'

type CompanyReader = { company: { findUnique: (args: { where: { id: string }; select: { isPlatform: true } }) => Promise<{ isPlatform: boolean } | null> } }

const override = new AsyncLocalStorage<{ companyId: string | null }>()

/** Run fn with an explicit tenant (null = deliberately unscoped). */
export function runAsTenant<T>(companyId: string | null, fn: () => Promise<T>): Promise<T> {
  return override.run({ companyId }, fn)
}

// token -> tenant id (null for platform sessions); small bounded cache so a
// request with many queries verifies the HMAC and checks the company once.
const tokenCache = new Map<string, string | null>()
const MAX_CACHE = 500

export async function resolveTenantId(reader: CompanyReader): Promise<string | null> {
  const forced = override.getStore()
  if (forced) return forced.companyId
  let token: string | undefined
  try {
    const { cookies } = await import('next/headers')
    token = (await cookies()).get(SESSION_COOKIE)?.value
  } catch {
    return null // outside a request (scripts, build): unscoped
  }
  if (!token) return null
  if (tokenCache.has(token)) return tokenCache.get(token) ?? null
  const session = readSessionToken(token)
  let tenant: string | null = null
  if (session?.cid) {
    const company = await reader.company.findUnique({ where: { id: session.cid }, select: { isPlatform: true } })
    tenant = company && !company.isPlatform ? session.cid : null
  }
  if (tokenCache.size >= MAX_CACHE) tokenCache.delete(tokenCache.keys().next().value as string)
  tokenCache.set(token, tenant)
  return tenant
}

type CompanyClient = Pick<Prisma.TransactionClient, 'company'>

/**
 * The organisation a business operation runs for. With a tenant context it is
 * that company; without one (first boot, single-organisation installs, scripts)
 * it falls back to the first non-platform company, which was the previous
 * single-tenant behaviour.
 */
export async function tenantCompany(client: CompanyClient) {
  const id = await resolveTenantId(client as unknown as CompanyReader)
  if (id) return client.company.findUnique({ where: { id } })
  return client.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } })
}

export async function tenantCompanyWithPlan(client: CompanyClient) {
  const id = await resolveTenantId(client as unknown as CompanyReader)
  if (id) return client.company.findUnique({ where: { id }, include: { plan: true } })
  return client.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' }, include: { plan: true } })
}
