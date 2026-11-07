import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { listProjects, createProject } from '@/lib/manufacturing'

export async function GET() {
  try {
    await assertCompanyAccess()
    return ok(await listProjects())
  } catch (e) {
    return handleError(e)
  }
}

const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(160),
  partyId: z.string().min(1, 'Customer is required'),
  manager: z.string().max(120).optional().nullable(),
  location: z.string().max(160).optional().nullable(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().optional().nullable(),
  budget: z.number().min(0).finite().max(1_000_000_000).default(0),
  documents: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = projectSchema.parse(await req.json())
    const p = await createProject(body)
    await logAudit('CREATE', 'Project', p.id, `${p.projectNo} — ${p.name}`, actor?.email)
    return ok(p)
  } catch (e) {
    return handleError(e)
  }
}
