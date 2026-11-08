import { ok, fail, handleError } from '@/lib/api'
import { assertCompanyAccess } from '@/lib/platform'
import { bomWhereUsed } from '@/lib/manufacturing'

/** Where-used: every live BOM (any revision) that consumes this item. */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const itemId = new URL(req.url).searchParams.get('itemId')
    if (!itemId) return fail('itemId is required', 400)
    return ok(await bomWhereUsed(itemId))
  } catch (e) {
    return handleError(e)
  }
}
