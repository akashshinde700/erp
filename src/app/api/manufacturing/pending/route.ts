import { ok, handleError } from '@/lib/api'
import { assertCompanyAccess } from '@/lib/platform'
import { pendingTasksReport } from '@/lib/manufacturing'

/** Task-wise pending report (PENDING + ASSIGNED + IN_PROGRESS, overdue flags). */
export async function GET() {
  try {
    await assertCompanyAccess()
    return ok(await pendingTasksReport())
  } catch (e) {
    return handleError(e)
  }
}
