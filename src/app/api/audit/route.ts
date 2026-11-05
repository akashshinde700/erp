import { handleError, ok } from '@/lib/api'
import { db } from '@/lib/db'
import { assertCompanyAccess } from '@/lib/platform'

/**
 * GET /api/audit?entity=&action=&limit= (default 200, max 500)
 * Newest-first audit trail of every mutation.
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    const entity = sp.get('entity')
    const action = sp.get('action')
    const limit = Math.min(500, Math.max(1, Number(sp.get('limit') ?? 200)))
    const where: { entity?: string; action?: string } = {}
    if (entity) where.entity = entity
    if (action) where.action = action
    const rows = await db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit })
    const entities = await db.auditLog.groupBy({ by: ['entity'], _count: { _all: true } })
    return ok({ rows, entities: entities.map((e) => ({ entity: e.entity, count: e._count._all })) })
  } catch (e) {
    return handleError(e)
  }
}
