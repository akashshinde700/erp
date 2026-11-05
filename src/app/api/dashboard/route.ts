import { ok, handleError } from '@/lib/api'
import { dashboardData } from '@/lib/reports'
import { assertCompanyAccess } from '@/lib/platform'

export async function GET() {
  try {
    await assertCompanyAccess()
    return ok(await dashboardData())
  } catch (e) {
    return handleError(e)
  }
}
