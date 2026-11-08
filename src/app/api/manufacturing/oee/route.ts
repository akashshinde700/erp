import { ok, fail, handleError } from '@/lib/api'
import { assertCompanyAccess } from '@/lib/platform'
import { oeeReport } from '@/lib/oee'

/** OEE = availability × performance × quality, per work centre per day. */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const p = new URL(req.url).searchParams
    const from = p.get('from') ?? undefined
    const to = p.get('to') ?? undefined
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return fail('from must be YYYY-MM-DD', 400)
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return fail('to must be YYYY-MM-DD', 400)
    return ok(await oeeReport({ from, to, workCenterId: p.get('workCenterId') ?? undefined }))
  } catch (e) {
    return handleError(e)
  }
}
