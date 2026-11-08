/**
 * ForgeERP — multi-organisation isolation suite (disposable MySQL only).
 *
 * Org 1 = seeded demo organisation; Org 2 = created through the platform API.
 * Verifies: each organisation sees only its own rows, business codes and
 * document series are per organisation, every cross-organisation id (read,
 * write, cancel, reference) is refused, reports/search/audit are scoped,
 * suspension is per organisation, platform sessions never see business data,
 * and no row in the database references another organisation's rows.
 *
 *   AUDIT_BASE_URL=http://127.0.0.1:3012 AUDIT_DB_URL=mysql://.../forgeerp_tenant node tests/tenant-isolation.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openAuditDb } from './audit-db.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000'
const DB_URL = process.env.AUDIT_DB_URL
const DB_NAME = DB_URL ? new URL(DB_URL).pathname.slice(1) : ''
if (!DB_URL || (!/audit|test|tenant|tmp/i.test(DB_NAME) && process.env.AUDIT_CONFIRM_DISPOSABLE !== DB_NAME)) throw new Error('disposable AUDIT_DB_URL required')
const KEY = readFileSync(process.env.AUDIT_PLATFORM_KEY ?? join(ROOT, 'db', 'platform-key.key'), 'utf8').trim()
const db = openAuditDb({ url: DB_URL })
const results = []
let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; results.push({ name, pass: !!ok, detail: String(detail ?? '').slice(0, 500) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 170)}` : ''}`) }
async function call(method, path, body, cookie, headers = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null; try { json = await res.json() } catch {}
  return { status: res.status, data: json?.data, error: json?.error, setCookie: res.headers.get('set-cookie') }
}
async function login(email, password) {
  const r = await call('POST', '/api/auth/login', { email, password })
  return (r.setCookie ?? '').match(/forge_session=[^;]+/)?.[0] ?? ''
}
const refused = (r) => r.status === 404 || r.status === 403 || r.status === 400 || r.status === 409
const today = new Date().toISOString().slice(0, 10)
const plus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function main() {
  // ---- organisations
  const seed = await call('POST', '/api/seed?force=1', {}, '', { 'x-platform-key': KEY })
  check('seed demo organisation (org 1)', seed.status === 200, seed.error)
  const org2 = await call('POST', '/api/platform/orgs', { name: 'Tenant Two Fabricators', ownerName: 'Owner Two', ownerEmail: 'owner2@tenant.test', ownerPassword: 'tenant-two-123', billingCycle: 'MONTHLY', trialDays: 0 }, '', { 'x-platform-key': KEY })
  check('platform creates organisation 2 with an owner', org2.status === 200, org2.error)
  const c1 = await login('owner@shreeforge.example.com', 'forge123')
  const c2 = await login('owner2@tenant.test', 'tenant-two-123')
  check('both owners sign in', !!c1 && !!c2)
  const org1Id = (await db.get("SELECT companyId FROM OrgUser WHERE email='owner@shreeforge.example.com'")).companyId
  const org2Id = (await db.get("SELECT companyId FROM OrgUser WHERE email='owner2@tenant.test'")).companyId

  // ---- a new organisation starts empty and works
  for (const path of ['/api/masters/parties', '/api/masters/items', '/api/masters/warehouses', '/api/sales-invoices', '/api/purchase-invoices', '/api/payments', '/api/manufacturing/projects', '/api/jobwork/inwards']) {
    const r = await call('GET', path, undefined, c2)
    const rows = Array.isArray(r.data) ? r.data : (r.data?.rows ?? r.data?.items ?? [])
    check(`org 2 ${path} is 200 and empty (no org 1 rows)`, r.status === 200 && Array.isArray(rows) && rows.length === 0, `status=${r.status} rows=${rows?.length}`)
  }
  for (const path of ['/api/dashboard', '/api/procurement', '/api/order-to-cash', '/api/quality', '/api/traceability', '/api/finance-adjustments', '/api/returns', `/api/reports?type=trial-balance`, '/api/audit']) {
    const r = await call('GET', path, undefined, c2)
    check(`org 2 ${path} answers 200`, r.status === 200, `status=${r.status} ${r.error ?? ''}`)
  }
  const co = await call('GET', '/api/masters/company', undefined, c2)
  check('org 2 sees its own company profile', co.status === 200 && co.data?.name === 'Tenant Two Fabricators', JSON.stringify(co.data ?? co.error).slice(0, 120))

  // ---- same codes in both organisations, independent document series
  const wh = await call('POST', '/api/masters/warehouses', { code: 'MAIN', name: 'Org2 Main' }, c2)
  check('org 2 creates warehouse code MAIN (also used by org 1)', wh.status === 200, wh.error)
  const party = await call('POST', '/api/masters/parties', { code: 'CUST-001', name: 'Org2 Customer', types: ['CUSTOMER'], stateCode: '27' }, c2)
  check('org 2 creates party code CUST-001 (also used by org 1)', party.status === 200, party.error)
  const dupParty = await call('POST', '/api/masters/parties', { code: 'CUST-001', name: 'dup', types: ['CUSTOMER'], stateCode: '27' }, c2)
  check('duplicate code inside org 2 is still refused', dupParty.status >= 400 && dupParty.status < 500, `status=${dupParty.status}`)
  const item = await call('POST', '/api/masters/items', { code: 'FG-1001', name: 'Org2 Gear', uom: 'PCS', gstRate: 18, saleRate: 100, costRate: 60 }, c2)
  check('org 2 creates item code FG-1001 (also used by org 1)', item.status === 200, item.error)
  const op = await call('POST', '/api/inventory/opening', { warehouseId: wh.data?.id, rows: [{ itemId: item.data?.id, qty: 50, rate: 60 }] }, c2)
  check('org 2 opening stock', op.status === 200, op.error)
  const org1Before = await db.get('SELECT COUNT(*) c FROM SalesInvoice WHERE companyId=?', [org1Id])
  const inv2 = await call('POST', '/api/sales-invoices', { partyId: party.data?.id, warehouseId: wh.data?.id, lines: [{ itemId: item.data?.id, qty: 2, rate: 100 }] }, c2)
  check('org 2 posts a sales invoice', inv2.status === 200, inv2.error)
  check('org 2 numbering starts its own series at 001', /-001$/.test(inv2.data?.invoiceNo ?? ''), inv2.data?.invoiceNo)
  const org1Party = await db.get("SELECT id FROM Party WHERE companyId=? AND types LIKE '%CUSTOMER%' LIMIT 1", [org1Id])
  const org1Wh = await db.get("SELECT id FROM Warehouse WHERE companyId=? AND code='MAIN'", [org1Id])
  const org1Item = await db.get("SELECT id FROM Item WHERE companyId=? AND isStockItem=1 AND isService=0 LIMIT 1", [org1Id])
  const op1 = await call('POST', '/api/inventory/opening', { warehouseId: org1Wh.id, rows: [{ itemId: org1Item.id, qty: 5, rate: 10 }] }, c1)
  const inv1 = await call('POST', '/api/sales-invoices', { partyId: org1Party.id, warehouseId: org1Wh.id, lines: [{ itemId: org1Item.id, qty: 1, rate: 100 }] }, c1)
  check('org 1 keeps its own series (continues after its seeded invoices)', op1.status === 200 && inv1.status === 200 && !/-001$/.test(inv1.data?.invoiceNo ?? '-001') && inv1.data?.invoiceNo === inv2.data?.invoiceNo.replace(/-001$/, '-' + String(Number(org1Before.c) + 1).padStart(3, '0')), `org1=${inv1.data?.invoiceNo} org2=${inv2.data?.invoiceNo} org1 had ${org1Before.c}`)

  // ---- each organisation's lists contain only its rows
  const p1 = await call('GET', '/api/masters/parties', undefined, c1)
  check('org 1 party list has no org 2 row', !(p1.data ?? []).some((p) => p.id === party.data?.id), `${(p1.data ?? []).length} parties`)
  const s1 = await call('GET', '/api/sales-invoices', undefined, c1)
  check('org 1 invoice list has no org 2 invoice', !(s1.data ?? []).some((i) => i.id === inv2.data?.id))
  const s2 = await call('GET', '/api/sales-invoices', undefined, c2)
  check('org 2 invoice list has exactly its one invoice', (s2.data ?? []).length === 1 && s2.data[0].id === inv2.data?.id, `${(s2.data ?? []).length}`)
  const srch = await call('GET', '/api/search?q=Mahindra', undefined, c2)
  check('org 2 search never returns org 1 parties', !JSON.stringify(srch.data ?? {}).includes('Mahindra'), JSON.stringify(srch.data ?? {}).slice(0, 120))
  const audit2 = await call('GET', '/api/audit', undefined, c2)
  const auditRows = Array.isArray(audit2.data) ? audit2.data : (audit2.data?.rows ?? [])
  check('org 2 audit trail has no org 1 entries', !JSON.stringify(auditRows).includes('shreeforge'), `${auditRows.length} entries`)
  const tb2 = await call('GET', '/api/reports?type=trial-balance', undefined, c2)
  const sql2 = await db.get('SELECT ROUND(SUM(debit),2) dr FROM AccountLedger WHERE companyId=? AND isCancelled=0', [org2Id])
  check('org 2 trial balance = its own ledger only (and balanced)', tb2.data?.balanced === true && Math.abs(Number(tb2.data?.totalDr) - Number(sql2.dr)) < 0.01, `report Dr=${tb2.data?.totalDr} sql=${sql2.dr}`)
  const dash1 = await call('GET', '/api/dashboard', undefined, c1)
  check('org 1 dashboard still answers', dash1.status === 200)

  // ---- cross-organisation ids are refused everywhere
  const org1Inv = await db.get("SELECT id, invoiceNo FROM SalesInvoice WHERE companyId=? AND status='POSTED' ORDER BY invoiceNo DESC LIMIT 1", [org1Id])
  const org1Proj = await db.get('SELECT id FROM Project WHERE companyId=? LIMIT 1', [org1Id])
  const org1Wo = await db.get('SELECT w.id FROM WorkOrder w WHERE w.companyId=? LIMIT 1', [org1Id])
  const org1Task = await db.get('SELECT id FROM ProductionTask WHERE companyId=? LIMIT 1', [org1Id])
  const org1Emp = await db.get('SELECT id FROM Employee WHERE companyId=? LIMIT 1', [org1Id])
  const org1Inward = await db.get('SELECT id FROM JobworkInward WHERE companyId=? LIMIT 1', [org1Id])
  const org1Pay = await db.get('SELECT id FROM Payment WHERE companyId=? LIMIT 1', [org1Id])
  const org1Pin = await db.get('SELECT id FROM PurchaseInvoice WHERE companyId=? LIMIT 1', [org1Id])
  const attacks = [
    ['read org 1 sales invoice', () => call('GET', `/api/sales-invoices/${org1Inv.id}`, undefined, c2)],
    ['cancel org 1 sales invoice', () => call('DELETE', `/api/sales-invoices/${org1Inv.id}`, undefined, c2)],
    ['cancel org 1 purchase invoice', () => call('DELETE', `/api/purchase-invoices/${org1Pin.id}`, undefined, c2)],
    ['cancel org 1 payment', () => call('DELETE', `/api/payments/${org1Pay.id}`, undefined, c2)],
    ['edit org 1 party', () => call('PUT', `/api/masters/parties/${org1Party.id}`, { name: 'hijacked' }, c2)],
    ['delete org 1 item', () => call('DELETE', `/api/masters/items/${org1Item.id}`, undefined, c2)],
    ['invoice an org 1 customer', () => call('POST', '/api/sales-invoices', { partyId: org1Party.id, warehouseId: wh.data?.id, lines: [{ itemId: item.data?.id, qty: 1, rate: 1 }] }, c2)],
    ['invoice an org 1 item', () => call('POST', '/api/sales-invoices', { partyId: party.data?.id, warehouseId: wh.data?.id, lines: [{ itemId: org1Item.id, qty: 1, rate: 1 }] }, c2)],
    ['sell from an org 1 warehouse', () => call('POST', '/api/sales-invoices', { partyId: party.data?.id, warehouseId: org1Wh.id, lines: [{ itemId: item.data?.id, qty: 1, rate: 1 }] }, c2)],
    ['allocate a payment to an org 1 invoice number', () => call('POST', '/api/payments', { type: 'RECEIPT', partyId: party.data?.id, amount: 10, allocations: [{ invoiceType: 'SALES', invoiceNo: org1Inv.invoiceNo, amount: 10 }] }, c2)],
    ['read org 1 project', () => call('GET', `/api/manufacturing/projects/${org1Proj.id}`, undefined, c2)],
    ['start/cancel org 1 project', () => call('POST', `/api/manufacturing/projects/${org1Proj.id}/actions`, { action: 'cancel' }, c2)],
    ['act on org 1 work order', () => call('POST', `/api/manufacturing/work-orders/${org1Wo.id}/actions`, { action: 'cancel' }, c2)],
    ['act on org 1 task', () => call('POST', `/api/manufacturing/tasks/${org1Task.id}/actions`, { action: 'cancel' }, c2)],
    ['create a project for an org 1 customer', () => call('POST', '/api/manufacturing/projects', { name: 'x', partyId: org1Party.id, startDate: today }, c2)],
    ['edit org 1 employee', () => call('PUT', `/api/manufacturing/employees/${org1Emp.id}`, { name: 'x' }, c2)],
    ['read org 1 jobwork inward', () => call('GET', `/api/jobwork/inwards/${org1Inward.id}`, undefined, c2)],
    ['raise a PO on an org 1 supplier', () => call('POST', '/api/procurement', { action: 'create-order', supplierId: (org1Party.id), lines: [{ itemId: item.data?.id, qty: 1, rate: 1 }] }, c2)],
    ['quote an org 1 customer', () => call('POST', '/api/order-to-cash', { action: 'create-quotation', partyId: org1Party.id, validUntil: plus(5), lines: [{ itemId: item.data?.id, qty: 1, rate: 1 }] }, c2)],
    ['return against an org 1 invoice', () => call('POST', '/api/returns', { returnType: 'SALES_RETURN', sourceInvoiceId: org1Inv.id, warehouseId: wh.data?.id, reason: 'x', lines: [{ sourceLineId: 'x', requestedQty: 1, acceptedQty: 1, rejectedQty: 0 }] }, c2)],
    ['Tally export of an org 1 invoice', () => call('GET', `/api/tally/voucher?kind=SALES&id=${org1Inv.id}`, undefined, c2)],
  ]
  const org1Lot = await db.get('SELECT id FROM InventoryLot WHERE companyId=? LIMIT 1', [org1Id])
  if (org1Lot) attacks.push(['recall an org 1 lot', () => call('POST', '/api/traceability', { action: 'recall', id: org1Lot.id, reason: 'x' }, c2)])
  const org1Receipt = await db.get('SELECT id FROM ProductionReceipt WHERE companyId=? LIMIT 1', [org1Id])
  if (org1Receipt) attacks.push(['cancel an org 1 production receipt', () => call('POST', '/api/manufacturing/receipts', { action: 'cancel', id: org1Receipt.id }, c2)])
  for (const [label, run] of attacks) {
    const r = await run()
    check(`org 2 cannot ${label}`, refused(r), `status=${r.status} ${r.error ?? ''}`)
  }
  const stillThere = await db.get('SELECT status FROM SalesInvoice WHERE id=?', [org1Inv.id])
  check('org 1 invoice untouched after the attacks', stillThere.status === 'POSTED')
  check('org 1 party name untouched', (await db.get('SELECT name FROM Party WHERE id=?', [org1Party.id])).name !== 'hijacked')

  // ---- no row in the database references another organisation
  const crossRefs = await db.all(`
    SELECT 'SalesInvoice.party' r, COUNT(*) n FROM SalesInvoice s JOIN Party p ON p.id=s.partyId WHERE s.companyId<>p.companyId
    UNION ALL SELECT 'SalesInvoiceItem.item', COUNT(*) FROM SalesInvoiceItem i JOIN SalesInvoice s ON s.id=i.invoiceId JOIN Item it ON it.id=i.itemId WHERE s.companyId<>it.companyId
    UNION ALL SELECT 'StockLedger.item', COUNT(*) FROM StockLedger l JOIN Item it ON it.id=l.itemId WHERE l.companyId<>it.companyId
    UNION ALL SELECT 'StockLedger.warehouse', COUNT(*) FROM StockLedger l JOIN Warehouse w ON w.id=l.warehouseId WHERE l.companyId<>w.companyId
    UNION ALL SELECT 'AccountLedger.party', COUNT(*) FROM AccountLedger a JOIN Party p ON p.id=a.partyId WHERE a.companyId<>p.companyId
    UNION ALL SELECT 'Payment.party', COUNT(*) FROM Payment y JOIN Party p ON p.id=y.partyId WHERE y.companyId<>p.companyId
    UNION ALL SELECT 'Project.party', COUNT(*) FROM Project j JOIN Party p ON p.id=j.partyId WHERE j.companyId<>p.companyId
    UNION ALL SELECT 'WorkOrder.project', COUNT(*) FROM WorkOrder w JOIN Project j ON j.id=w.projectId WHERE w.companyId<>j.companyId
    UNION ALL SELECT 'ProductionTask.workOrder', COUNT(*) FROM ProductionTask t JOIN WorkOrder w ON w.id=t.workOrderId WHERE t.companyId<>w.companyId
    UNION ALL SELECT 'PurchaseOrder.supplier', COUNT(*) FROM PurchaseOrder o JOIN Party p ON p.id=o.supplierId WHERE o.companyId<>p.companyId
    UNION ALL SELECT 'SalesOrder.party', COUNT(*) FROM SalesOrder o JOIN Party p ON p.id=o.partyId WHERE o.companyId<>p.companyId
    UNION ALL SELECT 'InventoryLot.item', COUNT(*) FROM InventoryLot l JOIN Item it ON it.id=l.itemId WHERE l.companyId<>it.companyId`)
  const bad = crossRefs.filter((r) => Number(r.n) > 0)
  check('no row references another organisation (12 relations checked)', bad.length === 0, JSON.stringify(bad))
  const orphans = await db.all(`SELECT table_name t FROM information_schema.columns WHERE table_schema=DATABASE() AND column_name='companyId' AND is_nullable='NO'`)
  let emptyCompany = 0
  for (const { t } of orphans) emptyCompany += Number((await db.get(`SELECT COUNT(*) c FROM \`${t}\` WHERE companyId='' OR companyId NOT IN (SELECT id FROM Company)`)).c)
  check(`every organisation-owned row (${orphans.length} tables) points at a real organisation`, emptyCompany === 0, `${emptyCompany} bad rows`)

  // ---- books, stock adjustments, CRM and service calls are per organisation
  const sp1 = await call('POST', '/api/crm', { action: 'save-salesperson', code: 'SP1', name: 'Org1 Seller' }, c1)
  const sp2 = await call('POST', '/api/crm', { action: 'save-salesperson', code: 'SP1', name: 'Org2 Seller' }, c2)
  check('both organisations can use salesperson code SP1', sp1.status === 200 && sp2.status === 200, `${sp1.error ?? ''} ${sp2.error ?? ''}`)
  const led2 = await call('POST', '/api/books', { action: 'create-ledger', code: 'RENT', name: 'Org2 Rent', group: 'Indirect Expenses', nature: 'EXPENSE' }, c2)
  const led1 = await call('POST', '/api/books', { action: 'create-ledger', code: 'RENT', name: 'Org1 Rent', group: 'Indirect Expenses', nature: 'EXPENSE' }, c1)
  check('both organisations can define ledger RENT', led1.status === 200 && led2.status === 200, `${led1.error ?? ''} ${led2.error ?? ''}`)
  const lead2 = await call('POST', '/api/crm', { action: 'create-lead', contactName: 'Org2 Prospect', phone: '9811111111', salespersonId: sp2.data?.id }, c2)
  check('org 2 creates a lead (LD series 001)', lead2.status === 200 && /-001$/.test(lead2.data?.leadNo ?? ''), lead2.data?.leadNo ?? lead2.error)
  const lead1dup = await call('POST', '/api/crm', { action: 'create-lead', contactName: 'Org1 Prospect', phone: '9811111111' }, c1)
  check('the duplicate-contact guard does not look into another organisation', lead1dup.status === 200, lead1dup.error)
  const crm1 = await call('GET', '/api/crm', undefined, c1)
  check("org 1 CRM does not list org 2's lead or salesperson", crm1.status === 200 && !crm1.data?.leads.some((l) => l.id === lead2.data?.id) && !crm1.data?.salespersons.some((s) => s.id === sp2.data?.id))
  check("org 1 cannot move org 2's lead", refused(await call('POST', '/api/crm', { action: 'move-lead', id: lead2.data?.id, status: 'LOST', reason: 'x' }, c1)))
  check("org 1 cannot put org 2's salesperson on its lead", refused(await call('POST', '/api/crm', { action: 'create-lead', contactName: 'Mixed', phone: '9822222222', salespersonId: sp2.data?.id }, c1)))
  const jv2 = await call('POST', '/api/books', { action: 'post-journal', date: today, narration: 'org2 rent', lines: [{ account: 'RENT', debit: 100 }, { account: 'CASH', credit: 100 }] }, c2)
  check('org 2 posts a journal on its own RENT ledger', jv2.status === 200, jv2.error)
  check("org 1 cannot cancel org 2's journal", refused(await call('POST', '/api/books', { action: 'cancel-journal', id: jv2.data?.id, reason: 'x' }, c1)))
  const rentNames = await db.all("SELECT DISTINCT companyId, accountName FROM AccountLedger WHERE account='RENT'")
  check("org 2's journal used org 2's ledger name", rentNames.length === 1 && rentNames[0].companyId === org2Id && rentNames[0].accountName === 'Org2 Rent', JSON.stringify(rentNames))
  const adj2 = await call('POST', '/api/stock-adjustments', { action: 'request', date: today, warehouseId: wh.data?.id, reasonCode: 'DAMAGE', lines: [{ itemId: item.data?.id, qtyChange: -1 }] }, c2)
  check('org 2 requests a stock adjustment', adj2.status === 200, adj2.error)
  check("org 1 cannot approve org 2's adjustment", refused(await call('POST', '/api/stock-adjustments', { action: 'approve', id: adj2.data?.id }, c1)))
  check("org 1 cannot adjust org 2's warehouse", refused(await call('POST', '/api/stock-adjustments', { action: 'request', date: today, warehouseId: wh.data?.id, reasonCode: 'FOUND', lines: [{ itemId: item.data?.id, qtyChange: 1 }] }, c1)))
  const call2 = await call('POST', '/api/service-calls', { action: 'create', partyId: party.data?.id, complaint: 'org2 complaint text' }, c2)
  check('org 2 logs a service call', call2.status === 200, call2.error)
  check("org 1 cannot log a call for org 2's customer", refused(await call('POST', '/api/service-calls', { action: 'create', partyId: party.data?.id, complaint: 'cross org complaint' }, c1)))
  check("org 1 cannot cancel org 2's service call", refused(await call('POST', '/api/service-calls', { action: 'cancel', id: call2.data?.id, reason: 'x' }, c1)))
  const svc1 = await call('GET', '/api/service-calls', undefined, c1)
  check("org 1 service calls do not include org 2's", svc1.status === 200 && !svc1.data?.calls.some((c) => c.id === call2.data?.id))
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const lk = await call('POST', '/api/books', { action: 'lock-books', until: y }, c1)
  const post2 = await call('POST', '/api/books', { action: 'post-journal', date: y, narration: 'org2 yesterday', lines: [{ account: 'RENT', debit: 1 }, { account: 'CASH', credit: 1 }] }, c2)
  check("org 1's books lock does not lock org 2", lk.status === 200 && post2.status === 200, `${lk.error ?? ''} ${post2.error ?? ''}`)
  await call('POST', '/api/books', { action: 'lock-books', until: null, reason: 'tenant test cleanup' }, c1)
  const cross2 = await db.all(`SELECT 'Lead.salesperson' rel, COUNT(*) n FROM \`Lead\` l JOIN Salesperson s ON s.id=l.salespersonId WHERE l.companyId<>s.companyId
    UNION ALL SELECT 'StockAdjustment.warehouse', COUNT(*) FROM StockAdjustment a JOIN Warehouse w ON w.id=a.warehouseId WHERE a.companyId<>w.companyId
    UNION ALL SELECT 'ServiceCall.party', COUNT(*) FROM ServiceCall c JOIN Party p ON p.id=c.partyId WHERE c.companyId<>p.companyId`)
  check('new modules: no row references another organisation', cross2.every((r) => Number(r.n) === 0), JSON.stringify(cross2))

  // ---- access state is per organisation
  await db.run("UPDATE Company SET saasStatus='SUSPENDED' WHERE id=?", [org2Id])
  const susp2 = await call('GET', '/api/sales-invoices', undefined, c2)
  const live1 = await call('GET', '/api/sales-invoices', undefined, c1)
  check('suspending org 2 blocks org 2 only', susp2.status === 403 && live1.status === 200, `org2=${susp2.status} org1=${live1.status}`)
  await db.run("UPDATE Company SET saasStatus='ACTIVE' WHERE id=?", [org2Id])
  const pl = await call('POST', '/api/platform/auth', { email: 'admin@forgeplatform.example.com', password: 'platform123' })
  const pc = (pl.setCookie ?? '').match(/forge_session=[^;]+/)?.[0]
  if (pc) {
    const r = await call('GET', '/api/sales-invoices', undefined, pc)
    check('platform-operator session gets no organisation workspace', r.status === 403 || r.status === 401, `status=${r.status}`)
  }
  // ---- backup covers both organisations, restore keeps ownership
  const bk = await call('GET', '/api/backup', undefined, '', { 'x-platform-key': KEY })
  const owners = new Set((bk.data?.data?.parties ?? []).map((p) => p.companyId))
  check('platform backup (v5) carries both organisations with companyId', bk.data?.version === 5 && owners.has(org1Id) && owners.has(org2Id), `version=${bk.data?.version} owners=${[...owners].length}`)
  const rs = await call('POST', '/api/backup/restore', { confirm: 'RESTORE', snapshot: bk.data }, '', { 'x-platform-key': KEY })
  check('restore of the v5 snapshot succeeds', rs.status === 200, rs.error)
  const after = await db.get('SELECT COUNT(*) c FROM Party WHERE companyId=?', [org2Id])
  check('org 2 rows are still owned by org 2 after restore', Number(after.c) === 1, `org2 parties=${after.c}`)

  const summary = { ranAt: new Date().toISOString(), baseUrl: BASE, total: results.length, passed: results.length - failures, failed: failures, results }
  writeFileSync(process.env.TENANT_RESULTS ?? join(ROOT, 'tests', 'tenant-isolation-results.json'), JSON.stringify(summary, null, 2))
  console.log(`\n=== ${summary.passed}/${summary.total} tenant-isolation checks passed, ${summary.failed} failed ===`)
  await db.close()
  if (failures) process.exitCode = 1
}
main().catch(async (e) => { console.error('TENANT SUITE ERROR', e); await db.close(); process.exitCode = 2 })
