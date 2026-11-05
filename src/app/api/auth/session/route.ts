import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { currentSession } from '@/lib/auth'
import { buildSessionInfo } from '../_session'

/** GET /api/auth/session — current org login (null when signed out / expired). */
export async function GET() {
  try {
    const session = await currentSession()
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
