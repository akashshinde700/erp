import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { PLATFORM_ADMIN_EMAIL, ensurePlatformAdmin, orgLoginCount } from '@/lib/platform'

/**
 * GET /api/auth/status — login-screen facts (public, no data).
 * Minimal by design: no admin email is exposed (enumeration), no passwords,
 * no company details — only what the routing logic needs to pick a screen.
 */
export async function GET() {
  try {
    // Idempotent: guarantees the SUPER_ADMIN platform login exists on every
    // install (env credentials, or a RANDOM password printed once in the
    // server log at creation — never exposed here).
    await ensurePlatformAdmin()
    const [operating, users, demoUser, platformAdmin] = await Promise.all([
      db.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
      orgLoginCount(),
      db.orgUser.findUnique({ where: { email: 'owner@shreeforge.example.com' }, select: { id: true } }),
      db.orgUser.findUnique({ where: { email: PLATFORM_ADMIN_EMAIL }, select: { id: true } }),
    ])
    return ok({
      companyExists: !!operating,
      companyName: operating?.name ?? null,
      usersExist: users > 0,
      // Demo credentials are never advertised on a production install.
      demoHint: !!demoUser && process.env.NODE_ENV !== 'production',
      platformConfigured: !!platformAdmin,
    })
  } catch (e) {
    return handleError(e)
  }
}
