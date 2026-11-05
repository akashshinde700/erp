import { NextResponse } from 'next/server'
import { handleError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { clearSessionCookie, currentSession } from '@/lib/auth'
import { db } from '@/lib/db'

/** POST /api/auth/logout — clear the session cookie. */
export async function POST() {
  try {
    const session = await currentSession()
    if (session) {
      const user = await db.orgUser.findUnique({ where: { id: session.uid } })
      if (user) await logAudit('LOGOUT', 'OrgUser', user.id, `${user.email} signed out`)
    }
    const res = NextResponse.json({ success: true, data: null })
    return clearSessionCookie(res)
  } catch (e) {
    return handleError(e)
  }
}
