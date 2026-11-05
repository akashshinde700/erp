import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { fail, handleError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { createSessionToken, setSessionCookie, verifyPassword } from '@/lib/auth'
import { buildSessionInfo } from '../_session'

/** POST /api/auth/login {email, password} — organization sign-in (httpOnly session cookie). */
export async function POST(req: Request) {
  try {
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email('Enter a valid email address'),
        password: z.string().min(1, 'Password is required'),
      })
      .parse(await req.json())

    const user = await db.orgUser.findUnique({
      where: { email: body.email },
      include: { company: { include: { plan: true } } },
    })
    // Same error for unknown email and wrong password (no account enumeration).
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return fail('Invalid email or password', 401)
    }

    await db.orgUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await logAudit('LOGIN', 'OrgUser', user.id, `${user.email} signed in (${user.company.name})`)

    const data = await buildSessionInfo(user)
    const res = NextResponse.json({ success: true, data })
    return setSessionCookie(res, createSessionToken(user.id, user.companyId))
  } catch (e) {
    return handleError(e)
  }
}
