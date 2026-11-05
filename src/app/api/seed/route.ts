import { ok, handleError } from '@/lib/api'
import { seedDatabase } from '@/lib/seed'

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const force = url.searchParams.get('force') === '1'
    return ok(await seedDatabase(force))
  } catch (e) {
    return handleError(e)
  }
}
