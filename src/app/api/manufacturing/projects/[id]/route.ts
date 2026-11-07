import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { getProjectDetail, updateProject } from '@/lib/manufacturing'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCompanyAccess()
    const { id } = await params
    return ok(await getProjectDetail(id))
  } catch (e) {
    return handleError(e)
  }
}

const projectUpdateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  manager: z.string().max(120).optional().nullable(),
  location: z.string().max(160).optional().nullable(),
  startDate: z.string().optional(),
  endDate: z.string().optional().nullable(),
  budget: z.number().min(0).finite().max(1_000_000_000).optional(),
  documents: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = projectUpdateSchema.parse(await req.json())
    const p = await updateProject(id, body)
    await logAudit('UPDATE', 'Project', id, `${p.projectNo} — ${p.name}`, actor?.email)
    return ok(p)
  } catch (e) {
    return handleError(e)
  }
}
