import { z } from 'zod'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { handleError, ok, fail } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { burnPasswordCheck, createSessionToken, currentSession, setSessionCookie, verifyPassword } from '@/lib/auth'
import { PLATFORM_KEY, ensurePlatformAdmin, isSuperAdmin } from '@/lib/platform'
import { buildSessionInfo } from '@/app/api/auth/_session'
import { clearFailures, clientIp, isThrottled, recordFailure, THROTTLE_MESSAGE } from '@/lib/ratelimit'

/**
 * Platform Admin authentication (SUPER_ADMIN login, like the reference SaaS):
 *  - GET              → who is signed in as platform admin (or null).
 *  - POST {email,pwd}  → admin sign-in, sets the httpOnly session cookie.
 *  - POST {key}        → key validation for scripted access (no cookie). The
 *                       key is the strong per-install value (header-grade) —
 *                       never a public default.
 */
export async function GET() {
  try {
    await ensurePlatformAdmin()
    const session = await currentSession()
    if (!session) return ok({ admin: null })
    const user = await db.orgUser.findUnique({
      where: { id: session.uid },
      select: { id: true, name: true, email: true, role: true, tokenVersion: true, companyId: true, company: { select: { id: true, name: true, isPlatform: true } } },
    })
    if (!user) return ok({ admin: null })
    if ((session.tv ?? 0) !== user.tokenVersion) return ok({ admin: null })
    if (!isSuperAdmin(user)) return ok({ admin: null })
    return ok({ admin: { id: user.id, name: user.name, email: user.email, company: user.company.name } })
  } catch (e) {
    return handleError(e)
  }
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(120).optional(),
  password: z.string().min(1, 'Password is required').max(72).optional(),
  key: z.string().max(200).optional(),
})

export async function POST(req: Request) {
  try {
    await ensurePlatformAdmin()
    const body = loginSchema.parse(await req.json())

    // Key path (scripted access; never sets a session cookie). Constant-work:
    // an unknown key burns the same scrypt cost as a wrong password below.
    if (body.key !== undefined) {
      if (body.key !== PLATFORM_KEY()) {
        burnPasswordCheck()
        return fail('Invalid platform admin key', 401)
      }
      return ok({ valid: true })
    }

    if (!body.email || !body.password) return fail('Admin email and password are required', 400)

    // Brute-force damping for the console login too.
    const throttleKey = `platform|${clientIp(req)}|${body.email}`
    if (isThrottled(throttleKey)) return fail(THROTTLE_MESSAGE, 429)

    const user = await db.orgUser.findUnique({
      where: { email: body.email },
      include: { company: { include: { plan: true } } },
    })
    // Same error for unknown email / wrong password / wrong role — no
    // enumeration, and unknown emails burn a scrypt check for equal timing.
    if (!user) {
      burnPasswordCheck()
      recordFailure(throttleKey)
      return fail('Invalid platform admin credentials', 401)
    }
    if (!verifyPassword(body.password, user.passwordHash) || !isSuperAdmin(user)) {
      recordFailure(throttleKey)
      return fail('Invalid platform admin credentials', 401)
    }

    clearFailures(throttleKey)
    await db.orgUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await logAudit('PLATFORM', 'OrgUser', user.id, `${user.email} signed in to the platform console`)
    const data = await buildSessionInfo(user)
    const res = NextResponse.json({ success: true, data: { admin: data.user, session: data } })
    return setSessionCookie(res, createSessionToken(user.id, user.companyId, user.tokenVersion))
  } catch (e) {
    return handleError(e)
  }
}
