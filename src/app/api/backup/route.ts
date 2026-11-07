import { handleError, ok } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformAdmin } from '@/lib/platform'

/**
 * GET /api/backup — full JSON snapshot of every table (download).
 * Platform-admin gated (SUPER_ADMIN session cookie or the x-platform-key
 * HEADER — keys never travel in URLs). The destructive restore lives at
 * POST /api/backup/restore. Snapshots include OrgUser so a restore can never
 * lock every login out (or expose the bootstrap takeover window).
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
      db.counter.findMany(),
      db.auditLog.findMany(),
    ])
    await logAudit('BACKUP', 'Backup', undefined, 'snapshot downloaded', 'platform-admin')
    return ok({
      version: 2,
      takenAt: new Date().toISOString(),
      counts: {
        company: company.length, plans: plans.length, orgUsers: orgUsers.length, parties: parties.length,
        items: items.length, warehouses: warehouses.length, processes: processes.length, stockLedger: stockLedger.length,
        accountLedger: accountLedger.length, salesInvoices: salesInvoices.length,
        purchaseInvoices: purchaseInvoices.length, payments: payments.length,
        jobworkInwards: jobworkInwards.length, jobCards: jobCards.length, certificates: certificates.length,
      },
      data: {
        company, plans, orgUsers, parties, items, warehouses, processes, partyProcessRates,
        stockLedger, accountLedger, salesInvoices, purchaseInvoices, payments,
        jobworkInwards, jobCards, jobCardProcesses, certificates, counters, auditLogs,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
