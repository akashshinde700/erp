import { handleError, ok } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformAdmin } from '@/lib/platform'
import { WORKFLOW_MODELS_CHILDREN_FIRST, delegate } from '@/lib/backup-tables'

/**
 * GET /api/backup — full JSON snapshot of EVERY table (download).
 * Platform-admin gated (SUPER_ADMIN session cookie or the x-platform-key
 * HEADER — keys never travel in URLs). The destructive restore lives at
 * POST /api/backup/restore.
 *
 * v3: includes the manufacturing chain (Employee → Project → BOM → Work
 * Order → ProductionTask) and the platform-console tables. v1/v2 snapshots
 * omitted these, so restoring one silently destroyed production history and
 * even failed on FK constraints. Never ship a snapshot that cannot round-trip.
 * v4: adds the workflow tables (procurement, quote-to-cash, QC, lots/serials,
 *     production receipts, schedules, advances, refunds) under data.workflow,
 *     keyed by Prisma model name (see src/lib/backup-tables.ts).
 * v5: every organisation-owned row carries companyId (tenant isolation). The
 *     snapshot is platform-wide: it covers all organisations.
 */
export async function GET(req: Request) {
  try {
    await requirePlatformAdmin(req)
    const [
      company,
      plans,
      orgUsers,
      parties,
      items,
      warehouses,
      processes,
      partyProcessRates,
      stockLedger,
      accountLedger,
      salesInvoices,
      purchaseInvoices,
      payments,
      jobworkInwards,
      jobCards,
      jobCardProcesses,
      certificates,
      employees,
      projects,
      boms,
      workOrders,
      productionTasks,
      platformInquiries,
      platformBlogPosts,
      counters,
      auditLogs,
    ] = await Promise.all([
      db.company.findMany(),
      db.plan.findMany(),
      // passwordHash included on purpose: a restore without logins re-opens
      // the anonymous bootstrap takeover window — logins must survive.
      db.orgUser.findMany({ select: { id: true, email: true, passwordHash: true, name: true, role: true, companyId: true, tokenVersion: true, createdAt: true, lastLoginAt: true } }),
      db.party.findMany(),
      db.item.findMany(),
      db.warehouse.findMany(),
      db.process.findMany(),
      db.partyProcessRate.findMany(),
      db.stockLedger.findMany(),
      db.accountLedger.findMany(),
      db.salesInvoice.findMany({ include: { items: true } }),
      db.purchaseInvoice.findMany({ include: { items: true } }),
      db.payment.findMany({ include: { allocations: true } }),
      db.jobworkInward.findMany({ include: { items: true } }),
      db.jobCard.findMany({ include: { processes: true } }),
      db.jobCardProcess.findMany(),
      db.jobworkCertificate.findMany(),
      db.employee.findMany(),
      db.project.findMany(),
      db.bom.findMany({ include: { items: true } }),
      db.workOrder.findMany({ include: { lines: true } }),
      db.productionTask.findMany(),
      db.platformInquiry.findMany({ include: { followUps: true } }),
      db.platformBlogPost.findMany(),
      db.counter.findMany(),
      db.auditLog.findMany(),
    ])
    const workflowEntries = await Promise.all(
      WORKFLOW_MODELS_CHILDREN_FIRST.map(async (model) => [model, await delegate(db, model).findMany()] as const)
    )
    const workflow = Object.fromEntries(workflowEntries) as Record<string, unknown[]>
    const workflowCounts = Object.fromEntries(workflowEntries.map(([model, rows]) => [model, rows.length]))
    await logAudit('BACKUP', 'Backup', undefined, 'snapshot downloaded (v5, all organisations)', 'platform-admin')
    return ok({
      version: 5,
      takenAt: new Date().toISOString(),
      counts: {
        company: company.length, plans: plans.length, orgUsers: orgUsers.length, parties: parties.length,
        items: items.length, warehouses: warehouses.length, processes: processes.length,
        stockLedger: stockLedger.length, accountLedger: accountLedger.length,
        salesInvoices: salesInvoices.length, purchaseInvoices: purchaseInvoices.length,
        payments: payments.length, jobworkInwards: jobworkInwards.length,
        jobCards: jobCards.length, certificates: certificates.length,
        employees: employees.length, projects: projects.length, boms: boms.length,
        workOrders: workOrders.length, productionTasks: productionTasks.length,
        platformInquiries: platformInquiries.length, platformBlogPosts: platformBlogPosts.length,
        workflow: workflowCounts,
      },
      data: {
        company, plans, orgUsers, parties, items, warehouses, processes, partyProcessRates,
        stockLedger, accountLedger, salesInvoices, purchaseInvoices, payments,
        jobworkInwards, jobCards, jobCardProcesses, certificates,
        employees, projects, boms, workOrders, productionTasks,
        platformInquiries, platformBlogPosts,
        counters, auditLogs,
        workflow,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
