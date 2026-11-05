import { handleError, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformAdmin } from '@/lib/platform'

/**
 * POST /api/backup/restore — {confirm:'RESTORE', snapshot}
 * Platform-admin gated. Typed-confirm destructive restore inside ONE
 * transaction; validates the snapshot shape before touching anything.
 * Restores OrgUser too (v2 snapshots) so a restore never empties the login
 * table — otherwise the anonymous bootstrap route would own the workspace.
 */

interface Snapshot {
  version?: number
  data?: Record<string, unknown[]>
}

export async function POST(req: Request) {
  try {
    await requirePlatformAdmin(req)
    const body = (await req.json()) as { confirm?: string; snapshot?: Snapshot }
    if (body.confirm !== 'RESTORE') return fail('Type RESTORE to confirm the destructive restore', 400)
    const snap = body.snapshot
    if (!snap || (snap.version !== 1 && snap.version !== 2) || !snap.data) {
      return fail('Invalid snapshot — export a backup first', 400)
    }

    await db.$transaction(
      async (tx) => {
        // children → parents wipe
        await tx.stockLedger.deleteMany({})
        await tx.accountLedger.deleteMany({})
        await tx.paymentAllocation.deleteMany({})
        await tx.payment.deleteMany({})
        await tx.salesInvoiceItem.deleteMany({})
        await tx.salesInvoice.deleteMany({})
        await tx.purchaseInvoiceItem.deleteMany({})
        await tx.purchaseInvoice.deleteMany({})
        await tx.jobCardProcess.deleteMany({})
        await tx.jobCard.deleteMany({})
        await tx.jobworkCertificate.deleteMany({})
        await tx.jobworkInwardItem.deleteMany({})
        await tx.jobworkInward.deleteMany({})
        await tx.partyProcessRate.deleteMany({})
        await tx.party.deleteMany({})
        await tx.item.deleteMany({})
        await tx.warehouse.deleteMany({})
        await tx.process.deleteMany({})
        await tx.counter.deleteMany({})
        await tx.auditLog.deleteMany({})
        await tx.orgUser.deleteMany({})
        await tx.company.deleteMany({})
        await tx.plan.deleteMany({})

      const d = snap.data!
      // parents → children insert
      if (d.plans?.length) await tx.plan.createMany({ data: d.plans as never })
      if (d.company?.length) await tx.company.createMany({ data: d.company as never })
      if (d.parties?.length) await tx.party.createMany({ data: d.parties as never })
      if (d.items?.length) await tx.item.createMany({ data: d.items as never })
      if (d.warehouses?.length) await tx.warehouse.createMany({ data: d.warehouses as never })
      if (d.processes?.length) await tx.process.createMany({ data: d.processes as never })
      if (d.partyProcessRates?.length) await tx.partyProcessRate.createMany({ data: d.partyProcessRates as never })
      if (d.stockLedger?.length) await tx.stockLedger.createMany({ data: d.stockLedger as never })
      if (d.accountLedger?.length) await tx.accountLedger.createMany({ data: d.accountLedger as never })
      for (const inv of (d.salesInvoices ?? []) as { items?: unknown[] }[]) {
        const { items, ...head } = inv as never as Record<string, unknown>
        await tx.salesInvoice.create({ data: head as never })
        if (Array.isArray(items) && items.length) await tx.salesInvoiceItem.createMany({ data: items as never })
      }
      for (const inv of (d.purchaseInvoices ?? []) as { items?: unknown[] }[]) {
        const { items, ...head } = inv as never as Record<string, unknown>
        await tx.purchaseInvoice.create({ data: head as never })
        if (Array.isArray(items) && items.length) await tx.purchaseInvoiceItem.createMany({ data: items as never })
      }
      for (const p of (d.payments ?? []) as { allocations?: unknown[] }[]) {
        const { allocations, ...head } = p as never as Record<string, unknown>
        await tx.payment.create({ data: head as never })
        if (Array.isArray(allocations) && allocations.length) await tx.paymentAllocation.createMany({ data: allocations as never })
      }
      for (const inw of (d.jobworkInwards ?? []) as { items?: unknown[] }[]) {
        const { items, ...head } = inw as never as Record<string, unknown>
        await tx.jobworkInward.create({ data: head as never })
        if (Array.isArray(items) && items.length) await tx.jobworkInwardItem.createMany({ data: items as never })
      }
      for (const jc of (d.jobCards ?? []) as { processes?: unknown[] }[]) {
        const { processes, ...head } = jc as never as Record<string, unknown>
        await tx.jobCard.create({ data: head as never })
        if (Array.isArray(processes) && processes.length) await tx.jobCardProcess.createMany({ data: processes as never })
      }
      if (d.certificates?.length) await tx.jobworkCertificate.createMany({ data: d.certificates as never })
      if (d.counters?.length) await tx.counter.createMany({ data: d.counters as never })
      if (d.orgUsers?.length) await tx.orgUser.createMany({ data: d.orgUsers as never })
      if (d.auditLogs?.length) await tx.auditLog.createMany({ data: d.auditLogs as never })
      },
      // Full-database restore is heavier than the 5s interactive default.
      { timeout: 60_000 }
    )
    await logAudit('BACKUP', 'Restore', undefined, 'snapshot restored (typed RESTORE confirm)')
    return ok({ restored: true })
  } catch (e) {
    return handleError(e)
  }
}
