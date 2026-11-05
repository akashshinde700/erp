import { ok, handleError } from '@/lib/api'
import { dashboardData } from '@/lib/reports'

export async function GET() {
  try {
    return ok(await dashboardData())
  } catch (e) {
    return handleError(e)
  }
}
