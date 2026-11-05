import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'

/** GET /api/auth/status — login-screen facts (public, no data). */
export async function GET() {
  try {
    const [company, users, demoUser] = await Promise.all([
      db.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
      db.orgUser.count(),
      db.orgUser.findUnique({ where: { email: 'owner@shreeforge.example.com' }, select: { id: true } }),
    ])
    return ok({
      companyExists: !!company,
      companyName: company?.name ?? null,
      usersExist: users > 0,
      demoHint: !!demoUser,
    })
  } catch (e) {
    return handleError(e)
  }
}
