import { z } from 'zod'
import { withIdempotency } from '@/lib/idempotency'
import { fail, handleError, ok } from '@/lib/api'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { recallLot, traceabilityDashboard } from '@/lib/traceability'

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    const limit = Number(sp.get('limit') ?? '') || undefined
    const lots = await traceabilityDashboard({ q: sp.get('q') ?? undefined, limit })
    return new Response(JSON.stringify({ success: true, data: lots }), { headers: { 'Content-Type': 'application/json', 'X-Total-Count': String(lots.total) } })
  } catch (error) { return handleError(error) }
}
async function handlePost(req: Request) {
  try {
    await assertMutationAccess(); const body = await req.json()
    if (body.action === 'recall') { const parsed = z.object({ id: z.string().min(1), reason: z.string().trim().min(1) }).safeParse(body); if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid recall'); return ok(await recallLot(parsed.data.id, parsed.data.reason)) }
    return fail('Unknown traceability action')
  } catch (error) { return handleError(error) }
}

export async function POST(req: Request) {
  return withIdempotency(req, 'traceability', (r) => handlePost(r))
}
