import { ok, handleError } from '@/lib/api'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { logAudit } from '@/lib/audit'
import { createMrpRun, listMrpRuns } from '@/lib/mrp'

/** Saved MRP snapshots (newest first). */
export async function GET() {
  try {
    await assertCompanyAccess()
    return ok(await listMrpRuns())
  } catch (e) {
    return handleError(e)
  }
}

const runSchema = z.object({
  asOf: z.string().optional().nullable(),
  horizonDays: z.number().int().min(1).max(365).optional(),
  notes: z.string().max(2000).optional().nullable(),
})

/**
 * Compute and SAVE a plan. Saving writes the snapshot only — no stock, ledger,
 * requisition or work order is created here.
 */
export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const body = runSchema.parse(await req.json().catch(() => ({})))
    const run = await createMrpRun({
      asOf: body.asOf ?? undefined,
      horizonDays: body.horizonDays,
      notes: body.notes,
      createdBy: actor?.email ?? undefined,
    })
    await logAudit(
      'CREATE',
      'MrpRun',
      run.id,
      `${run.runNo} — ${run.suggestionCount} suggestion(s), ${run.shortageItems} item(s) short (as of ${run.asOf.toISOString().slice(0, 10)}, ${run.horizonDays}d)`,
      actor?.email
    )
    return ok(run)
  } catch (e) {
    return handleError(e)
  }
}
