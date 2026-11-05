import { handleError, ok, fail } from '@/lib/api'
import { PLATFORM_KEY } from '@/lib/platform'

/** POST /api/platform/auth {key} — validates the platform admin key. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { key?: string }
    if (!body.key || body.key !== PLATFORM_KEY) return fail('Invalid platform admin key', 401)
    return ok({ valid: true })
  } catch (e) {
    return handleError(e)
  }
}
