import { ok, handleError } from '@/lib/api'
import { assertCompanyAccess } from '@/lib/platform'
import { getMrpRun } from '@/lib/mrp'

/** Saved plan with its exploded, netted lines. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCompanyAccess()
    const { id } = await params
    return ok(await getMrpRun(id))
  } catch (e) {
    return handleError(e)
  }
}
