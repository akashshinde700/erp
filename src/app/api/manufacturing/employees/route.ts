import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { listEmployees, createEmployee } from '@/lib/manufacturing'

export async function GET() {
  try {
    await assertCompanyAccess()
    return ok(await listEmployees())
  } catch (e) {
    return handleError(e)
  }
}

const employeeSchema = z.object({
  code: z.string().min(1, 'Code is required').max(30),
  name: z.string().min(1, 'Name is required').max(120),
  role: z.enum(['WORKER', 'SUPERVISOR', 'MANAGER']).default('WORKER'),
  skill: z.string().max(80).optional().nullable(),
  machineNo: z.string().max(30).optional().nullable(),
  shift: z.enum(['GENERAL', 'DAY', 'NIGHT']).default('GENERAL'),
  hourlyRate: z.number().min(0).finite().max(100_000).default(0),
  phone: z.string().max(20).optional().nullable(),
  active: z.boolean().default(true),
})

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = employeeSchema.parse(await req.json())
    const emp = await createEmployee(body)
    await logAudit('CREATE', 'Employee', emp.id, `${emp.code} — ${emp.name}`, actor?.email)
    return ok(emp)
  } catch (e) {
    return handleError(e)
  }
}
