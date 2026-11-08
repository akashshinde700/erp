import { ok, handleError } from '@/lib/api'
import { assertCompanyAccess } from '@/lib/platform'
import { finiteSchedule } from '@/lib/routing'

/**
 * Finite-capacity plan for open work (read-only). Nothing is written: moving a
 * real work order is a planner action, and an accidental reload must never
 * silently re-sequence the shop floor.
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const p = new URL(req.url).searchParams
    const horizon = Number(p.get('horizonDays') ?? 120)
    if (!Number.isFinite(horizon) || horizon < 1 || horizon > 365) {
      return handleError(new Error('Planning horizon must be between 1 and 365 days'))
    }
    return ok(await finiteSchedule(p.get('from') ?? undefined, Math.trunc(horizon)))
  } catch (e) {
    return handleError(e)
  }
}
