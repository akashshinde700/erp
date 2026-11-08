import { handleError, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformAdmin } from '@/lib/platform'
import { runAsTenant } from '@/lib/tenant'
import { EARLY_RESTORE_MODELS, WORKFLOW_MODELS_CHILDREN_FIRST, WORKFLOW_MODELS_PARENTS_FIRST, delegate } from '@/lib/backup-tables'

/**
 * POST /api/backup/restore — {confirm:'RESTORE', snapshot}
 * Platform-admin gated. Typed-confirm destructive restore inside ONE
 * transaction; validates the snapshot shape before touching anything.
 *
 * v3 snapshots round-trip EVERY table (including manufacturing + platform
 * console). v1/v2 snapshots predate those tables: restoring one into an
 * install that has production history is REFUSED rather than silently
 * erasing it (the old restore also failed on FK constraints).
 * v4 snapshots add the workflow tables (data.workflow); a v3 snapshot is
 * refused the same way when the install already has workflow rows.
 */

interface Snapshot {
  version?: number
  data?: Record<string, unknown[]> & { workflow?: Record<string, unknown[]> }
}

export async function POST(req: Request) {
  try {
    await requirePlatformAdmin(req)
    const body = (await req.json()) as { confirm?: string; snapshot?: Snapshot }
    if (body.confirm !== 'RESTORE') return fail('Type RESTORE to confirm the destructive restore', 400)
    const snap = body.snapshot
    if (!snap || ![1, 2, 3, 4, 5].includes(snap.version ?? 0) || !snap.data) {
      return fail('Invalid snapshot — export a backup first', 400)
    }
    // A restore that would leave ZERO org logins re-opens the anonymous
    // first-boot window on every business route (assertCompanyAccess returns
    // null when orgLoginCount()==0) — anyone could then read/write all data
    // and re-run the owner bootstrap. Refuse it instead.
    if (!snap.data.orgUsers?.length) {
      return fail(
        'Snapshot contains no organization logins — restoring it would re-open anonymous access. Include orgUsers in the backup or re-bootstrap after restore.',
        400
      )
    }

    if ((snap.version ?? 1) < 3) {
      const hasManufacturingArrays =
        Array.isArray(snap.data.employees) || Array.isArray(snap.data.projects) ||
        Array.isArray(snap.data.boms) || Array.isArray(snap.data.workOrders) ||
        Array.isArray(snap.data.productionTasks)
      if (!hasManufacturingArrays) {
        const [employees, projects, boms, workOrders, tasks] = await Promise.all([
          db.employee.count(), db.project.count(), db.bom.count(), db.workOrder.count(), db.productionTask.count(),
        ])
        if (employees + projects + boms + workOrders + tasks > 0) {
          return fail(
            `This is a v${snap.version} snapshot from before manufacturing tables existed. Restoring it would permanently erase ${projects} project(s), ${workOrders} work order(s) and ${tasks} production task(s). Download a fresh backup (v3) and restore that instead.`,
            400
          )
        }
      }
    }

    if ((snap.version ?? 1) < 4 && !snap.data.workflow) {
      const counts = await Promise.all(WORKFLOW_MODELS_CHILDREN_FIRST.map((model) => delegate(db, model).count()))
      const existing = counts.reduce((sum, n) => sum + n, 0)
      if (existing > 0) {
        return fail(
          `This is a v${snap.version} snapshot from before the procurement / quote-to-cash / QC / traceability tables existed. Restoring it would permanently erase ${existing} workflow row(s). Download a fresh backup (v4) and restore that instead.`,
          400
        )
      }
    }

    await db.$transaction(
      async (tx) => {
        // ---- children → parents wipe (FK-safe, full schema) ----
        // Workflow tables first: they reference payments, work orders, items,
        // parties and warehouses (order from src/lib/backup-tables.ts).
        await tx.idempotencyKey.deleteMany({}) // operational cache, never restored
        for (const model of WORKFLOW_MODELS_CHILDREN_FIRST) await delegate(tx, model).deleteMany({})
        await tx.paymentAllocation.deleteMany({})
        await tx.jobCardProcess.deleteMany({})
        await tx.jobworkCertificate.deleteMany({})
        await tx.jobCard.deleteMany({})
        await tx.jobworkInwardItem.deleteMany({})
        await tx.jobworkInward.deleteMany({})
        await tx.productionTask.deleteMany({})
        await tx.workOrderLine.deleteMany({})
        await tx.workOrder.deleteMany({})
        await tx.bomItem.deleteMany({})
        await tx.bom.deleteMany({})
        await tx.project.deleteMany({})
        await tx.employee.deleteMany({})
        await tx.salesInvoiceItem.deleteMany({})
        await tx.salesInvoice.deleteMany({})
        await tx.purchaseInvoiceItem.deleteMany({})
        await tx.purchaseInvoice.deleteMany({})
        await tx.stockLedger.deleteMany({})
        await tx.accountLedger.deleteMany({})
        await tx.payment.deleteMany({})
        await tx.partyProcessRate.deleteMany({})
        await tx.party.deleteMany({})
        await tx.item.deleteMany({})
        await tx.warehouse.deleteMany({})
        await tx.process.deleteMany({})
        await tx.counter.deleteMany({})
        await tx.auditLog.deleteMany({})
        await tx.platformInquiryFollowUp.deleteMany({})
        await tx.platformInquiry.deleteMany({})
        await tx.platformBlogPost.deleteMany({})
        await tx.orgUser.deleteMany({})
        await tx.company.deleteMany({})
        await tx.plan.deleteMany({})

        const d = snap.data!
        // ---- parents → children insert ----
        if (d.plans?.length) await tx.plan.createMany({ data: d.plans as never })
        if (d.company?.length) await tx.company.createMany({ data: d.company as never })

        // Snapshots before v5 predate tenant isolation: their rows have no
        // companyId and belong to the single organisation of that install, so
        // they are inserted as that organisation (the tenant extension fills
        // companyId) and its document counters get the organisation prefix.
        const companies = (d.company ?? []) as { id: string; isPlatform?: boolean; createdAt?: string }[]
        const legacyOrg = (snap.version ?? 1) < 5
          ? companies.filter((c) => !c.isPlatform).sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))[0]?.id ?? null
          : null
        if (legacyOrg && d.counters?.length) {
          d.counters = (d.counters as { key: string; value: number }[]).map((c) => (c.key.includes(':') ? c : { ...c, key: `${legacyOrg}:${c.key}` }))
        }
        const insertBusinessRows = async () => {
        if (d.parties?.length) await tx.party.createMany({ data: d.parties as never })
        if (d.items?.length) await tx.item.createMany({ data: d.items as never })
        if (d.warehouses?.length) await tx.warehouse.createMany({ data: d.warehouses as never })
        if (d.processes?.length) await tx.process.createMany({ data: d.processes as never })
        if (d.partyProcessRates?.length) await tx.partyProcessRate.createMany({ data: d.partyProcessRates as never })
        if (d.stockLedger?.length) await tx.stockLedger.createMany({ data: d.stockLedger as never })
        if (d.accountLedger?.length) await tx.accountLedger.createMany({ data: d.accountLedger as never })
        for (const model of EARLY_RESTORE_MODELS) {
          const rows = (d.workflow ?? {})[model]
          if (Array.isArray(rows) && rows.length) await delegate(tx, model).createMany({ data: rows })
        }

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

        const insertedProcessIds = new Set<string>()
        for (const jc of (d.jobCards ?? []) as { processes?: { id?: string }[] }[]) {
          const { processes, ...head } = jc as never as Record<string, unknown>
          await tx.jobCard.create({ data: head as never })
          if (Array.isArray(processes) && processes.length) {
            await tx.jobCardProcess.createMany({ data: processes as never })
            for (const p of processes) if (p.id) insertedProcessIds.add(p.id)
          }
        }
        // Legacy snapshots may carry job card rows only in the flat table.
        const flatProcesses = ((d.jobCardProcesses ?? []) as { id?: string }[]).filter((p) => !p.id || !insertedProcessIds.has(p.id))
        if (flatProcesses.length) await tx.jobCardProcess.createMany({ data: flatProcesses as never })
        if (d.certificates?.length) await tx.jobworkCertificate.createMany({ data: d.certificates as never })

        // ---- manufacturing chain (v3) ----
        if (d.employees?.length) await tx.employee.createMany({ data: d.employees as never })
        if (d.projects?.length) await tx.project.createMany({ data: d.projects as never })
        for (const b of (d.boms ?? []) as { items?: unknown[] }[]) {
          const { items, ...head } = b as never as Record<string, unknown>
          await tx.bom.create({ data: head as never })
          if (Array.isArray(items) && items.length) await tx.bomItem.createMany({ data: items as never })
        }
        for (const w of (d.workOrders ?? []) as { lines?: unknown[] }[]) {
          const { lines, ...head } = w as never as Record<string, unknown>
          await tx.workOrder.create({ data: head as never })
          if (Array.isArray(lines) && lines.length) await tx.workOrderLine.createMany({ data: lines as never })
        }
        if (d.productionTasks?.length) await tx.productionTask.createMany({ data: d.productionTasks as never })

        // ---- platform console (v3) ----
        for (const iq of (d.platformInquiries ?? []) as { followUps?: unknown[] }[]) {
          const { followUps, ...head } = iq as never as Record<string, unknown>
          await tx.platformInquiry.create({ data: head as never })
          if (Array.isArray(followUps) && followUps.length) await tx.platformInquiryFollowUp.createMany({ data: followUps as never })
        }
        if (d.platformBlogPosts?.length) await tx.platformBlogPost.createMany({ data: d.platformBlogPosts as never })

        // ---- workflow tables (v4), parents → children; after every legacy
        // parent (company, parties, items, warehouses, payments, work orders) ----
        const workflow = d.workflow ?? {}
        for (const model of WORKFLOW_MODELS_PARENTS_FIRST) {
          const rows = workflow[model]
          if (Array.isArray(rows) && rows.length) await delegate(tx, model).createMany({ data: rows })
        }

        if (d.counters?.length) await tx.counter.createMany({ data: d.counters as never })
        if (d.orgUsers?.length) await tx.orgUser.createMany({ data: d.orgUsers as never })
        if (d.auditLogs?.length) await tx.auditLog.createMany({ data: d.auditLogs as never })
        }
        if (legacyOrg) await runAsTenant(legacyOrg, insertBusinessRows)
        else await runAsTenant(null, insertBusinessRows)
      },
      // Full-database restore is heavier than the 5s interactive default.
      { timeout: 60_000 }
    )
    await logAudit('BACKUP', 'Restore', undefined, `snapshot v${snap.version} restored (typed RESTORE confirm)`, 'platform-admin')
    return ok({ restored: true, version: snap.version })
  } catch (e) {
    return handleError(e)
  }
}
