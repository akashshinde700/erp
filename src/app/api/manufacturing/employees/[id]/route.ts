import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { updateEmployee, deleteEmployee } from '@/lib/manufacturing'

const employeeUpdateSchema = z.object({
  code: z.string().min(1).max(30).optional(),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['WORKER', 'SUPERVISOR', 'MANAGER']).optional(),
  skill: z.string().max(80).optional().nullable(),
  machineNo: z.string().max(30).optional().nullable(),
  shift: z.enum(['GENERAL', 'DAY', 'NIGHT']).optional(),
  hourlyRate: z.number().min(0).finite().max(100_000).optional(),
  phone: z.string().max(20).optional().nullable(),
  active: z.boolean().optional(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = employeeUpdateSchema.parse(await req.json())
    const emp = await updateEmployee(id, body)
    await logAudit('UPDATE', 'Employee', id, `${emp.code} — ${emp.name}`, actor?.email)
    return ok(emp)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const res = await deleteEmployee(id)
    await logAudit('DELETE', 'Employee', id, `Employee removed`, actor?.email)
    return ok(res)
  } catch (e) {
    return handleError(e)
  }
}
