import { ok, fail, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { assignTask, startTask, completeTask, cancelTask } from '@/lib/manufacturing'

const assignSchema = z.object({
  action: z.literal('assign'),
  employeeId: z.string().min(1, 'Pick a worker'),
  machineNo: z.string().max(30).optional().nullable(),
  dueDate: z.string().optional().nullable(),
})

const startSchema = z.object({ action: z.literal('start') })

const completeSchema = z.object({
  action: z.literal('complete'),
  actualQty: z.number().positive('Actual quantity must be > 0').finite().max(10_000_000),
  rejectionQty: z.number().min(0).finite().max(10_000_000).default(0),
  hours: z.number().min(0).finite().max(720).default(0),
  labourRate: z.number().min(0).finite().max(100_000).optional(),
  materialItemId: z.string().optional().nullable(),
  materialQty: z.number().min(0).finite().max(10_000_000).default(0),
  notes: z.string().max(1000).optional().nullable(),
  completedAt: z.string().optional(),
})

const cancelSchema = z.object({ action: z.literal('cancel') })

const bodySchema = z.union([assignSchema, startSchema, completeSchema, cancelSchema])

/**
 * The production-task lifecycle endpoint:
 * assign → start → complete (material consumption posts to the stock ledger
 * inside the same transaction) · cancel (only before completion).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const body = bodySchema.parse(await req.json())

    if (body.action === 'assign') {
      const task = await assignTask(id, body)
      await logAudit('UPDATE', 'ProductionTask', id, `${task.taskNo} assigned`, actor?.email)
      return ok(task)
    }
    if (body.action === 'start') {
      const task = await startTask(id)
      await logAudit('POST', 'ProductionTask', id, `${task.taskNo} started`, actor?.email)
      return ok(task)
    }
    if (body.action === 'complete') {
      const task = await completeTask(id, body)
      await logAudit(
        'POST',
        'ProductionTask',
        id,
        `${task.taskNo} COMPLETED — qty ${task.actualQty}${task.rejectionQty ? `, rej ${task.rejectionQty}` : ''}, labour ₹${task.labourCost}, material ₹${task.materialCost}`,
        actor?.email
      )
      return ok(task)
    }
    if (body.action === 'cancel') {
      const task = await cancelTask(id)
      await logAudit('CANCEL', 'ProductionTask', id, `${task.taskNo} cancelled`, actor?.email)
      return ok(task)
    }
    return fail('Unknown action', 400)
  } catch (e) {
    return handleError(e)
  }
}
