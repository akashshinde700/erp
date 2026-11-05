import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { cancelJobworkInward } from '@/lib/services'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCompanyAccess()
    const { id } = await params
    const inward = await db.jobworkInward.findUnique({
      where: { id },
      include: {
        party: true,
        items: { include: { item: true } },
        jobCards: {
          orderBy: { date: 'asc' },
          include: { processes: { include: { process: true } } },
        },
        certificates: { orderBy: { date: 'desc' } },
      },
    })
    return ok(inward)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await assertMutationAccess()
    const res = await cancelJobworkInward(id)
    await logAudit('CANCEL', 'JobworkInward', id, `${res.inwardNo} cancelled`)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
