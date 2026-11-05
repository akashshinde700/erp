import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { fail, handleError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { burnPasswordCheck, createSessionToken, setSessionCookie, verifyPassword } from '@/lib/auth'
import { buildSessionInfo } from '../_session'
import { clearFailures, clientIp, isThrottled, recordFailure, THROTTLE_MESSAGE } from '@/lib/ratelimit'

/** POST /api/auth/login {email, password} — organization sign-in (httpOnly session cookie). */
export async function POST(req: Request) {
  try {
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email('Enter a valid email address').max(120),
        password: z.string().min(1, 'Password is required').max(72),
      })
      .parse(await req.json())

    // Brute-force damping: throttle per IP+email BEFORE touching the DB.
    const throttleKey = `${clientIp(req)}|${body.email}`
    if (isThrottled(throttleKey)) return fail(THROTTLE_MESSAGE, 429)

    const user = await db.orgUser.findUnique({
      where: { email: body.email },
      include: { company: { include: { plan: true } } },
    })
    // Same error for unknown email and wrong password (no account
    // enumeration) — and equal WORK: unknown emails burn a scrypt check so
    // the response timing cannot reveal registered accounts.
    if (!user) {
      burnPasswordCheck()
      recordFailure(throttleKey)
      return fail('Invalid email or password', 401)
    }
    if (!verifyPassword(body.password, user.passwordHash)) {
      recordFailure(throttleKey)
      return fail('Invalid email or password', 401)
    }

    clearFailures(throttleKey)
    await db.orgUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await logAudit('LOGIN', 'OrgUser', user.id, `${user.email} signed in (${user.company.name})`)

    const data = await buildSessionInfo(user)
    const res = NextResponse.json({ success: true, data })
    // Token carries the user's tokenVersion so a reset/suspension revokes it.
    return setSessionCookie(res, createSessionToken(user.id, user.companyId, user.tokenVersion))
  } catch (e) {
    return handleError(e)
  }
}
