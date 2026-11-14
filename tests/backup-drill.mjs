/**
 * ForgeERP — backup / restore drill + seed reconciliation (MySQL).
 *
 * Against a DISPOSABLE database only (the drill force-reseeds):
 *   1. force reseed → every seeded count matches seedDatabase()'s own summary,
 *      trial balance balances, no negative stock, no orphan FK targets
 *   2. download backup (v4) → snapshot row counts == live table counts for
 *      EVERY table in the schema (information_schema), not just a hand list
 *   3. force reseed again (fresh ids) → counts differ from the snapshot
 *   4. restore snapshot → every table count equals the snapshot again and a
 *      sample of invoice numbers / ledger totals matches byte-for-byte
 *
 * Usage: AUDIT_BASE_URL=http://127.0.0.1:3010 AUDIT_DB_URL=mysql://... node tests/backup-drill.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openAuditDb } from './audit-db.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000'
const DB_URL = process.env.AUDIT_DB_URL
if (!DB_URL) throw new Error('AUDIT_DB_URL (mysql) is required for the drill')
const KEY = readFileSync(process.env.AUDIT_PLATFORM_KEY ?? join(ROOT, 'db', 'platform-key.key'), 'utf8').trim()
const db = openAuditDb({ url: DB_URL })
const results = []
let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; results.push({ name, pass: !!ok, detail: String(detail).slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`) }
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'x-platform-key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let json = null; try { json = await res.json() } catch {}
  return { status: res.status, json }
}

// Map snapshot arrays -> physical tables so counts can be compared.
const SNAPSHOT_TABLES = {
  company: 'Company', plans: 'Plan', orgUsers: 'OrgUser', parties: 'Party', items: 'Item', warehouses: 'Warehouse',
  processes: 'Process', partyProcessRates: 'PartyProcessRate', stockLedger: 'StockLedger', accountLedger: 'AccountLedger',
  salesInvoices: 'SalesInvoice', purchaseInvoices: 'PurchaseInvoice', payments: 'Payment', jobworkInwards: 'JobworkInward',
  jobCards: 'JobCard', jobCardProcesses: 'JobCardProcess', certificates: 'JobworkCertificate', employees: 'Employee',
  projects: 'Project', boms: 'Bom', workOrders: 'WorkOrder', productionTasks: 'ProductionTask',
  platformInquiries: 'PlatformInquiry', platformBlogPosts: 'PlatformBlogPost', counters: 'Counter', auditLogs: 'AuditLog',
}
const nestedChildren = { salesInvoices: ['items', 'SalesInvoiceItem'], purchaseInvoices: ['items', 'PurchaseInvoiceItem'], payments: ['allocations', 'PaymentAllocation'], jobworkInwards: ['items', 'JobworkInwardItem'], boms: ['items', 'BomItem'], workOrders: ['lines', 'WorkOrderLine'], platformInquiries: ['followUps', 'PlatformInquiryFollowUp'] }
// Physical table names are compared lowercase: Windows MySQL ships with
// lower_case_table_names=1 (every stored name is lowercase) while Linux keeps
// the Prisma model casing. Normalising both sides keeps the checks identical
// on either platform instead of failing on the OS the drill happens to run on.
const model2table = (m) => m.toLowerCase()

async function tableCounts() {
  const tables = (await db.all("SELECT table_name t FROM information_schema.tables WHERE table_schema = DATABASE() AND LOWER(table_name) NOT IN ('_prisma_migrations', 'idempotencykey')")).map((r) => r.t.toLowerCase())
  const out = {}
  for (const t of tables) out[t] = Number((await db.get(`SELECT COUNT(*) c FROM \`${t}\``)).c)
  return out
}
function snapshotCounts(snap) {
  const out = {}
  for (const [key, table] of Object.entries(SNAPSHOT_TABLES)) {
    const rows = snap.data[key] ?? []
    out[table.toLowerCase()] = rows.length
    const nested = nestedChildren[key]
    if (nested) out[nested[1].toLowerCase()] = rows.reduce((s, r) => s + ((r[nested[0]] ?? []).length), 0)
  }
  for (const [model, rows] of Object.entries(snap.data.workflow ?? {})) out[model2table(model)] = rows.length
  return out
}
function diffCounts(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => (a[k] ?? 0) !== (b[k] ?? 0)).map((k) => `${k}: ${a[k] ?? 0} vs ${b[k] ?? 0}`)
}

async function main() {
  // 1. seed + reconciliation
  const seed = await api('POST', '/api/seed?force=1', {})
  check('force reseed succeeds (200)', seed.status === 200, `status=${seed.status} ${JSON.stringify(seed.json).slice(0, 120)}`)
  const expected = seed.json?.data?.counts ?? {}
  const live = await tableCounts()
  const recon = { parties: 'Party', items: 'Item', processes: 'Process', warehouses: 'Warehouse', purchaseInvoices: 'PurchaseInvoice', salesInvoices: 'SalesInvoice', payments: 'Payment', jobworkInwards: 'JobworkInward', jobCards: 'JobCard', certificates: 'JobworkCertificate', employees: 'Employee', projects: 'Project', boms: 'Bom', workOrders: 'WorkOrder', productionTasks: 'ProductionTask', inquiries: 'PlatformInquiry', blogPosts: 'PlatformBlogPost' }
  const mism = Object.entries(recon).filter(([k, t]) => expected[k] !== undefined && expected[k] !== live[t.toLowerCase()]).map(([k, t]) => `${k}: seed says ${expected[k]}, table ${t} has ${live[t.toLowerCase()]}`)
  check('seeded row counts reconcile with seedDatabase() summary', mism.length === 0, mism.join('; ') || `${Object.keys(recon).length} tables checked`)
  const tb = await db.get('SELECT ROUND(COALESCE(SUM(debit),0),2) dr, ROUND(COALESCE(SUM(credit),0),2) cr FROM AccountLedger WHERE isCancelled=0')
  check('account ledger balances after seed (Dr == Cr)', Math.abs(Number(tb.dr) - Number(tb.cr)) < 0.005, `Dr=${tb.dr} Cr=${tb.cr}`)
  const neg = await db.all('SELECT itemId, warehouseId, ROUND(SUM(qtyIn - qtyOut),3) net FROM StockLedger WHERE isCancelled=0 GROUP BY itemId, warehouseId HAVING net < -0.001')
  check('no negative stock balance after seed', neg.length === 0, neg.length ? JSON.stringify(neg.slice(0, 3)) : 'all item/warehouse balances >= 0')
  const orphanSales = await db.get('SELECT COUNT(*) c FROM SalesInvoiceItem i LEFT JOIN SalesInvoice h ON h.id = i.invoiceId WHERE h.id IS NULL')
  const orphanStock = await db.get('SELECT COUNT(*) c FROM StockLedger s LEFT JOIN Item i ON i.id = s.itemId WHERE i.id IS NULL')
  check('no orphan invoice lines or stock rows', Number(orphanSales.c) === 0 && Number(orphanStock.c) === 0, `invoiceLines=${orphanSales.c} stockRows=${orphanStock.c}`)
  const receipt = await db.get("SELECT COUNT(*) c, ROUND(COALESCE(SUM(acceptedQty),0),2) q FROM ProductionReceipt WHERE status='POSTED'")
  check('seeded completed work order has a posted production receipt', Number(receipt.c) >= 1 && Number(receipt.q) > 0, `receipts=${receipt.c} acceptedQty=${receipt.q}`)
  // Routing/capacity/OEE/costing data must survive the drill: these tables are
  // new, hang off work orders and BOM revisions, and are exactly what a restore
  // ordering mistake (work centres inserted after the tasks that reference them)
  // destroys. Zero rows here means the seed did not build the demo shop floor.
  const ops = await db.get(`SELECT
      (SELECT COUNT(*) FROM WorkCenter) centers,
      (SELECT COUNT(*) FROM ShiftCalendar) calendars,
      (SELECT COUNT(*) FROM RoutingOperation) routings,
      (SELECT COUNT(*) FROM ProductionTask WHERE workCenterId IS NOT NULL) routedTasks,
      (SELECT ROUND(COALESCE(SUM(overheadCost),0),2) FROM ProductionTask) overhead`)
  check('seed builds a routed shop floor (centres, calendars, routings, routed tasks)', Number(ops.centers) >= 6 && Number(ops.calendars) >= 6 && Number(ops.routings) >= 3 && Number(ops.routedTasks) >= 5, JSON.stringify(ops))
  check('seeded operations absorbed factory overhead', Number(ops.overhead) > 0, `absorbed=${ops.overhead}`)
  // Attachment once dropped out of the backup model list (added after v5
  // shipped) — a probe row proves the metadata survives backup → reseed →
  // restore instead of every table-count check passing vacuously on zeros.
  // The file bytes live on disk; this row is the surviving reference.
  const probe = await db.get('SELECT c.id companyId, p.id partyId FROM Company c JOIN Party p ON p.companyId = c.id LIMIT 1')
  await db.run(
    'INSERT INTO Attachment (id, companyId, entityType, entityId, fileName, mimeType, size, storageKey, note, uploadedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))',
    ['drill-attachment-probe', probe.companyId, 'PARTY', probe.partyId, 'probe.pdf', 'application/pdf', 11, 'probe.pdf', 'drill round-trip probe', null],
  )
  const attProbe = await db.get("SELECT COUNT(*) c FROM Attachment WHERE id='drill-attachment-probe'")
  check('attachment probe row inserted', Number(attProbe.c) === 1, `rows=${attProbe.c}`)

  // 2. backup covers every table
  const bk = await api('GET', '/api/backup')
  check('backup downloads (200, v5)', bk.status === 200 && bk.json?.data?.version === 5, `status=${bk.status} version=${bk.json?.data?.version}`)
  const snap = bk.json.data
  const snapCounts = snapshotCounts(snap)
  const liveNow = await tableCounts()
  // the backup itself appends one AuditLog row after reading — tolerate exactly that
  const d1 = diffCounts(snapCounts, liveNow).filter((x) => !x.startsWith('auditlog: '))
  const missingTables = Object.keys(liveNow).filter((t) => !(t in snapCounts))
  check('snapshot covers every physical table', missingTables.length === 0, missingTables.length ? `missing: ${missingTables.join(', ')}` : `${Object.keys(liveNow).length} tables`)
  check('snapshot row counts equal live table counts', d1.length === 0, d1.join('; ') || 'all equal')
  const workflowRows = Object.values(snap.data.workflow ?? {}).reduce((s, r) => s + r.length, 0)
  check('snapshot carries workflow rows (not an empty section)', workflowRows > 0, `${workflowRows} workflow rows`)
  const sampleInv = await db.all('SELECT invoiceNo, grandTotal FROM SalesInvoice ORDER BY invoiceNo')

  // 3. reseed -> different ids, then restore
  const seed2 = await api('POST', '/api/seed?force=1', {})
  check('second force reseed succeeds (fresh ids)', seed2.status === 200, `status=${seed2.status}`)
  const firstId = snap.data.salesInvoices[0]?.id
  const afterReseed = await db.get('SELECT COUNT(*) c FROM SalesInvoice WHERE id=?', [firstId])
  check('reseed produced different row ids than the snapshot', Number(afterReseed.c) === 0, `snapshot invoice id present=${afterReseed.c}`)
  const rs = await api('POST', '/api/backup/restore', { confirm: 'RESTORE', snapshot: snap })
  check('restore of v5 snapshot succeeds (200)', rs.status === 200, `status=${rs.status} ${JSON.stringify(rs.json).slice(0, 160)}`)
  const liveAfter = await tableCounts()
  const d2 = diffCounts(snapCounts, liveAfter).filter((x) => !x.startsWith('auditlog: '))
  check('after restore every table count equals the snapshot', d2.length === 0, d2.join('; ') || 'all equal')
  // The FK that broke restore: a task's work centre must still resolve after a
  // round trip, otherwise the rows were dropped or inserted in the wrong order.
  const routedAfter = await db.get(`SELECT COUNT(*) tasks, COUNT(workCenterId) withCenter,
      (SELECT COUNT(*) FROM RoutingOperation) routings,
      (SELECT COUNT(*) FROM ShiftCalendar) calendars,
      (SELECT ROUND(COALESCE(SUM(overheadCost),0),2) FROM ProductionTask) overhead FROM ProductionTask`)
  check('restore keeps routed tasks, routings and calendars', Number(routedAfter.routings) >= 3 && Number(routedAfter.calendars) >= 6 && Number(routedAfter.withCenter) >= 5, JSON.stringify(routedAfter))
  check('restore keeps absorbed overhead on the operations', Number(routedAfter.overhead) > 0, `absorbed=${routedAfter.overhead}`)
  const backId = await db.get('SELECT COUNT(*) c FROM SalesInvoice WHERE id=?', [firstId])
  check('restored rows carry the original ids', Number(backId.c) === 1, `snapshot invoice id present=${backId.c}`)
  const attBack = await db.get("SELECT COUNT(*) c FROM Attachment WHERE id='drill-attachment-probe'")
  check('attachment metadata survives backup → reseed → restore', Number(attBack.c) === 1, `rows=${attBack.c}`)
  const sampleAfter = await db.all('SELECT invoiceNo, grandTotal FROM SalesInvoice ORDER BY invoiceNo')
  check('invoice numbers and totals identical after restore', JSON.stringify(sampleInv) === JSON.stringify(sampleAfter), `${sampleAfter.length} invoices`)
  const tb2 = await db.get('SELECT ROUND(COALESCE(SUM(debit),0),2) dr, ROUND(COALESCE(SUM(credit),0),2) cr FROM AccountLedger WHERE isCancelled=0')
  check('ledger still balanced after restore', Math.abs(Number(tb2.dr) - Number(tb2.cr)) < 0.005 && tb2.dr === tb.dr, `Dr=${tb2.dr} Cr=${tb2.cr} (seed Dr=${tb.dr})`)

  // 4. a v3-shaped snapshot must be refused while workflow rows exist
  const legacy = { version: 3, data: { ...snap.data } }
  delete legacy.data.workflow
  const refused = await api('POST', '/api/backup/restore', { confirm: 'RESTORE', snapshot: legacy })
  check('v3 snapshot refused while workflow rows exist (400)', refused.status === 400, `status=${refused.status} ${refused.json?.error?.slice(0, 100)}`)

  const summary = { ranAt: new Date().toISOString(), baseUrl: BASE, total: results.length, passed: results.length - failures, failed: failures, results }
  writeFileSync(process.env.DRILL_RESULTS ?? join(ROOT, 'tests', 'backup-drill-results.json'), JSON.stringify(summary, null, 2))
  console.log(`\n=== ${summary.passed}/${summary.total} drill checks passed, ${summary.failed} failed ===`)
  await db.close()
  if (failures) process.exitCode = 1
}
main().catch(async (e) => { console.error('DRILL ERROR', e); await db.close(); process.exitCode = 2 })
