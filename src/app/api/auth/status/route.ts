import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { PLATFORM_ADMIN_EMAIL, ensurePlatformAdmin } from '@/lib/platform'

/** GET /api/auth/status — login-screen facts (public, no data). */
export async function GET() {
  try {
    // Idempotent: guarantees the SUPER_ADMIN platform login exists on every
    // install (demo default, or PLATFORM_ADMIN_EMAIL/PASSWORD env overrides).
    await ensurePlatformAdmin()
    const [company, users, demoUser, platformAdmin] = await Promise.all([
      db.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
      db.orgUser.count(),
      db.orgUser.findUnique({ where: { email: 'owner@shreeforge.example.com' }, select: { id: true } }),
      db.orgUser.findUnique({ where: { email: PLATFORM_ADMIN_EMAIL }, select: { email: true } }),
    ])
    return ok({
      companyExists: !!company,
      companyName: company?.name ?? null,
      usersExist: users > 0,
      demoHint: !!demoUser,
      platformAdminEmail: platformAdmin?.email ?? null,
    })
  } catch (e) {
    return handleError(e)
  }
}
