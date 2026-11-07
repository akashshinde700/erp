import { ok, handleError } from '@/lib/api'
import { assertCompanyAccess } from '@/lib/platform'
import { materialPlanReport } from '@/lib/manufacturing'

/**
 * Consolidated MRP-lite view for active project work orders.
 * Customer-owned JOBWORK_IN stock is deliberately excluded from availability.
 */
export async function GET() {
  try {
    await assertCompanyAccess()
    return ok(await materialPlanReport())
  } catch (e) {
    return handleError(e)
  }
}
