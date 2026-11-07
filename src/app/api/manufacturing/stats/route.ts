import { ok, handleError } from '@/lib/api'
import { assertCompanyAccess } from '@/lib/platform'
import { manufacturingStats } from '@/lib/manufacturing'

/** Manufacturing KPIs (projects / work orders / tasks counts). */
export async function GET() {
  try {
    await assertCompanyAccess()
    return ok(await manufacturingStats())
  } catch (e) {
    return handleError(e)
  }
}
