import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { fail, handleError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { createSessionToken, hashPassword, setSessionCookie } from '@/lib/auth'
import { orgLoginCount } from '@/lib/platform'
import { buildSessionInfo } from '../_session'

/**
 * POST /api/auth/bootstrap — create the FIRST owner login for the existing
 * operating org (manual-setup path: company exists, no logins yet). Refused
 * once any login exists. Auto signs in.
 */
export async function POST(req: Request) {
  try {
    const body = z
      .object({
        name: z.string().trim().min(2, 'Enter your full name').max(80),
        email: z.string().trim().toLowerCase().email('Enter a valid email address'),
        password: z.string().min(6, 'Password must be at least 6 characters').max(72),
      })
      .parse(await req.json())

    // The operating org is the first NON-platform company (the platform
    // company is the operator's own and never receives an owner login).
    const company = await db.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } })
    if (!company) return fail('Set up a company first (no organization exists yet)', 409)

    // ORG logins only — the platform SUPER_ADMIN (operator's login) never
    // blocks the first owner bootstrap.
    const existingUsers = await orgLoginCount()
    if (existingUsers > 0) return fail('Logins already exist — sign in instead', 409)

    const emailTaken = await db.orgUser.findUnique({ where: { email: body.email } })
    if (emailTaken) return fail('This email is already registered', 409)

    const user = await db.orgUser.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: hashPassword(body.password),
        role: 'OWNER',
        companyId: company.id,
        lastLoginAt: new Date(),
      },
      include: { company: { include: { plan: true } } },
    })
    await logAudit('CREATE', 'OrgUser', user.id, `${user.email} bootstrapped as OWNER of ${company.name}`)

    const data = await buildSessionInfo(user)
    const res = NextResponse.json({ success: true, data })
    return setSessionCookie(res, createSessionToken(user.id, user.companyId))
  } catch (e) {
    return handleError(e)
  }
}
