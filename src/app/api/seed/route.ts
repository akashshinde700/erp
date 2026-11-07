import { ok, fail, handleError } from '@/lib/api'
import { seedDatabase } from '@/lib/seed'
import { seedManufacturingIfEmpty } from '@/lib/seed-manufacturing'
import { assertCompanyAccess, requirePlatformAdmin } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/seed — demo data.
 *  - plain POST: first-boot convenience. No company yet → seeds; company
 *    already exists → honest no-op (nothing is touched).
 *  - ?manufacturing=1: ADDITIVE — adds the manufacturing demo chain to the
 *    demo org when it has no employees/projects (orgs seeded before that
 *    module shipped). Nothing existing is touched; any org login may run it.
 *  - ?force=1: DESTRUCTIVE wipe + reseed — platform admin only (SUPER_ADMIN
 *    session or x-platform-key). A regular org login (even OWNER) must never
 *    be able to erase every table.
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const force = url.searchParams.get('force') === '1'
    if (url.searchParams.get('manufacturing') === '1' && !force) {
      await assertCompanyAccess()
      const res = await seedManufacturingIfEmpty()
      if (res.seeded) await logAudit('SEED', 'Database', undefined, 'manufacturing demo data added (additive)', 'setup')
      return ok(res)
    }
    if (force) {
      await requirePlatformAdmin(req)
    } else {
      await assertCompanyAccess()
    }
    const res = await seedDatabase(force)
    await logAudit('SEED', 'Database', undefined, `demo data seeded (force=${force})`, force ? 'platform-admin' : 'setup')
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
