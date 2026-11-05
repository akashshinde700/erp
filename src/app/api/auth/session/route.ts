import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { resolveSession } from '@/lib/auth'
import { buildSessionInfo } from '../_session'

/** GET /api/auth/session — current org login (null when signed out / expired / revoked). */
export async function GET() {
  try {
    // resolveSession verifies signature AND the DB (user exists, tokenVersion
    // matches) so a password reset or admin revocation signs this browser out
    // on the very next poll.
    const session = await resolveSession()
    if (!session) return ok(null)
    const user = await db.orgUser.findUnique({
      where: { id: session.uid },
      include: { company: { include: { plan: true } } },
    })
    // Deleted user / org → treat as signed out (cookie will be replaced on next login).
    if (!user) return ok(null)
    return ok(await buildSessionInfo(user))
  } catch (e) {
    return handleError(e)
  }
}
