import { z } from 'zod'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { handleError, ok, fail } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { createSessionToken, currentSession, setSessionCookie, verifyPassword } from '@/lib/auth'
import { PLATFORM_KEY, ensurePlatformAdmin, isSuperAdmin } from '@/lib/platform'
import { buildSessionInfo } from '@/app/api/auth/_session'

/**
 * Platform Admin authentication (SUPER_ADMIN login, like the reference SaaS):
 *  - GET              → who is signed in as platform admin (or null).
 *  - POST {email,pwd}  → admin sign-in, sets the httpOnly session cookie.
 *  - POST {key}        → legacy key validation (scripted access; no cookie).
 */
export async function GET() {
  try {
    await ensurePlatformAdmin()
    const session = await currentSession()
    if (!session) return ok({ admin: null })
    const user = await db.orgUser.findUnique({
      where: { id: session.uid },
      select: { id: true, name: true, email: true, role: true, companyId: true, company: { select: { id: true, name: true, isPlatform: true } } },
    })
    if (!isSuperAdmin(user)) return ok({ admin: null })
    return ok({ admin: { id: user!.id, name: user!.name, email: user!.email, company: user!.company.name } })
  } catch (e) {
    return handleError(e)
  }
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').optional(),
  password: z.string().min(1, 'Password is required').optional(),
  key: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    await ensurePlatformAdmin()
    const body = loginSchema.parse(await req.json())

    // Legacy key path (scripted access; never sets a session cookie).
    if (body.key !== undefined) {
      if (body.key !== PLATFORM_KEY) return fail('Invalid platform admin key', 401)
      return ok({ valid: true })
    }

    if (!body.email || !body.password) return fail('Admin email and password are required', 400)
    const user = await db.orgUser.findUnique({
      where: { email: body.email },
      include: { company: { include: { plan: true } } },
    })
    // Same error for unknown email / wrong password / wrong role — no enumeration.
    if (!user || !verifyPassword(body.password, user.passwordHash) || !isSuperAdmin(user)) {
      return fail('Invalid platform admin credentials', 401)
    }

    await db.orgUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await logAudit('PLATFORM', 'OrgUser', user.id, `${user.email} signed in to the platform console`)
    const data = await buildSessionInfo(user)
    const res = NextResponse.json({ success: true, data: { admin: data.user, session: data } })
    return setSessionCookie(res, createSessionToken(user.id, user.companyId))
  } catch (e) {
    return handleError(e)
  }
}
