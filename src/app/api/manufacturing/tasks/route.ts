import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { OPERATIONS, listTasks, createTask } from '@/lib/manufacturing'

const OPERATION_KEYS = OPERATIONS.map((o) => o.key) as [string, ...string[]]

export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    const status = sp.get('status') ?? undefined
    const workOrderId = sp.get('workOrderId') ?? undefined
    const employeeId = sp.get('employeeId') ?? undefined
    const projectId = sp.get('projectId') ?? undefined
    return ok(await listTasks({ status, workOrderId, employeeId, projectId }))
  } catch (e) {
    return handleError(e)
  }
}

const taskSchema = z.object({
  workOrderId: z.string().min(1, 'Work order is required'),
  operation: z.enum(OPERATION_KEYS, { message: 'Pick a valid operation' }),
  seq: z.number().int().min(0).max(999).default(0),
  employeeId: z.string().optional().nullable(),
  machineNo: z.string().max(30).optional().nullable(),
  plannedQty: z.number().positive('Planned quantity must be > 0').finite().max(10_000_000),
  dueDate: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = taskSchema.parse(await req.json())
    const task = await createTask(body)
    await logAudit('CREATE', 'ProductionTask', task.id, `${task.taskNo} — ${task.operation} qty ${body.plannedQty}`, actor?.email)
    return ok(task)
  } catch (e) {
    return handleError(e)
  }
}

