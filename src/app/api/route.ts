import { ok, fail, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { assertCompanyAccess } from '@/lib/platform'

/**
 * GET /api — lightweight health/module probe.
 * Company identity is included only for an authenticated operating-org session
 * (it is business data, not public info); unauthenticated callers get the app
 * identity alone. Errors are handled like every other route.
 */
export async function GET() {
  try {
    let company: { name: string; gstin: string | null } | null = null
    try {
      const access = await assertCompanyAccess()
      if (access) {
        const org = await db.company.findFirst({ where: { isPlatform: false }, select: { name: true, gstin: true } })
        company = org ? { name: org.name, gstin: org.gstin } : null
      }
    } catch {
      // unauthenticated / suspended org → keep the probe public and anonymous
    }
    return ok({
      app: 'ForgeERP',
      status: 'running',
      company: company?.name ?? null,
      modules: ['dashboard', 'sales', 'purchase', 'inventory', 'jobwork', 'manufacturing', 'accounting', 'reports', 'masters', 'docs'],
    })
  } catch (e) {
    return handleError(e)
  }
}

export const dynamic = 'force-dynamic'
