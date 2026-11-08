import { ok, handleError } from '@/lib/api'
import { assertCompanyAccess } from '@/lib/platform'
import { computeMrp } from '@/lib/mrp'
import { db } from '@/lib/db'

/**
 * Dry run: explode + net without saving anything. Handy for planners and for
 * the audit suite, which asserts the saved run matches a fresh calculation.
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const params = new URL(req.url).searchParams
    const asOf = params.get('asOf') ?? undefined
    const horizon = params.get('horizonDays')
    const plan = await computeMrp(db, {
      asOf: asOf || undefined,
      horizonDays: horizon ? Number(horizon) : undefined,
    })
    return ok(plan)
  } catch (e) {
    return handleError(e)
  }
}
