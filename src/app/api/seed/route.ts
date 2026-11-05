import { ok, handleError } from '@/lib/api'
import { seedDatabase } from '@/lib/seed'
import { assertCompanyAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const force = url.searchParams.get('force') === '1'
    await assertCompanyAccess()
    const res = await seedDatabase(force)
    await logAudit('SEED', 'Database', undefined, `demo data seeded (force=${force})`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
