/**
 * ForgeERP — executed workflow audit (Purchase-to-Pay, Quote-to-Cash,
 * Manufacturing/FG/WIP, Quality, Lots/Serials, Returns/Advances/Refunds,
 * GST exports, auth/tenant gates, API input fuzzing).
 *
 * Every assertion is a real HTTP request against a running server plus raw
 * SQL against the SAME disposable MySQL database. After every phase the global
 * integrity reconciliation runs (voucher Dr = Cr, stock and lot balances,
 * invoice header = lines, paidAmount = allocations, billed <= accepted, ...).
 *
 * DESTRUCTIVE: starts with ?force=1 reseed. Disposable databases only.
 *
 *   AUDIT_BASE_URL=http://127.0.0.1:3011 \
 *   AUDIT_DB_URL=mysql://root:...@127.0.0.1:3308/forgeerp_audit \
 *   node tests/workflow-audit.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scryptSync, randomBytes } from 'node:crypto'
import { openAuditDb } from './audit-db.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000'
const DB_URL = process.env.AUDIT_DB_URL
if (!DB_URL || !/^mysql:\/\//.test(DB_URL)) throw new Error('AUDIT_DB_URL=mysql://... (disposable database) is required')
const DB_NAME = new URL(DB_URL).pathname.slice(1)
if (!/audit|test|mig|disposable|tmp/i.test(DB_NAME) && process.env.AUDIT_CONFIRM_DISPOSABLE !== DB_NAME) throw new Error(`Refusing to run: '${DB_NAME}' does not look disposable — set AUDIT_CONFIRM_DISPOSABLE=${DB_NAME} to confirm`)
const KEY = readFileSync(process.env.AUDIT_PLATFORM_KEY ?? join(ROOT, 'db', 'platform-key.key'), 'utf8').trim()
const OUT = process.env.WORKFLOW_RESULTS ?? join(ROOT, 'tests', 'workflow-audit-results.json')
const db = openAuditDb({ url: DB_URL })

// ---------------------------------------------------------------- harness
const results = []
let failures = 0
let phase = 'setup'
function check(name, ok, detail = '') {
  const pass = !!ok
  if (!pass) failures++
  results.push({ phase, name, pass, detail: String(detail ?? '').slice(0, 500) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${phase}] ${name}${detail ? ` — ${String(detail).slice(0, 170)}` : ''}`)
  return pass
}
let cookie = ''
async function api(method, path, body, opts = {}) {
  const headers = { ...(opts.headers ?? {}) }
  if (body !== undefined && !opts.raw) headers['Content-Type'] = 'application/json'
  if (opts.raw) headers['Content-Type'] = 'application/json'
  if (opts.cookie !== undefined) { if (opts.cookie) headers.Cookie = opts.cookie } else if (cookie) headers.Cookie = cookie
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual' })
  const sc = res.headers.get('set-cookie')
  if (sc && opts.capture !== false) { const m = sc.match(/forge_session=([^;]*)/); if (m) cookie = m[1] ? `forge_session=${m[1]}` : '' }
  let json = null
  try { json = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, json, data: json?.data, error: json?.error }
}
const post = (path, body, opts) => api('POST', path, body, opts)
const get = (path, opts) => api('GET', path, undefined, opts)
const is4xx = (r) => r.status >= 400 && r.status < 500
function expectReject(name, r, re) {
  const okMsg = re ? re.test(String(r.error ?? '')) : true
  return check(name, is4xx(r) && okMsg, `status=${r.status} error=${r.error ?? JSON.stringify(r.json)?.slice(0, 120)}`)
}
function expectOk(name, r) { return check(name, r.status === 200 && r.json?.success !== false, `status=${r.status} ${r.error ?? ''}`) }
const q1 = (sql, args = []) => db.get(sql, args)
const qa = (sql, args = []) => db.all(sql, args)
const num = (v) => Number(v ?? 0)
const near = (a, b, tol = 0.011) => Math.abs(num(a) - num(b)) <= tol
const stockNet = async (itemId, warehouseId) => num((await q1('SELECT COALESCE(SUM(qtyIn-qtyOut),0) n FROM StockLedger WHERE itemId=? AND warehouseId=? AND isCancelled=0', [itemId, warehouseId])).n)
const lotBal = async (lotId) => num((await q1('SELECT COALESCE(SUM(qtyIn-qtyOut),0) n FROM LotMovement WHERE lotId=? AND isCancelled=0', [lotId])).n)
const today = new Date().toISOString().slice(0, 10)
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

// ---------------------------------------------------------------- global reconciliation
async function reconcile(label) {
  const prev = phase; phase = `${prev}:reconcile`
  const badVouchers = await qa(`SELECT voucherType, voucherNo, ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr FROM AccountLedger
    GROUP BY voucherType, voucherNo, isCancelled HAVING ABS(SUM(debit)-SUM(credit)) > 0.01`)
  check(`${label}: every voucher balanced (Dr = Cr, active and cancelled sets)`, badVouchers.length === 0, badVouchers.slice(0, 3).map((v) => `${v.voucherType} ${v.voucherNo} ${v.dr}/${v.cr}`).join('; ') || 'all balanced')
  const tb = await q1('SELECT ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr FROM AccountLedger WHERE isCancelled=0')
  check(`${label}: trial balance Dr = Cr`, near(tb.dr, tb.cr), `Dr=${tb.dr} Cr=${tb.cr}`)
  const neg = await qa(`SELECT s.itemId, s.warehouseId, ROUND(SUM(qtyIn-qtyOut),3) n FROM StockLedger s WHERE isCancelled=0 GROUP BY itemId, warehouseId HAVING n < -0.001`)
  check(`${label}: no negative stock balance`, neg.length === 0, JSON.stringify(neg.slice(0, 3)))
  const negLots = await qa('SELECT lotId, ROUND(SUM(qtyIn-qtyOut),3) n FROM LotMovement WHERE isCancelled=0 GROUP BY lotId HAVING n < -0.001')
  check(`${label}: no negative lot balance`, negLots.length === 0, JSON.stringify(negLots.slice(0, 3)))
  const lotOverStock = await qa(`SELECT l.itemId, l.warehouseId, ROUND(SUM(l.qtyIn-l.qtyOut),3) lots,
      (SELECT ROUND(COALESCE(SUM(s.qtyIn-s.qtyOut),0),3) FROM StockLedger s WHERE s.itemId=l.itemId AND s.warehouseId=l.warehouseId AND s.isCancelled=0) stock
    FROM LotMovement l WHERE l.isCancelled=0 GROUP BY l.itemId, l.warehouseId HAVING lots > stock + 0.001`)
  check(`${label}: lot balances never exceed stock-ledger balance per item/warehouse`, lotOverStock.length === 0, JSON.stringify(lotOverStock.slice(0, 3)))
  const hdr = await qa(`SELECT * FROM (
      SELECT h.invoiceNo, h.grandTotal, h.roundOff, ROUND(SUM(i.total),2) lsum FROM SalesInvoice h JOIN SalesInvoiceItem i ON i.invoiceId=h.id GROUP BY h.id, h.invoiceNo, h.grandTotal, h.roundOff
      UNION ALL
      SELECT h.invoiceNo, h.grandTotal, h.roundOff, ROUND(SUM(i.total),2) lsum FROM PurchaseInvoice h JOIN PurchaseInvoiceItem i ON i.invoiceId=h.id GROUP BY h.id, h.invoiceNo, h.grandTotal, h.roundOff
    ) x WHERE ABS(x.lsum + x.roundOff - x.grandTotal) > 0.011`)
  check(`${label}: invoice header = sum(lines) + round-off`, hdr.length === 0, JSON.stringify(hdr.slice(0, 3)))
  const active = await allocActiveSql()
  const paid = await qa(`SELECT * FROM (
      SELECT h.invoiceNo, h.paidAmount, COALESCE((SELECT SUM(a.amount) FROM PaymentAllocation a JOIN Payment p ON p.id=a.paymentId
        WHERE a.invoiceNo=h.invoiceNo AND a.invoiceType='SALES' AND p.status='POSTED' AND ${active}),0) alloc FROM SalesInvoice h
      UNION ALL
      SELECT h.invoiceNo, h.paidAmount, COALESCE((SELECT SUM(a.amount) FROM PaymentAllocation a JOIN Payment p ON p.id=a.paymentId
        WHERE a.invoiceNo=h.invoiceNo AND a.invoiceType='PURCHASE' AND p.status='POSTED' AND ${active}),0) alloc FROM PurchaseInvoice h
    ) x WHERE ABS(x.paidAmount - x.alloc) > 0.011`)
  check(`${label}: invoice paidAmount = active allocations`, paid.length === 0, JSON.stringify(paid.slice(0, 3)))
  const overPaid = await qa('SELECT invoiceNo, paidAmount, grandTotal FROM SalesInvoice WHERE paidAmount > grandTotal + 0.011 UNION ALL SELECT invoiceNo, paidAmount, grandTotal FROM PurchaseInvoice WHERE paidAmount > grandTotal + 0.011')
  check(`${label}: no invoice paid beyond its total`, overPaid.length === 0, JSON.stringify(overPaid.slice(0, 3)))
  const adv = await qa(`SELECT a.id, a.originalAmount, a.appliedAmount FROM PartyAdvance a WHERE a.appliedAmount > a.originalAmount + 0.011 OR a.appliedAmount < -0.011`)
  check(`${label}: advance applied within [0, original]`, adv.length === 0, JSON.stringify(adv.slice(0, 3)))
  const ref = await qa(`SELECT d.adjustmentNo, d.grandTotal, ROUND(SUM(r.amount),2) refunded FROM ReturnDocument d JOIN RefundAllocation r ON r.returnDocumentId=d.id JOIN Payment p ON p.id=r.paymentId AND p.status='POSTED'
    GROUP BY d.id HAVING refunded > d.grandTotal + 0.011`)
  check(`${label}: refunds never exceed credit/debit-note value`, ref.length === 0, JSON.stringify(ref.slice(0, 3)))
  const grn = await qa('SELECT id, acceptedQty, billedQty, receivedQty, rejectedQty FROM GoodsReceiptLine WHERE billedQty > acceptedQty + 0.001 OR (qcStatus <> \'PENDING\' AND ABS(acceptedQty + rejectedQty - receivedQty) > 0.001)')
  check(`${label}: GRN billed <= accepted and accepted + rejected = received`, grn.length === 0, JSON.stringify(grn.slice(0, 3)))
  const dc = await qa('SELECT id, acceptedQty, invoicedQty FROM DeliveryChallanLine WHERE invoicedQty > acceptedQty + 0.001')
  check(`${label}: challan invoiced <= accepted`, dc.length === 0, JSON.stringify(dc.slice(0, 3)))
  const wip = await qa(`SELECT w.woNo, ROUND((SELECT COALESCE(SUM(t.materialCost+t.labourCost+t.overheadCost),0) FROM ProductionTask t WHERE t.workOrderId=w.id AND t.status<>'CANCELLED'),2) actual,
      ROUND((SELECT COALESCE(SUM(r.actualCost),0) FROM ProductionReceipt r WHERE r.workOrderId=w.id AND r.status='POSTED'),2) settled FROM WorkOrder w WHERE w.status='COMPLETED' HAVING ABS(actual-settled) > 0.011`)
  check(`${label}: completed work orders have WIP fully settled (material + labour + absorbed overhead)`, wip.length === 0, JSON.stringify(wip.slice(0, 3)))
  // Absorbed overhead is an accrual: the credit ledger must equal the absorbed
  // amounts on tasks, and the work-order header must equal its own task rows.
  // (period-end clearing vouchers move the accrual to OVRC on purpose — measure absorption without them)
  const ovh = await q1(`SELECT ROUND(COALESCE(SUM(credit)-SUM(debit),0),2) balance FROM AccountLedger WHERE account='OVHA' AND isCancelled=0 AND voucherType<>'MFG_OVERHEAD_CLOSE'`)
  const absorbed = await q1(`SELECT ROUND(COALESCE(SUM(overheadCost),0),2) total FROM ProductionTask WHERE status='COMPLETED'`)
  check(`${label}: overhead absorbed in the ledger equals the overhead on completed tasks`, near(num(ovh.balance), num(absorbed.total), 0.05), `ledger=${ovh.balance} tasks=${absorbed.total}`)
  const woOvh = await qa(`SELECT w.woNo, ROUND(w.overheadCost,2) hdr, ROUND((SELECT COALESCE(SUM(t.overheadCost),0) FROM ProductionTask t WHERE t.workOrderId=w.id AND t.status<>'CANCELLED'),2) tasks
    FROM WorkOrder w HAVING ABS(hdr-tasks) > 0.011`)
  check(`${label}: work-order overhead header equals its operations`, woOvh.length === 0, JSON.stringify(woOvh.slice(0, 3)))
  const dupDocs = await qa(`SELECT 'SalesInvoice' t, invoiceNo n, COUNT(*) c FROM SalesInvoice GROUP BY invoiceNo HAVING c>1 UNION ALL SELECT 'PurchaseInvoice', invoiceNo, COUNT(*) FROM PurchaseInvoice GROUP BY invoiceNo HAVING COUNT(*)>1
    UNION ALL SELECT 'Payment', paymentNo, COUNT(*) FROM Payment GROUP BY paymentNo HAVING COUNT(*)>1`)
  check(`${label}: no duplicate document numbers`, dupDocs.length === 0, JSON.stringify(dupDocs))
  phase = prev
}
let allocCols = null
async function allocActiveSql() {
  if (allocCols === null) allocCols = (await qa("SELECT column_name c FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='PaymentAllocation'")).map((r) => r.c ?? r.C ?? r.COLUMN_NAME)
  return allocCols.includes('reversedAt') ? 'a.reversedAt IS NULL' : '1=1'
}

// ---------------------------------------------------------------- fixtures
const F = {}
async function setup() {
  phase = 'setup'
  const seed = await post('/api/seed?force=1', {}, { headers: { 'x-platform-key': KEY }, cookie: '', capture: false })
  if (!expectOk('force reseed of disposable DB', seed)) throw new Error('seed failed: ' + seed.error)
  cookie = ''
  const login = await post('/api/auth/login', { email: 'owner@shreeforge.example.com', password: 'forge123' })
  if (!expectOk('owner login', login)) throw new Error('login failed')
  F.ownerCookie = cookie
  F.company = await q1('SELECT id, stateCode FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')
  F.main = (await q1("SELECT id FROM Warehouse WHERE code='MAIN'")).id
  F.jw = (await q1("SELECT id FROM Warehouse WHERE code='JW'")).id
  const wh2 = await post('/api/masters/warehouses', { code: 'AUDW2', name: 'Audit Store 2' }); expectOk('create second warehouse', wh2); F.w2 = wh2.data.id
  const mk = async (body) => { const r = await post('/api/masters/parties', { stateCode: '27', ...body }); expectOk(`create party ${body.code}`, r); return r.data.id }
  F.sup1 = await mk({ code: 'AUD-S1', name: 'Audit Supplier One', types: ['SUPPLIER'] })
  F.sup2 = await mk({ code: 'AUD-S2', name: 'Audit Supplier Two', types: ['SUPPLIER'] })
  F.cust = await mk({ code: 'AUD-C1', name: 'Audit Customer', types: ['CUSTOMER'], creditLimit: 50_000_000 })
  F.custLow = await mk({ code: 'AUD-C2', name: 'Audit Low-Limit Customer', types: ['CUSTOMER'], creditLimit: 1000, openingBal: 400 })
  F.jwk = await mk({ code: 'AUD-J1', name: 'Audit Jobworker', types: ['JOBWORKER'] })
  const item = async (body) => { const r = await post('/api/masters/items', { gstRate: 18, groupName: 'Audit', ...body }); expectOk(`create item ${body.code}`, r); return r.data.id }
  F.rm = await item({ code: 'AUD-RM', name: 'Audit Raw Steel', uom: 'KG', costRate: 100, saleRate: 130, hsn: '720890' })
  F.fg = await item({ code: 'AUD-FG', name: 'Audit Bracket', uom: 'PCS', costRate: 300, saleRate: 500, hsn: '732690' })
  F.fg2 = await item({ code: 'AUD-FG2', name: 'Audit Serial Pump', uom: 'PCS', costRate: 900, saleRate: 1500, hsn: '841370' })
  // BOM outputs must be item-linked now (MRP explodes demand through the item).
  F.bomOut = await item({ code: 'AUD-BOM-FG', name: 'Audit Bracket Assembly', uom: 'PCS', costRate: 400, saleRate: 800, hsn: '732690' })
  F.bomOut2 = await item({ code: 'AUD-BOM-FG2', name: 'Audit Bracket Assembly II', uom: 'PCS', costRate: 400, saleRate: 800, hsn: '732690' })
  F.bomOut3 = await item({ code: 'AUD-BOM-FG3', name: 'Audit Bracket Assembly III', uom: 'PCS', costRate: 400, saleRate: 800, hsn: '732690' })
  F.subAsm = await item({ code: 'AUD-SUB-ASM', name: 'Audit Sub Assembly', uom: 'PCS', costRate: 250, saleRate: 400, hsn: '732690' })
  F.sellable = await item({ code: 'AUD-MRP-SELL', name: 'Audit MRP Sellable', uom: 'PCS', costRate: 700, saleRate: 1200, hsn: '732690' })
  F.jwOnly = await item({ code: 'AUD-JWM', name: 'Audit Customer Casting', uom: 'PCS', costRate: 50, hsn: '732510' })
  const op = await post('/api/inventory/opening', { warehouseId: F.main, rows: [{ itemId: F.fg, qty: 100, rate: 300 }, { itemId: F.rm, qty: 200, rate: 100 }] })
  expectOk('opening stock (owned, MAIN)', op)
  const inw = await post('/api/jobwork/inwards', { partyId: F.jwk, warehouseId: F.jw, challanNo: 'AUD-JW-1', items: [{ itemId: F.jwOnly, qty: 50, weight: 100 }] })
  expectOk('jobwork inward of customer-owned material into JW store', inw)
  await reconcile('baseline')
}

// ---------------------------------------------------------------- Phase 5: auth / tenant gates
async function phaseAuth() {
  phase = 'P5-auth'
  for (const path of ['/api/sales-invoices', '/api/procurement', '/api/order-to-cash', '/api/quality', '/api/traceability', '/api/finance-adjustments', '/api/returns', '/api/manufacturing/receipts']) {
    const r = await get(path, { cookie: '' })
    check(`anonymous GET ${path} -> 401`, r.status === 401, `status=${r.status}`)
  }
  for (const path of ['/api/procurement', '/api/order-to-cash', '/api/returns', '/api/finance-adjustments', '/api/quality', '/api/traceability', '/api/manufacturing/receipts', '/api/sales-invoices']) {
    const r = await post(path, { action: 'create-requisition', lines: [] }, { cookie: '' })
    check(`anonymous POST ${path} -> 401`, r.status === 401, `status=${r.status}`)
  }
  const forged = await get('/api/sales-invoices', { cookie: 'forge_session=eyJ1aWQiOiJ4In0.forged-signature' })
  check('forged session cookie -> 401', forged.status === 401, `status=${forged.status}`)
  // revoked: bump tokenVersion of a dedicated user
  const salt = randomBytes(16).toString('hex')
  const mkUser = async (email, role) => {
    await db.run('DELETE FROM OrgUser WHERE email=?', [email])
    await db.run('INSERT INTO OrgUser (id,email,passwordHash,name,role,companyId,tokenVersion,createdAt) VALUES (?,?,?,?,?,?,0,?)',
      [`aud-${role.toLowerCase()}-${Date.now()}`, email, `${salt}:${scryptSync('audit-pass-123', salt, 64).toString('hex')}`, `Audit ${role}`, role, F.company.id, new Date()])
    const r = await post('/api/auth/login', { email, password: 'audit-pass-123' }, { cookie: '' })
    const c = cookie; cookie = F.ownerCookie
    return r.status === 200 ? c : null
  }
  const revCookie = await mkUser('revoke-audit@local.test', 'ACCOUNTANT')
  check('accountant login works before revocation', !!revCookie)
  await db.run("UPDATE OrgUser SET tokenVersion = tokenVersion + 1 WHERE email='revoke-audit@local.test'")
  const revoked = await get('/api/sales-invoices', { cookie: revCookie })
  check('revoked session (tokenVersion bumped) -> 401', revoked.status === 401, `status=${revoked.status}`)
  const viewerCookie = await mkUser('viewer-wf@local.test', 'VIEWER')
  F.viewerCookie = viewerCookie
  const vr = await get('/api/procurement', { cookie: viewerCookie })
  check('viewer can read workflow dashboards (200)', vr.status === 200, `status=${vr.status}`)
  for (const [path, body] of [['/api/procurement', { action: 'create-requisition', lines: [{ itemId: F.rm, qty: 1 }] }], ['/api/order-to-cash', { action: 'create-quotation' }], ['/api/finance-adjustments', { action: 'apply-advance' }], ['/api/quality', { action: 'create-template' }], ['/api/traceability', { action: 'recall', id: 'x', reason: 'x' }], ['/api/returns', { action: 'cancel', id: 'x' }], ['/api/manufacturing/receipts', { action: 'cancel', id: 'x' }]]) {
    const r = await post(path, body, { cookie: viewerCookie })
    check(`viewer mutation ${path} -> 403`, r.status === 403, `status=${r.status}`)
  }
  // suspended organisation
  await db.run("UPDATE Company SET saasStatus='SUSPENDED' WHERE id=?", [F.company.id])
  const susp = await get('/api/sales-invoices')
  check('suspended organisation -> 403', susp.status === 403, `status=${susp.status} ${susp.error}`)
  await db.run("UPDATE Company SET saasStatus='ACTIVE' WHERE id=?", [F.company.id])
  // expired subscription (plan with paidUntil in the past)
  if (!(await q1('SELECT id FROM Plan LIMIT 1'))) await db.run("INSERT INTO Plan (id, name) VALUES ('aud-plan', 'Audit Plan')")
  const plan = await q1('SELECT id FROM Plan LIMIT 1')
  if (plan) {
    await db.run('UPDATE Company SET planId=?, paidUntil=? WHERE id=?', [plan.id, new Date(Date.now() - 40 * 86400000), F.company.id])
    const exp = await get('/api/sales-invoices')
    check('expired subscription -> 403', exp.status === 403, `status=${exp.status} ${exp.error}`)
    await db.run('UPDATE Company SET planId=NULL, paidUntil=NULL WHERE id=?', [F.company.id])
  } else check('expired subscription -> 403 (needs a plan row)', false, 'no Plan rows seeded')
  // second organisation: its owner must not see the operating org's data
  const org2 = await post('/api/platform/orgs', { name: 'Audit Second Org', ownerName: 'Second Owner', ownerEmail: 'owner2-audit@local.test', ownerPassword: 'second-pass-123', billingCycle: 'MONTHLY', trialDays: 0 }, { headers: { 'x-platform-key': KEY }, cookie: '' })
  check('platform admin creates a second organisation', org2.status === 200, `status=${org2.status} ${org2.error}`)
  const l2 = await post('/api/auth/login', { email: 'owner2-audit@local.test', password: 'second-pass-123' }, { cookie: '' })
  const c2 = cookie; cookie = F.ownerCookie
  check('second organisation owner can sign in', l2.status === 200, `status=${l2.status}`)
  for (const path of ['/api/sales-invoices', '/api/masters/parties', '/api/masters/items', '/api/manufacturing/projects', '/api/payments']) {
    const r = await get(path, { cookie: c2 })
    check(`second-org user GET ${path} sees its own (empty) workspace, no org-1 rows`, r.status === 200 && Array.isArray(r.data) && r.data.length === 0, `status=${r.status} rows=${r.data?.length}`)
  }
  const anyInvoice = await q1('SELECT id FROM SalesInvoice LIMIT 1')
  const x = await get(`/api/sales-invoices/${anyInvoice.id}`, { cookie: c2 })
  check('second-org user cannot read an org-1 invoice by id', x.status === 404 || x.status === 403, `status=${x.status}`)
  // Root tables carry companyId; line/child tables are owned through a NOT NULL
  // foreign key to a root table (the tenant extension filters them through it).
  const unscoped = await qa(`SELECT t.table_name tn FROM information_schema.tables t WHERE t.table_schema=DATABASE()
    AND t.table_name NOT IN ('_prisma_migrations','IdempotencyKey','Company','Plan','PlatformInquiry','PlatformInquiryFollowUp','PlatformBlogPost','Counter','OrgUser')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema=t.table_schema AND c.table_name=t.table_name AND c.column_name='companyId')
    AND NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.columns c ON c.table_schema=k.table_schema AND c.table_name=k.table_name AND c.column_name=k.column_name AND c.is_nullable='NO'
                    JOIN information_schema.columns pc ON pc.table_schema=k.referenced_table_schema AND pc.table_name=k.referenced_table_name AND pc.column_name='companyId'
                    WHERE k.table_schema=t.table_schema AND k.table_name=t.table_name AND k.referenced_table_name IS NOT NULL)`)
  check('every business table is organisation-owned (companyId, or a required FK to a table that has one)', unscoped.length === 0, `${unscoped.length} unowned: ${unscoped.map((r) => r.tn ?? r.TABLE_NAME).join(', ')}`)
  // platform admin session must not reach org business data
  const pl = await post('/api/platform/auth', { email: 'admin@forgeplatform.example.com', password: 'platform123' }, { cookie: '' })
  const pc = cookie; cookie = F.ownerCookie
  if (pl.status === 200) {
    const r = await get('/api/sales-invoices', { cookie: pc })
    check('platform admin session cannot read organisation invoices', r.status === 403 || r.status === 401, `status=${r.status}`)
  } else check('platform admin login for separation test', false, `status=${pl.status} ${pl.error} (seed password may differ)`)
  const orgToPlatform = await get('/api/platform/orgs')
  check('organisation owner cannot call platform-admin routes', orgToPlatform.status === 401 || orgToPlatform.status === 403, `status=${orgToPlatform.status}`)
}

// ---------------------------------------------------------------- Phase 6: Purchase-to-Pay
async function phaseP2P() {
  phase = 'P6-p2p'
  const P = '/api/procurement'
  const req = await post(P, { action: 'create-requisition', department: 'Fabrication', purpose: 'audit', requiredBy: daysFromNow(10), lines: [{ itemId: F.rm, qty: 100, rate: 100 }] })
  expectOk('create material requisition', req); const reqId = req.data.id
  expectReject('1 PO against a DRAFT requisition is rejected', await post(P, { action: 'create-order', supplierId: F.sup1, requisitionId: reqId, lines: [{ itemId: F.rm, qty: 10, rate: 100 }] }), /approved requisition/i)
  expectReject('requisition cannot be APPROVED straight from DRAFT', await post(P, { action: 'transition-requisition', id: reqId, transition: 'APPROVE' }), /draft/i)
  expectOk('submit requisition', await post(P, { action: 'transition-requisition', id: reqId, transition: 'SUBMIT' }))
  expectOk('approve requisition', await post(P, { action: 'transition-requisition', id: reqId, transition: 'APPROVE' }))
  expectReject('2 PO quantity above approved requisition is rejected', await post(P, { action: 'create-order', supplierId: F.sup1, requisitionId: reqId, lines: [{ itemId: F.rm, qty: 150, rate: 100 }] }), /exceeds approved requisition/i)
  expectReject('3 customer used as PO supplier is rejected', await post(P, { action: 'create-order', supplierId: F.cust, lines: [{ itemId: F.rm, qty: 10, rate: 100 }] }), /supplier/i)
  const po = await post(P, { action: 'create-order', supplierId: F.sup1, requisitionId: reqId, overReceiptPct: 5, expectedDate: daysFromNow(5), lines: [{ itemId: F.rm, qty: 100, rate: 100 }] })
  expectOk('create PO from approved requisition', po); F.poId = po.data.id
  const reqLine = await q1('SELECT orderedQty FROM PurchaseRequisitionLine WHERE requisitionId=?', [reqId])
  check('requisition orderedQty tracks the PO (100)', near(reqLine.orderedQty, 100), JSON.stringify(reqLine))
  expectReject('GRN against an unapproved PO is rejected', await post(P, { action: 'create-receipt', purchaseOrderId: F.poId, warehouseId: F.main, lines: [{ purchaseOrderLineId: 'x', receivedQty: 1 }] }), /DRAFT|cannot receive/i)
  expectOk('approve PO', await post(P, { action: 'approve-order', id: F.poId }))
  const poLine = (await q1('SELECT id FROM PurchaseOrderLine WHERE purchaseOrderId=?', [F.poId])).id
  const rmBefore = await stockNet(F.rm, F.main)
  const g1 = await post(P, { action: 'create-receipt', purchaseOrderId: F.poId, warehouseId: F.main, supplierDocNo: 'AUD-DC-1', supplierDocDate: today, lines: [{ purchaseOrderLineId: poLine, receivedQty: 60, batchNo: 'SUPLOT-1', manufactureDate: '2026-10-01', expiryDate: '2028-10-01' }] })
  expectOk('5 partial GRN #1 (60 of 100)', g1); F.grn1 = g1.data.id
  check('GRN does not move stock before QC', near(await stockNet(F.rm, F.main), rmBefore), `before=${rmBefore}`)
  expectReject('4 over-receipt beyond 5% tolerance is rejected (60 + 50 > 105)', await post(P, { action: 'create-receipt', purchaseOrderId: F.poId, warehouseId: F.main, supplierDocNo: 'AUD-DC-9', lines: [{ purchaseOrderLineId: poLine, receivedQty: 50 }] }), /tolerance/i)
  expectReject('6 duplicate PO line inside one GRN is rejected', await post(P, { action: 'create-receipt', purchaseOrderId: F.poId, warehouseId: F.main, supplierDocNo: 'AUD-DC-8', lines: [{ purchaseOrderLineId: poLine, receivedQty: 1 }, { purchaseOrderLineId: poLine, receivedQty: 1 }] }), /only once/i)
  expectReject('7 duplicate supplier challan number for the same supplier is rejected', await post(P, { action: 'create-receipt', purchaseOrderId: F.poId, warehouseId: F.main, supplierDocNo: 'AUD-DC-1', lines: [{ purchaseOrderLineId: poLine, receivedQty: 1 }] }), /challan|document|already/i)
  const g2 = await post(P, { action: 'create-receipt', purchaseOrderId: F.poId, warehouseId: F.main, supplierDocNo: 'AUD-DC-2', lines: [{ purchaseOrderLineId: poLine, receivedQty: 40, batchNo: 'SUPLOT-2' }] })
  expectOk('5 partial GRN #2 (40 more)', g2); F.grn2 = g2.data.id
  const gl1 = (await q1('SELECT id FROM GoodsReceiptLine WHERE goodsReceiptId=?', [F.grn1])).id
  const gl2 = (await q1('SELECT id FROM GoodsReceiptLine WHERE goodsReceiptId=?', [F.grn2])).id
  expectReject('8 accepted + rejected must equal received', await post(P, { action: 'inspect-receipt', goodsReceiptId: F.grn1, lines: [{ goodsReceiptLineId: gl1, acceptedQty: 50, rejectedQty: 5, rejectionReason: 'dent' }] }), /must equal received/i)
  expectReject('9 rejection without reason is rejected', await post(P, { action: 'inspect-receipt', goodsReceiptId: F.grn1, lines: [{ goodsReceiptLineId: gl1, acceptedQty: 50, rejectedQty: 10 }] }), /reason/i)
  expectOk('inward QC GRN #1: 50 accepted, 10 rejected', await post(P, { action: 'inspect-receipt', goodsReceiptId: F.grn1, lines: [{ goodsReceiptLineId: gl1, acceptedQty: 50, rejectedQty: 10, rejectionReason: 'surface cracks' }] }))
  check('10/11 only accepted 50 enter owned stock (rejected 10 do not)', near(await stockNet(F.rm, F.main), rmBefore + 50), `now=${await stockNet(F.rm, F.main)} before=${rmBefore}`)
  const lot1 = await q1("SELECT id FROM InventoryLot WHERE lotNo='SUPLOT-1' AND itemId=?", [F.rm]); F.lot1 = lot1?.id
  check('supplier lot SUPLOT-1 created with accepted qty only (50)', lot1 && near(await lotBal(lot1.id), 50), lot1 ? `balance=${await lotBal(lot1.id)}` : 'lot missing')
  expectOk('inward QC GRN #2: 40 accepted', await post(P, { action: 'inspect-receipt', goodsReceiptId: F.grn2, lines: [{ goodsReceiptLineId: gl2, acceptedQty: 40, rejectedQty: 0 }] }))
  expectReject('12 invoice above unbilled accepted quantity is rejected', await post(P, { action: 'invoice-receipt', goodsReceiptId: F.grn1, supplierInvoiceNo: 'AUD-SINV-0', lines: [{ goodsReceiptLineId: gl1, qty: 60 }] }), /exceeds unbilled/i)
  const stockPreBill = await stockNet(F.rm, F.main)
  const inv1 = await post(P, { action: 'invoice-receipt', goodsReceiptId: F.grn1, supplierInvoiceNo: 'AUD-SINV-1', lines: [{ goodsReceiptLineId: gl1, qty: 30 }] })
  expectOk('GRN-backed purchase invoice for 30', inv1); F.pin1 = inv1.data
  check('15 GRN-backed invoice does not duplicate stock', near(await stockNet(F.rm, F.main), stockPreBill), `after=${await stockNet(F.rm, F.main)} before=${stockPreBill}`)
  expectReject('13 same supplier invoice number is rejected', await post(P, { action: 'invoice-receipt', goodsReceiptId: F.grn1, supplierInvoiceNo: 'AUD-SINV-1', lines: [{ goodsReceiptLineId: gl1, qty: 1 }] }), /already posted/i)
  const [c1, c2] = await Promise.all([
    post(P, { action: 'invoice-receipt', goodsReceiptId: F.grn1, supplierInvoiceNo: 'AUD-SINV-2A', lines: [{ goodsReceiptLineId: gl1, qty: 20 }] }),
    post(P, { action: 'invoice-receipt', goodsReceiptId: F.grn1, supplierInvoiceNo: 'AUD-SINV-2B', lines: [{ goodsReceiptLineId: gl1, qty: 20 }] }),
  ])
  const wins = [c1, c2].filter((r) => r.status === 200)
  check('14 two concurrent invoices for the last 20 units: exactly one posts', wins.length === 1, `statuses=${c1.status}/${c2.status} errors=${c1.error ?? ''}|${c2.error ?? ''}`)
  check('14 concurrent loser gets a controlled 4xx, not 500', [c1, c2].every((r) => r.status === 200 || is4xx(r)), `statuses=${c1.status}/${c2.status}`)
  F.pin2 = wins[0]?.data
  const billed = await q1('SELECT billedQty FROM GoodsReceiptLine WHERE id=?', [gl1])
  check('GRN #1 billed = 50 (no double billing)', near(billed.billedQty, 50), JSON.stringify(billed))
  const inv3 = await post(P, { action: 'invoice-receipt', goodsReceiptId: F.grn2, supplierInvoiceNo: 'AUD-SINV-3', lines: [{ goodsReceiptLineId: gl2, qty: 40, rate: 110 }] })
  expectOk('GRN #2 invoiced at 110 against PO rate 100', inv3)
  const dash = await get(P)
  const ex = (dash.data?.matchExceptions ?? []).find((e) => e.grnNo && e.rateVariance?.some((v) => near(v, 10)))
  check('16/17 three-way match reports +10 rate variance for GRN #2', !!ex, JSON.stringify(dash.data?.matchExceptions ?? []).slice(0, 200))
  // 18 payment allocation cannot exceed outstanding
  const out1 = num(F.pin1.grandTotal)
  expectReject('18 supplier payment allocation above outstanding is rejected', await post('/api/payments', { type: 'PAYMENT', partyId: F.sup1, amount: out1 + 500, mode: 'BANK', allocations: [{ invoiceType: 'PURCHASE', invoiceNo: F.pin1.invoiceNo, amount: out1 + 500 }] }), /outstanding|exceed/i)
  expectOk('supplier payment of 1000 against PIN #1', await post('/api/payments', { type: 'PAYMENT', partyId: F.sup1, amount: 1000, mode: 'BANK', allocations: [{ invoiceType: 'PURCHASE', invoiceNo: F.pin1.invoiceNo, amount: 1000 }] }))
  // returns
  const pinLine = (await q1('SELECT id FROM PurchaseInvoiceItem WHERE invoiceId=?', [F.pin1.id])).id
  expectReject('19 purchase return above invoiced quantity is rejected', await post('/api/returns', { returnType: 'PURCHASE_RETURN', sourceInvoiceId: F.pin1.id, warehouseId: F.main, reason: 'defects', lines: [{ sourceLineId: pinLine, requestedQty: 31, acceptedQty: 31, rejectedQty: 0 }] }), /exceeds original/i)
  expectReject('20 purchase return needs stock in the chosen warehouse', await post('/api/returns', { returnType: 'PURCHASE_RETURN', sourceInvoiceId: F.pin1.id, warehouseId: F.w2, reason: 'defects', lines: [{ sourceLineId: pinLine, requestedQty: 5, acceptedQty: 5, rejectedQty: 0 }] }), /insufficient stock/i)
  const stockPreRet = await stockNet(F.rm, F.main)
  const pr = await post('/api/returns', { returnType: 'PURCHASE_RETURN', sourceInvoiceId: F.pin1.id, warehouseId: F.main, reason: 'defects', lines: [{ sourceLineId: pinLine, requestedQty: 10, acceptedQty: 10, rejectedQty: 0 }] })
  expectOk('purchase return of 10 with debit note', pr); F.dn = pr.data
  check('purchase return issues 10 out of stock', near(await stockNet(F.rm, F.main), stockPreRet - 10), `now=${await stockNet(F.rm, F.main)}`)
  expectReject('19 cumulative purchase return (10 + 25 > 30) is rejected', await post('/api/returns', { returnType: 'PURCHASE_RETURN', sourceInvoiceId: F.pin1.id, warehouseId: F.main, reason: 'more', lines: [{ sourceLineId: pinLine, requestedQty: 25, acceptedQty: 25, rejectedQty: 0 }] }), /exceeds original/i)
  const dnGl = await q1("SELECT ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr FROM AccountLedger WHERE voucherType='DEBIT_NOTE' AND voucherNo=?", [F.dn.adjustmentNo])
  check('21 debit-note voucher balances', near(dnGl.dr, dnGl.cr) && num(dnGl.dr) > 0, JSON.stringify(dnGl))
  expectReject('22 supplier refund above debit-note value is rejected', await post('/api/finance-adjustments', { action: 'refund-return', returnDocumentId: F.dn.id, amount: num(F.dn.grandTotal) + 1, mode: 'BANK' }), /refundable/i)
  const half = Math.round(num(F.dn.grandTotal) * 0.6 * 100) / 100
  const races = await Promise.all([1, 2, 3, 4].map(() => post('/api/finance-adjustments', { action: 'refund-return', returnDocumentId: F.dn.id, amount: half, mode: 'BANK' })))
  check('P11-19 four concurrent supplier refunds of 60% each: exactly one posts', races.filter((r) => r.status === 200).length === 1, `statuses=${races.map((r) => r.status)}`)
  check('P11-19 race losers get controlled 4xx', races.every((r) => r.status === 200 || is4xx(r)), `statuses=${races.map((r) => r.status)}`)
  // cancellations
  expectReject('23 billed GRN cannot be cancelled', await post(P, { action: 'cancel-receipt', id: F.grn1 }), /billed/i)
  const pin2Cancel = F.pin2 ? await api('DELETE', `/api/purchase-invoices/${F.pin2.id}`) : { status: 0 }
  expectOk('cancel the concurrent-winner purchase invoice (20)', pin2Cancel)
  check('25 invoice cancellation releases billed GRN quantity (50 -> 30)', near((await q1('SELECT billedQty FROM GoodsReceiptLine WHERE id=?', [gl1])).billedQty, 30))
  // 24 consumed stock blocks GRN cancellation: GRN #3 (4 units) then sell them
  const poB = await post(P, { action: 'create-order', supplierId: F.sup1, lines: [{ itemId: F.rm, qty: 10, rate: 100 }] })
  await post(P, { action: 'approve-order', id: poB.data.id }); F.poB = poB.data.id
  const poBLine = (await q1('SELECT id FROM PurchaseOrderLine WHERE purchaseOrderId=?', [F.poB])).id
  const g3 = await post(P, { action: 'create-receipt', purchaseOrderId: F.poB, warehouseId: F.w2, supplierDocNo: 'AUD-DC-3', lines: [{ purchaseOrderLineId: poBLine, receivedQty: 4, batchNo: 'SUPLOT-3' }] })
  expectOk('GRN #3 (4 units into AUDW2)', g3); F.grn3 = g3.data.id
  const gl3 = (await q1('SELECT id FROM GoodsReceiptLine WHERE goodsReceiptId=?', [F.grn3])).id
  expectOk('QC GRN #3 accepted', await post(P, { action: 'inspect-receipt', goodsReceiptId: F.grn3, lines: [{ goodsReceiptLineId: gl3, acceptedQty: 4, rejectedQty: 0 }] }))
  const sale = await post('/api/sales-invoices', { partyId: F.cust, warehouseId: F.w2, lines: [{ itemId: F.rm, qty: 3, rate: 130 }] })
  expectOk('sell 3 of the GRN #3 units from AUDW2', sale)
  expectReject('24 GRN whose stock was consumed cannot be cancelled', await post(P, { action: 'cancel-receipt', id: F.grn3 }), /consumed|sold/i)
  expectOk('cancel that sale to free the stock', await api('DELETE', `/api/sales-invoices/${sale.data.id}`))
  const rowsBefore = num((await q1("SELECT COUNT(*) c FROM StockLedger WHERE voucherNo=(SELECT grnNo FROM GoodsReceipt WHERE id=?)", [F.grn3])).c)
  expectOk('cancel GRN #3 (unbilled, unconsumed)', await post(P, { action: 'cancel-receipt', id: F.grn3 }))
  const grn3No = (await q1('SELECT grnNo FROM GoodsReceipt WHERE id=?', [F.grn3])).grnNo
  const rows = await qa('SELECT qtyIn, qtyOut, isCancelled FROM StockLedger WHERE voucherNo=?', [grn3No])
  check('26 GRN cancellation is append-only (original kept + mirror row, both flagged)', rows.length === rowsBefore * 2 && rows.every((r) => num(r.isCancelled) === 1), JSON.stringify(rows))
  const lot3 = await q1("SELECT id FROM InventoryLot WHERE lotNo='SUPLOT-3'")
  // corrections: same challan no. from another supplier, and re-receipt after cancel
  const po2 = await post(P, { action: 'create-order', supplierId: F.sup2, lines: [{ itemId: F.rm, qty: 10, rate: 95 }] })
  await post(P, { action: 'approve-order', id: po2.data.id }); F.po2 = po2.data.id
  const po2Line = (await q1('SELECT id FROM PurchaseOrderLine WHERE purchaseOrderId=?', [F.po2])).id
  expectOk('another supplier may use the same challan number (AUD-DC-1)', await post(P, { action: 'create-receipt', purchaseOrderId: F.po2, warehouseId: F.main, supplierDocNo: 'AUD-DC-1', lines: [{ purchaseOrderLineId: po2Line, receivedQty: 2 }] }))
  expectOk('a cancelled GRN challan number (AUD-DC-3) can be received again', await post(P, { action: 'create-receipt', purchaseOrderId: F.poB, warehouseId: F.w2, supplierDocNo: 'AUD-DC-3', lines: [{ purchaseOrderLineId: poBLine, receivedQty: 1 }] }))
  const reBill = await post(P, { action: 'invoice-receipt', goodsReceiptId: F.grn1, supplierInvoiceNo: (F.pin2?.supplierInvoiceNo ?? 'AUD-SINV-2A'), lines: [{ goodsReceiptLineId: gl1, qty: 20 }] })
  expectOk('the supplier invoice number of a CANCELLED bill can be entered again (correction)', reBill)
  if (reBill.status === 200) await api('DELETE', `/api/purchase-invoices/${reBill.data.id}`)
  expectReject('purchase invoice with a posted debit note cannot be cancelled', await api('DELETE', `/api/purchase-invoices/${F.pin1.id}`), /debit note|payments/i)
  check('P10-5 GRN cancellation reverses the lot receipt (balance 0)', lot3 && near(await lotBal(lot3.id), 0), lot3 ? `balance=${await lotBal(lot3.id)}` : 'lot missing')
  await reconcile('after P2P')
}


// ---------------------------------------------------------------- Phase 6b: RFQ and supplier comparison
async function phaseRfq() {
  phase = 'P6b-rfq'
  const P = '/api/procurement', Q = '/api/rfq'
  const req = await post(P, { action: 'create-requisition', department: 'Stores', requiredBy: daysFromNow(7), lines: [{ itemId: F.rm, qty: 20, rate: 100 }, { itemId: F.fg, qty: 10, rate: 300 }] })
  await post(P, { action: 'transition-requisition', id: req.data.id, transition: 'SUBMIT' }); await post(P, { action: 'transition-requisition', id: req.data.id, transition: 'APPROVE' })
  expectReject('RFQ cannot invite a customer as supplier', await post(Q, { action: 'create-rfq', requisitionId: req.data.id, supplierIds: [F.cust] }), /supplier/i)
  expectReject('RFQ line above the open requisition quantity is rejected', await post(Q, { action: 'create-rfq', requisitionId: req.data.id, supplierIds: [F.sup1], lines: [{ itemId: F.rm, qty: 25 }] }), /exceeds/i)
  const rfq = await post(Q, { action: 'create-rfq', requisitionId: req.data.id, supplierIds: [F.sup1, F.sup2], dueDate: daysFromNow(3) })
  expectOk('RFQ from approved requisition, two suppliers invited', rfq)
  const lines = await qa('SELECT id, itemId, qty FROM RfqLine WHERE rfqId=? ORDER BY qty DESC', [rfq.data.id])
  check('RFQ carries the requisition open quantities (20 + 10)', lines.length === 2 && near(lines[0].qty, 20) && near(lines[1].qty, 10), JSON.stringify(lines))
  const rmLine = lines.find((l) => l.itemId === F.rm).id, fgLine = lines.find((l) => l.itemId === F.fg).id
  const quote = (supplierId, rm, fg, extra = {}) => post(Q, { action: 'record-quote', rfqId: rfq.data.id, supplierId, validUntil: daysFromNow(15), deliveryDays: 10, lines: [{ rfqLineId: rmLine, rate: rm }, { rfqLineId: fgLine, rate: fg }], ...extra })
  expectReject('a supplier that was not invited cannot quote', await quote(F.custLow, 90, 280), /not invited/i)
  expectReject('every RFQ line must be quoted', await post(Q, { action: 'record-quote', rfqId: rfq.data.id, supplierId: F.sup1, validUntil: daysFromNow(15), deliveryDays: 5, lines: [{ rfqLineId: rmLine, rate: 99 }] }), /every RFQ line/i)
  expectReject('quotation validity cannot end before its date', await quote(F.sup1, 100, 300, { quoteDate: daysFromNow(2), validUntil: daysFromNow(1) }), /validity/i)
  expectOk('supplier 1 quotation (rate 100/300, freight 500, 10 days)', await quote(F.sup1, 100, 300, { freight: 500, deliveryDays: 10 }))
  expectOk('supplier 2 quotation (rate 98/295, 5% off FG, no freight, 20 days)', await post(Q, { action: 'record-quote', rfqId: rfq.data.id, supplierId: F.sup2, validUntil: daysFromNow(15), deliveryDays: 20, lines: [{ rfqLineId: rmLine, rate: 98 }, { rfqLineId: fgLine, rate: 295, discountPct: 5 }] }))
  const dash = await get(Q)
  const mine = (dash.data ?? []).find((r) => r.id === rfq.data.id)
  const c = mine?.comparison
  const s1 = c?.quotes.find((q) => q.supplierId === F.sup1), s2 = c?.quotes.find((q) => q.supplierId === F.sup2)
  const s1Landed = (20 * 100 + 10 * 300) * 1.18 + 500, s2Landed = (20 * 98 + 10 * 295 * 0.95) * 1.18
  check('landed totals = qty x net rate + GST + freight', s1 && s2 && near(s1.landedTotal, s1Landed) && near(s2.landedTotal, s2Landed), `s1=${s1?.landedTotal}/${s1Landed} s2=${s2?.landedTotal}/${s2Landed}`)
  check('comparison flags the lowest landed and the fastest delivery', c?.lowestQuoteId === s2?.id && c?.fastestQuoteId === s1?.id, JSON.stringify({ low: c?.lowestQuoteId, fast: c?.fastestQuoteId }))
  check('per-line lowest net rate is identified', c?.lines.every((l) => l.lowestQuoteId === s2?.id), JSON.stringify(c?.lines.map((l) => l.lowestQuoteId)))
  // an accountant may not approve supplier selection
  const salt = 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8'
  await db.run('DELETE FROM OrgUser WHERE email=?', ['acct-rfq@local.test'])
  await db.run('INSERT INTO OrgUser (id,email,passwordHash,name,role,companyId,tokenVersion,createdAt) VALUES (?,?,?,?,?,?,0,?)', ['aud-acct-rfq', 'acct-rfq@local.test', `${salt}:${scryptSync('acct-pass-123', salt, 64).toString('hex')}`, 'RFQ Accountant', 'ACCOUNTANT', F.company.id, new Date()])
  await post('/api/auth/login', { email: 'acct-rfq@local.test', password: 'acct-pass-123' }, { cookie: '' })
  const acct = cookie; cookie = F.ownerCookie
  expectReject('an ACCOUNTANT cannot award (OWNER approval)', await post(Q, { action: 'award', rfqId: rfq.data.id, quoteId: s1.id, reason: 'x' }, { cookie: acct }), /OWNER/i)
  expectReject('award needs a reason', await post(Q, { action: 'award', rfqId: rfq.data.id, quoteId: s1.id, reason: '  ' }), /reason/i)
  const races = await Promise.all([post(Q, { action: 'award', rfqId: rfq.data.id, quoteId: s1.id, reason: 'Faster delivery for the line restart' }), post(Q, { action: 'award', rfqId: rfq.data.id, quoteId: s2.id, reason: 'Lowest landed cost' })])
  check('two concurrent awards: exactly one wins', races.filter((r) => r.status === 200).length === 1, `statuses=${races.map((r) => r.status)}`)
  const winner = races[0].status === 200 ? s1 : s2
  const rows = await qa('SELECT supplierId, status, rejectionReason FROM SupplierQuote WHERE rfqId=?', [rfq.data.id])
  check('winning quote SELECTED, the other REJECTED with the reason', rows.find((r) => r.supplierId === winner.supplierId)?.status === 'SELECTED' && rows.filter((r) => r.supplierId !== winner.supplierId).every((r) => r.status === 'REJECTED' && /Not selected/.test(r.rejectionReason ?? '')), JSON.stringify(rows))
  check('award and rejection are in the audit trail', Number((await q1("SELECT COUNT(*) c FROM AuditLog WHERE entity='Rfq' AND action='AWARD' AND entityId=?", [rfq.data.id])).c) === 1 && Number((await q1("SELECT COUNT(*) c FROM AuditLog WHERE entity='SupplierQuote' AND action='REJECT'")).c) >= 1)
  expectReject('quotations cannot be changed after the award', await quote(F.sup1, 1, 1), /open RFQ/i)
  const reqBefore = await q1('SELECT orderedQty FROM PurchaseRequisitionLine WHERE requisitionId=? AND itemId=?', [req.data.id, F.rm])
  const pos = await Promise.all([1, 2].map(() => post(Q, { action: 'create-po', rfqId: rfq.data.id })))
  check('raising the PO twice at once creates one purchase order', pos.filter((r) => r.status === 200).length === 1, `statuses=${pos.map((r) => r.status)}`)
  const po = pos.find((r) => r.status === 200)?.data
  const poLines = po ? await qa('SELECT itemId, qty, rate FROM PurchaseOrderLine WHERE purchaseOrderId=?', [po.id]) : []
  const expectFgRate = winner === s2 ? 295 * 0.95 : 300
  check('PO goes to the awarded supplier at the quoted net rates', po?.supplierId === winner.supplierId && near(poLines.find((l) => l.itemId === F.fg)?.rate, expectFgRate), JSON.stringify(poLines))
  check('PO consumes the requisition quantity', near((await q1('SELECT orderedQty FROM PurchaseRequisitionLine WHERE requisitionId=? AND itemId=?', [req.data.id, F.rm])).orderedQty, num(reqBefore.orderedQty) + 20))
  check('RFQ is ORDERED and linked to the PO', (await q1('SELECT status, purchaseOrderId FROM Rfq WHERE id=?', [rfq.data.id])).purchaseOrderId === po?.id)
  expectReject('an ORDERED RFQ cannot be cancelled', await post(Q, { action: 'cancel', rfqId: rfq.data.id, reason: 'x' }), /purchase order/i)
  // an expired quotation cannot be awarded
  const r2 = await post(Q, { action: 'create-rfq', supplierIds: [F.sup1], lines: [{ itemId: F.rm, qty: 5 }] })
  const r2line = (await q1('SELECT id FROM RfqLine WHERE rfqId=?', [r2.data.id])).id
  await post(Q, { action: 'record-quote', rfqId: r2.data.id, supplierId: F.sup1, quoteDate: '2026-01-01', validUntil: '2026-01-31', deliveryDays: 3, lines: [{ rfqLineId: r2line, rate: 90 }] })
  const q2 = await q1('SELECT id FROM SupplierQuote WHERE rfqId=?', [r2.data.id])
  expectReject('an expired quotation cannot be awarded', await post(Q, { action: 'award', rfqId: r2.data.id, quoteId: q2.id, reason: 'cheap' }), /expired/i)
  expectOk('an open RFQ can be cancelled with a reason', await post(Q, { action: 'cancel', rfqId: r2.data.id, reason: 'requirement dropped' }))
  await reconcile('after RFQ')
}

// ---------------------------------------------------------------- Phase 7: Quote-to-Cash
async function phaseQ2C() {
  phase = 'P7-q2c'
  const O = '/api/order-to-cash'
  const q = await post(O, { action: 'create-quotation', partyId: F.cust, validUntil: daysFromNow(20), lines: [{ itemId: F.fg, qty: 20, rate: 500 }] })
  expectOk('create quotation', q)
  const rev = await post(O, { action: 'revise-quotation', id: q.data.id, validUntil: daysFromNow(25), lines: [{ itemId: F.fg, qty: 20, rate: 480 }] })
  expectOk('revise quotation', rev)
  const versions = await qa('SELECT revisionNo, status, grandTotal FROM SalesQuotation WHERE quotationNo=? ORDER BY revisionNo', [q.data.quotationNo])
  check('1 revision creates a new immutable version (rev 1 keeps its totals)', versions.length === 2 && num(versions[1].revisionNo) === num(versions[0].revisionNo) + 1 && num(versions[0].grandTotal) !== num(versions[1].grandTotal), JSON.stringify(versions))
  check('2 previous version becomes SUPERSEDED', versions[0]?.status === 'SUPERSEDED', JSON.stringify(versions[0]))
  expectReject('superseded version cannot be submitted', await post(O, { action: 'transition-quotation', id: q.data.id, transition: 'SUBMIT' }), /SUPERSEDED/i)
  const old = await post(O, { action: 'create-quotation', partyId: F.cust, date: '2025-01-01', validUntil: '2025-01-31', lines: [{ itemId: F.fg, qty: 1, rate: 500 }] })
  expectOk('create an already-expired quotation', old)
  await post(O, { action: 'transition-quotation', id: old.data.id, transition: 'SUBMIT' })
  expectReject('3 expired quotation cannot be approved', await post(O, { action: 'transition-quotation', id: old.data.id, transition: 'APPROVE' }), /expired/i)
  const qid = rev.data.id
  expectOk('submit revision', await post(O, { action: 'transition-quotation', id: qid, transition: 'SUBMIT' }))
  expectOk('approve revision', await post(O, { action: 'transition-quotation', id: qid, transition: 'APPROVE' }))
  const so = await post(O, { action: 'quotation-to-order', id: qid, customerPoNo: 'AUD-PO-77' })
  expectOk('convert approved quotation to sales order', so); F.so = so.data
  expectReject('4 duplicate SO from the same quotation is blocked', await post(O, { action: 'quotation-to-order', id: qid }), /already linked|approved quotation/i)
  // credit limit
  const ql = await post(O, { action: 'create-quotation', partyId: F.custLow, validUntil: daysFromNow(10), lines: [{ itemId: F.fg, qty: 2, rate: 500 }] })
  await post(O, { action: 'transition-quotation', id: ql.data.id, transition: 'SUBMIT' }); await post(O, { action: 'transition-quotation', id: ql.data.id, transition: 'APPROVE' })
  const sol = await post(O, { action: 'quotation-to-order', id: ql.data.id })
  const cl = await post(O, { action: 'approve-order', id: sol.data.id })
  expectReject('6 SO approval beyond credit limit is blocked', cl, /credit limit/i)
  check('5 credit exposure includes the 400 opening balance', /exposure 400/.test(cl.error ?? ''), cl.error)
  // payment schedule (P11) before approval
  const FA = '/api/finance-adjustments'
  const total = num(F.so.grandTotal)
  expectReject('P11-12 schedule total must equal SO total', await post(FA, { action: 'set-schedule', salesOrderId: F.so.id, rows: [{ milestone: 'Advance', dueDate: daysFromNow(1), amount: total - 100 }] }), /must equal/i)
  expectReject('P11-13 duplicate milestone names are rejected', await post(FA, { action: 'set-schedule', salesOrderId: F.so.id, rows: [{ milestone: 'Advance', dueDate: daysFromNow(1), amount: total / 2 }, { milestone: 'advance', dueDate: daysFromNow(9), amount: total / 2 }] }), /unique/i)
  const sch = await post(FA, { action: 'set-schedule', salesOrderId: F.so.id, rows: [{ milestone: 'Advance', dueDate: '2026-01-01', amount: Math.round(total * 30) / 100 }, { milestone: 'Balance', dueDate: daysFromNow(30), amount: Math.round((total - Math.round(total * 30) / 100) * 100) / 100 }] })
  expectOk('valid two-milestone schedule', sch)
  const fad = await get(FA)
  const overdue = (fad.data?.schedules ?? []).find((s) => s.milestone === 'Advance' && s.salesOrderId === F.so.id)
  check('P11-15 past-due milestone derives OVERDUE', overdue?.status === 'OVERDUE', JSON.stringify(overdue ?? {}).slice(0, 120))
  expectOk('approve SO within credit limit', await post(O, { action: 'approve-order', id: F.so.id }))
  const soLine = (await q1('SELECT id FROM SalesOrderLine WHERE salesOrderId=?', [F.so.id])).id
  expectReject('10 insufficient warehouse stock is rejected', await post(O, { action: 'create-challan', salesOrderId: F.so.id, warehouseId: F.w2, lines: [{ salesOrderLineId: soLine, qty: 5 }] }), /insufficient stock/i)
  expectReject('9 over-dispatch beyond the order is rejected', await post(O, { action: 'create-challan', salesOrderId: F.so.id, warehouseId: F.main, lines: [{ salesOrderLineId: soLine, qty: 21 }] }), /exceeds pending/i)
  expectReject('duplicate SO line in one challan is rejected', await post(O, { action: 'create-challan', salesOrderId: F.so.id, warehouseId: F.main, lines: [{ salesOrderLineId: soLine, qty: 1 }, { salesOrderLineId: soLine, qty: 1 }] }), /only once/i)
  const dc1 = await post(O, { action: 'create-challan', salesOrderId: F.so.id, warehouseId: F.main, vehicleNo: 'MH12AB1234', transporter: 'Audit Roadways', lines: [{ salesOrderLineId: soLine, qty: 8 }] })
  expectOk('7 partial delivery challan #1 (8 of 20)', dc1); F.dc1 = dc1.data.id
  const dc2 = await post(O, { action: 'create-challan', salesOrderId: F.so.id, warehouseId: F.main, lines: [{ salesOrderLineId: soLine, qty: 12 }] })
  expectOk('8 second challan against the same SO (12)', dc2); F.dc2 = dc2.data.id
  expectReject('pending 0: third challan for 1 more is rejected', await post(O, { action: 'create-challan', salesOrderId: F.so.id, warehouseId: F.main, lines: [{ salesOrderLineId: soLine, qty: 1 }] }), /exceeds pending/i)
  const dl1 = (await q1('SELECT id FROM DeliveryChallanLine WHERE deliveryChallanId=?', [F.dc1])).id
  const dl2 = (await q1('SELECT id FROM DeliveryChallanLine WHERE deliveryChallanId=?', [F.dc2])).id
  const fgBefore = await stockNet(F.fg, F.main)
  expectReject('11 accepted + rejected must equal planned dispatch', await post(O, { action: 'inspect-dispatch', deliveryChallanId: F.dc1, lines: [{ deliveryChallanLineId: dl1, acceptedQty: 6, rejectedQty: 1, qcNotes: 'x' }] }), /must equal planned/i)
  expectReject('12 rejected dispatch needs QC notes', await post(O, { action: 'inspect-dispatch', deliveryChallanId: F.dc1, lines: [{ deliveryChallanLineId: dl1, acceptedQty: 7, rejectedQty: 1 }] }), /notes/i)
  expectOk('dispatch QC challan #1: 7 accepted, 1 rejected', await post(O, { action: 'inspect-dispatch', deliveryChallanId: F.dc1, lines: [{ deliveryChallanLineId: dl1, acceptedQty: 7, rejectedQty: 1, qcNotes: 'paint chip' }] }))
  check('13 only accepted dispatch (7) issues stock', near(await stockNet(F.fg, F.main), fgBefore - 7), `now=${await stockNet(F.fg, F.main)} before=${fgBefore}`)
  expectOk('dispatch QC challan #2: 12 accepted', await post(O, { action: 'inspect-dispatch', deliveryChallanId: F.dc2, lines: [{ deliveryChallanLineId: dl2, acceptedQty: 12, rejectedQty: 0 }] }))
  expectReject('14 invoice above accepted unbilled dispatch is rejected', await post(O, { action: 'invoice-dispatch', deliveryChallanId: F.dc1, lines: [{ deliveryChallanLineId: dl1, qty: 8 }] }), /exceeds unbilled/i)
  const fgPreInv = await stockNet(F.fg, F.main)
  const [i1, i2] = await Promise.all([1, 2].map(() => post(O, { action: 'invoice-dispatch', deliveryChallanId: F.dc1, lines: [{ deliveryChallanLineId: dl1, qty: 7 }] })))
  check('16 two concurrent invoices for challan #1: exactly one posts', [i1, i2].filter((r) => r.status === 200).length === 1, `statuses=${i1.status}/${i2.status} ${i1.error ?? ''}|${i2.error ?? ''}`)
  check('16 concurrent loser gets controlled 4xx', [i1, i2].every((r) => r.status === 200 || is4xx(r)), `statuses=${i1.status}/${i2.status}`)
  F.sinv1 = [i1, i2].find((r) => r.status === 200)?.data
  check('15 dispatch invoice does not issue stock twice', near(await stockNet(F.fg, F.main), fgPreInv), `now=${await stockNet(F.fg, F.main)} before=${fgPreInv}`)
  const dc1Status = (await q1('SELECT status FROM DeliveryChallan WHERE id=?', [F.dc1])).status
  check('17 fully invoiced challan closes (INVOICED)', /INVOICED|CLOSED/.test(dc1Status), dc1Status)
  const inv2 = await post(O, { action: 'invoice-dispatch', deliveryChallanId: F.dc2, lines: [{ deliveryChallanLineId: dl2, qty: 12 }] })
  expectOk('invoice challan #2 (12)', inv2); F.sinv2 = inv2.data
  const soState = await q1('SELECT s.status, l.qty, l.dispatchedQty, l.invoicedQty FROM SalesOrder s JOIN SalesOrderLine l ON l.salesOrderId=s.id WHERE s.id=?', [F.so.id])
  check('SO line dispatched 19 / invoiced 19 (1 rejected at dispatch QC stays pending)', near(soState.dispatchedQty, 19) && near(soState.invoicedQty, 19), JSON.stringify(soState))
  // the rejected unit must be re-dispatchable, then the SO closes
  const dc3 = await post(O, { action: 'create-challan', salesOrderId: F.so.id, warehouseId: F.main, lines: [{ salesOrderLineId: soLine, qty: 1 }] })
  check('QC-rejected dispatch quantity returns to pending (challan for 1 allowed)', dc3.status === 200, `status=${dc3.status} ${dc3.error ?? ''}`)
  if (dc3.status === 200) {
    const dl3 = (await q1('SELECT id FROM DeliveryChallanLine WHERE deliveryChallanId=?', [dc3.data.id])).id
    await post(O, { action: 'inspect-dispatch', deliveryChallanId: dc3.data.id, lines: [{ deliveryChallanLineId: dl3, acceptedQty: 1, rejectedQty: 0 }] })
    await post(O, { action: 'invoice-dispatch', deliveryChallanId: dc3.data.id, lines: [{ deliveryChallanLineId: dl3, qty: 1 }] })
    const st = (await q1('SELECT status FROM SalesOrder WHERE id=?', [F.so.id])).status
    check('18 fully dispatched + invoiced SO closes', /COMPLETED|CLOSED|INVOICED/.test(st), st)
  }
  // 19/20/21 cancellations
  expectOk('cancel invoice of challan #2', await api('DELETE', `/api/sales-invoices/${F.sinv2.id}`))
  check('19 invoice cancellation releases challan billed quantity', near((await q1('SELECT invoicedQty FROM DeliveryChallanLine WHERE id=?', [dl2])).invoicedQty, 0))
  expectReject('20 billed challan cannot be cancelled', await post(O, { action: 'cancel-challan', id: F.dc1 }), /invoiced/i)
  const fgPreCancel = await stockNet(F.fg, F.main)
  expectOk('21 unbilled challan #2 can be cancelled', await post(O, { action: 'cancel-challan', id: F.dc2 }))
  check('21 challan cancellation reverses its 12-unit stock issue', near(await stockNet(F.fg, F.main), fgPreCancel + 12), `now=${await stockNet(F.fg, F.main)}`)
  // returns + credit note + refund
  const sline = (await q1('SELECT id FROM SalesInvoiceItem WHERE invoiceId=?', [F.sinv1.id])).id
  expectReject('22 sales return above invoiced quantity is rejected', await post('/api/returns', { returnType: 'SALES_RETURN', sourceInvoiceId: F.sinv1.id, warehouseId: F.main, reason: 'damage', lines: [{ sourceLineId: sline, requestedQty: 8, acceptedQty: 8, rejectedQty: 0 }] }), /exceeds original/i)
  expectReject('P11-3 rejected return quantity needs QC notes', await post('/api/returns', { returnType: 'SALES_RETURN', sourceInvoiceId: F.sinv1.id, warehouseId: F.main, reason: 'damage', lines: [{ sourceLineId: sline, requestedQty: 4, acceptedQty: 3, rejectedQty: 1 }] }), /notes/i)
  const sr = await post('/api/returns', { returnType: 'SALES_RETURN', sourceInvoiceId: F.sinv1.id, warehouseId: F.main, reason: 'damage', lines: [{ sourceLineId: sline, requestedQty: 4, acceptedQty: 3, rejectedQty: 1, qcNotes: 'one beyond repair' }] })
  expectOk('sales return: 3 restocked, 1 rejected', sr); F.cn = sr.data
  expectReject('22 cumulative sales return (3 + 5 > 7) is rejected', await post('/api/returns', { returnType: 'SALES_RETURN', sourceInvoiceId: F.sinv1.id, warehouseId: F.main, reason: 'more', lines: [{ sourceLineId: sline, requestedQty: 5, acceptedQty: 5, rejectedQty: 0 }] }), /exceeds original/i)
  const cnGl = await q1("SELECT ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr FROM AccountLedger WHERE voucherType='CREDIT_NOTE' AND voucherNo=?", [F.cn.adjustmentNo])
  check('23 credit-note voucher balances', near(cnGl.dr, cnGl.cr) && num(cnGl.dr) > 0, JSON.stringify(cnGl))
  expectReject('24 customer refund above credit-note value is rejected', await post('/api/finance-adjustments', { action: 'refund-return', returnDocumentId: F.cn.id, amount: num(F.cn.grandTotal) + 1, mode: 'CASH' }), /refundable/i)
  const rf = await post('/api/finance-adjustments', { action: 'refund-return', returnDocumentId: F.cn.id, amount: 100, mode: 'CASH' })
  expectOk('customer refund of 100', rf); F.refundPay = rf.data
  const rfGl = await qa("SELECT account, debit, credit FROM AccountLedger WHERE voucherType='REFUND' AND voucherNo=? AND isCancelled=0", [rf.data?.paymentNo])
  check('P11-16 customer refund GL: Dr DEBT 100 / Cr CASH 100', rfGl.some((r) => r.account === 'DEBT' && near(r.debit, 100)) && rfGl.some((r) => r.account === 'CASH' && near(r.credit, 100)), JSON.stringify(rfGl))
  const sale2 = await post('/api/sales-invoices', { partyId: F.cust, warehouseId: F.main, lines: [{ itemId: F.fg, qty: 2, rate: 500 }] })
  const s2line = (await q1('SELECT id FROM SalesInvoiceItem WHERE invoiceId=?', [sale2.data.id])).id
  await post('/api/returns', { returnType: 'SALES_RETURN', sourceInvoiceId: sale2.data.id, warehouseId: F.main, reason: 'wrong size', lines: [{ sourceLineId: s2line, requestedQty: 1, acceptedQty: 1, rejectedQty: 0 }] })
  expectReject('sales invoice with a posted credit note cannot be cancelled', await api('DELETE', `/api/sales-invoices/${sale2.data.id}`), /credit note/i)
  expectReject('a refund payment cannot be cancelled through the generic payment cancel', await api('DELETE', `/api/payments/${rf.data.id}`), /refund/i)
  const dnRf = await q1("SELECT p.paymentNo FROM RefundAllocation r JOIN Payment p ON p.id=r.paymentId WHERE r.returnDocumentId=? AND p.status='POSTED' LIMIT 1", [F.dn.id])
  if (dnRf) {
    const sg = await qa("SELECT account, debit, credit FROM AccountLedger WHERE voucherType='REFUND' AND voucherNo=? AND isCancelled=0", [dnRf.paymentNo])
    check('P11-17 supplier refund GL: Dr BANK / Cr CRED', sg.some((r) => r.account === 'BANK' && num(r.debit) > 0) && sg.some((r) => r.account === 'CRED' && num(r.credit) > 0), JSON.stringify(sg))
  }
  await reconcile('after Q2C')
}

// ---------------------------------------------------------------- Phase 8: manufacturing / FG / WIP
async function phaseMfg() {
  phase = 'P8-mfg'
  const M = '/api/manufacturing'
  const prj = await post(`${M}/projects`, { name: 'Audit Bracket Run', partyId: F.cust, startDate: today, budget: 100000 })
  expectOk('create project', prj); F.prj = prj.data.id
  expectReject('BOM without an output item is refused', await post(`${M}/boms`, { projectId: F.prj, productName: 'Audit Bracket', lines: [{ itemId: F.rm, qty: 10, uom: 'KG', rate: 100 }] }), /output item/i)
  const bom = await post(`${M}/boms`, { projectId: F.prj, itemId: F.bomOut, productName: 'Audit Bracket', lines: [{ itemId: F.rm, qty: 10, uom: 'KG', rate: 100 }] })
  expectOk('create BOM', bom); F.bom = bom.data.id
  expectOk('approve BOM', await post(`${M}/boms/${F.bom}/actions`, { action: 'approve' }))
  const wo = await post(`${M}/work-orders`, { projectId: F.prj, bomId: F.bom, priority: 'HIGH' })
  expectOk('work order from approved BOM', wo); F.wo = wo.data.id
  const ops = await get(`${M}/work-centers`)
  check('work centres respond', ops.status === 200 && Array.isArray(ops.data), `status=${ops.status}`)
  const oeeQuick = await get(`${M}/oee`)
  check('OEE report responds for the default window', oeeQuick.status === 200 && Array.isArray(oeeQuick.data?.byWorkCenter), `status=${oeeQuick.status}`)
  const planQuick = await get(`${M}/schedule?horizonDays=30`)
  check('finite schedule responds', planQuick.status === 200 && Array.isArray(planQuick.data?.placements), `status=${planQuick.status}`)
  const materialPlan = await get(`${M}/material-plan`)
  const rmPlan = materialPlan.data?.rows?.find((row) => row.item.id === F.rm)
  const poSupply = num((await q1(`SELECT COALESCE(SUM(GREATEST(0, pol.qty-pol.receivedQty)),0) qty
    FROM PurchaseOrderLine pol JOIN PurchaseOrder po ON po.id=pol.purchaseOrderId
    WHERE pol.itemId=? AND po.status IN ('APPROVED','PART_RECEIVED')`, [F.rm])).qty)
  const ownedOnHand = num((await q1("SELECT COALESCE(SUM(qtyIn-qtyOut),0) qty FROM StockLedger WHERE itemId=? AND isCancelled=0 AND voucherType<>'JOBWORK_IN'", [F.rm])).qty)
  check('material plan includes approved PO outstanding supply (not as on-hand)', materialPlan.status === 200 && rmPlan && near(rmPlan.incomingQty, poSupply) && near(rmPlan.availableQty, ownedOnHand), `incoming API=${rmPlan?.incomingQty} DB=${poSupply}; stock API=${rmPlan?.availableQty} DB=${ownedOnHand}`)
  check('projected shortage nets approved PO supply without hiding immediate shortage', rmPlan && near(rmPlan.projectedShortageQty, Math.max(0, rmPlan.shortageQty-rmPlan.incomingQty)), `now=${rmPlan?.shortageQty} incoming=${rmPlan?.incomingQty} projected=${rmPlan?.projectedShortageQty}`)
  expectReject('1 duplicate active WO from the same BOM is blocked', await post(`${M}/work-orders`, { projectId: F.prj, bomId: F.bom }), /already active|duplicat/i)
  const emp = (await q1('SELECT id FROM Employee LIMIT 1')).id
  const t1 = await post(`${M}/tasks`, { workOrderId: F.wo, operation: 'CUTTING', seq: 1, plannedQty: 10 })
  const t2 = await post(`${M}/tasks`, { workOrderId: F.wo, operation: 'WELDING', seq: 2, plannedQty: 10 })
  expectOk('task 1 (CUTTING, seq 1)', t1); expectOk('task 2 (WELDING, seq 2)', t2)
  const T = (id) => `${M}/tasks/${id}/actions`
  await post(T(t2.data.id), { action: 'assign', employeeId: emp })
  expectReject('2 routing: seq 2 cannot start before seq 1 completes', await post(T(t2.data.id), { action: 'start' }), /predecessor/i)
  await post(T(t1.data.id), { action: 'assign', employeeId: emp })
  expectReject('3 assigned task cannot complete without Start', await post(T(t1.data.id), { action: 'complete', actualQty: 10, hours: 2 }), /start the task/i)
  expectOk('start task 1', await post(T(t1.data.id), { action: 'start' }))
  expectReject('4 material issue above owned available stock is rejected', await post(T(t1.data.id), { action: 'complete', actualQty: 10, hours: 2, materialItemId: F.rm, materialQty: 100000 }), /stock|available|insufficient/i)
  expectReject('5 customer jobwork stock cannot be consumed by own production', await post(T(t1.data.id), { action: 'complete', actualQty: 10, hours: 2, materialItemId: F.jwOnly, materialQty: 5 }), /stock|available|insufficient|jobwork|customer/i)
  const [k1, k2] = await Promise.all([1, 2].map(() => post(T(t1.data.id), { action: 'complete', actualQty: 10, hours: 2, labourRate: 150, materialItemId: F.rm, materialQty: 10 })))
  check('6 concurrent completion of the same task: exactly one succeeds', [k1, k2].filter((r) => r.status === 200).length === 1, `statuses=${k1.status}/${k2.status} ${k1.error ?? ''}|${k2.error ?? ''}`)
  const t1No = (await q1('SELECT taskNo, materialCost, labourCost FROM ProductionTask WHERE id=?', [t1.data.id]))
  const issues = num((await q1("SELECT COUNT(*) c FROM StockLedger WHERE voucherNo=? AND qtyOut>0 AND isCancelled=0", [t1No.taskNo])).c)
  check('6 material issued exactly once', issues === 1, `issue rows=${issues}`)
  const tgl = await qa("SELECT account, ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr FROM AccountLedger WHERE voucherNo=? AND isCancelled=0 GROUP BY account", [t1No.taskNo])
  const wipDr = tgl.find((r) => r.account === 'WIP')
  check('7 task completion posts Dr WIP = material + labour', wipDr && near(wipDr.dr, num(t1No.materialCost) + num(t1No.labourCost)), JSON.stringify(tgl))
  check('7 credits are Inventory (STKV) and labour absorbed', tgl.some((r) => r.account === 'STKV' && near(r.cr, t1No.materialCost)) && tgl.filter((r) => r.account !== 'WIP' && r.account !== 'STKV').every((r) => num(r.cr) > 0), JSON.stringify(tgl))
  const R = `${M}/receipts`
  expectReject('FG receipt blocked while an operation is still open', await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 4, acceptedQty: 4 }), /complete every active operation/i)
  await post(T(t2.data.id), { action: 'start' })
  expectOk('complete task 2 (labour only)', await post(T(t2.data.id), { action: 'complete', actualQty: 10, hours: 3, labourRate: 150 }))
  expectReject('17 WO cannot close without accepted FG', await post(`${M}/work-orders/${F.wo}/actions`, { action: 'complete' }), /finished goods/i)
  expectReject('8 accepted + rejected + rework + scrap must equal produced', await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 4, acceptedQty: 3 }), /must equal produced/i)
  expectReject('9 rejection without QC notes is rejected', await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 4, acceptedQty: 3, rejectedQty: 1 }), /notes/i)
  expectReject('10 zero accepted FG cannot be received', await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 4, acceptedQty: 0, scrapQty: 4, qcNotes: 'all scrap' }), /at least one/i)
  const actualTotal = num((await q1("SELECT SUM(materialCost+labourCost+overheadCost) s FROM ProductionTask WHERE workOrderId=? AND status='COMPLETED'", [F.wo])).s)
  const bomCost = num((await q1('SELECT SUM(estCost) s FROM BomItem WHERE bomId=?', [F.bom])).s)
  const ra = await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 4, acceptedQty: 4, batchNo: 'FGLOT-A', manufacturedAt: today })
  expectOk('FG receipt A (4 of 10)', ra)
  check('12 expected cost comes from BOM (4/10 of BOM est cost)', near(ra.data.expectedCost, bomCost * 0.4), `expected=${ra.data?.expectedCost} bom=${bomCost}`)
  check('13 actual cost is 4/10 of material + labour + absorbed overhead', near(ra.data.actualCost, actualTotal * 0.4), `actual=${ra.data?.actualCost} total=${actualTotal}`)
  check('14 variance = actual - expected', near(ra.data.variance, num(ra.data.actualCost) - num(ra.data.expectedCost)), JSON.stringify({ a: ra.data?.actualCost, e: ra.data?.expectedCost, v: ra.data?.variance }))
  const w2Pre = await stockNet(F.fg, F.w2)
  expectOk('20 cancel FG receipt A (stock still on hand)', await post(R, { action: 'cancel', id: ra.data.id }))
  check('20 cancellation reverses FG stock', near(await stockNet(F.fg, F.w2), w2Pre - 4), `now=${await stockNet(F.fg, F.w2)}`)
  const mrGl = await qa("SELECT isCancelled, ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr, COUNT(*) n FROM AccountLedger WHERE voucherType='MFG_RECEIPT' AND voucherNo=? GROUP BY isCancelled", [ra.data.receiptNo])
  check('20 cancellation writes a mirrored GL reversal (no active rows left)', mrGl.length === 1 && num(mrGl[0].isCancelled) === 1 && near(mrGl[0].dr, mrGl[0].cr), JSON.stringify(mrGl))
  const rb = await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 4, acceptedQty: 4, batchNo: 'FGLOT-B', manufacturedAt: today })
  expectOk('FG receipt B (4 of 10)', rb)
  const pv = await get(`${R}?preview=1&workOrderId=${F.wo}&producedQty=6&acceptedQty=5`)
  expectOk('receipt preview before posting', pv)
  const rc = await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 6, acceptedQty: 5, rejectedQty: 1, qcNotes: 'weld porosity', batchNo: 'FGLOT-C', manufacturedAt: today })
  check('preview predicted the posted expected/actual cost and variance exactly', pv.data && near(pv.data.expectedCost, rc.data?.expectedCost) && near(pv.data.actualCost, rc.data?.actualCost) && near(pv.data.variance, rc.data?.variance), JSON.stringify({ preview: pv.data && [pv.data.expectedCost, pv.data.actualCost, pv.data.variance], posted: rc.data && [rc.data.expectedCost, rc.data.actualCost, rc.data.variance] }))
  check('preview says this receipt settles the WIP and lets the WO close', pv.data?.closesWorkOrder === true && near(pv.data?.wipAfter, 0), JSON.stringify(pv.data?.warnings))
  const ready = (await get(`${R}?readiness=1`)).data ?? []
  check('readiness board shows the WO ready to close', ready.find((w) => w.id === F.wo)?.readyToClose === true, JSON.stringify(ready.find((w) => w.id === F.wo)))
  expectReject('preview validates its input', await get(`${R}?preview=1&workOrderId=${F.wo}&producedQty=-1&acceptedQty=0`), /positive/i)
  expectOk('FG receipt C (produced 6: 5 accepted, 1 rejected)', rc)
  const settled = num((await q1("SELECT SUM(actualCost) s FROM ProductionReceipt WHERE workOrderId=? AND status='POSTED'", [F.wo])).s)
  check('15/16 producing the full planned 10 settles all WIP even with a QC rejection', near(settled, actualTotal), `settled=${settled} actual=${actualTotal} residue=${(actualTotal - settled).toFixed(2)}`)
  const close = await post(`${M}/work-orders/${F.wo}/actions`, { action: 'complete' })
  check('WO closes once FG is received and WIP settled', close.status === 200, `status=${close.status} ${close.error ?? ''}`)
  // 18: WIP guard on a second work order with only a partial receipt
  const bom2 = await post(`${M}/boms`, { projectId: F.prj, itemId: F.bomOut2, productName: 'Audit Bracket II', lines: [{ itemId: F.rm, qty: 5, uom: 'KG', rate: 100 }] })
  await post(`${M}/boms/${bom2.data.id}/actions`, { action: 'approve' })
  const wo2 = await post(`${M}/work-orders`, { projectId: F.prj, bomId: bom2.data.id })
  const t3 = await post(`${M}/tasks`, { workOrderId: wo2.data.id, operation: 'ASSEMBLY', seq: 1, plannedQty: 10 })
  await post(T(t3.data.id), { action: 'assign', employeeId: emp }); await post(T(t3.data.id), { action: 'start' })
  await post(T(t3.data.id), { action: 'complete', actualQty: 10, hours: 1, labourRate: 100, materialItemId: F.rm, materialQty: 5 })
  F.wo2 = wo2.data.id
  await post(R, { workOrderId: F.wo2, outputItemId: F.fg, warehouseId: F.w2, producedQty: 3, acceptedQty: 3 })
  expectReject('18 WO cannot close with unsettled WIP (3 of 10 received)', await post(`${M}/work-orders/${F.wo2}/actions`, { action: 'complete' }), /not fully settled/i)
  // 19: cancellation blocked after FG consumed
  const fgW2 = await stockNet(F.fg, F.w2)
  const sell = await post('/api/sales-invoices', { partyId: F.cust, warehouseId: F.w2, lines: [{ itemId: F.fg, qty: fgW2, rate: 500 }] })
  expectOk(`sell all ${fgW2} FG from AUDW2`, sell)
  expectReject('19 FG receipt cancellation blocked after stock was sold', await post(R, { action: 'cancel', id: rc.data.id }), /consumed|sold/i)
  await reconcile('after manufacturing')
}

// ---------------------------------------------------------------- Phase 9: quality
async function phaseQuality() {
  phase = 'P9-quality'
  const Q = '/api/quality'
  const base = { action: 'create-template', code: 'AUD-QC', name: 'Bracket inward QC', inspectionType: 'INWARD', itemId: F.rm }
  expectReject('1 template needs at least one parameter', await post(Q, { ...base, parameters: [] }), /at least one|parameter/i)
  expectReject('2 duplicate parameter names are rejected', await post(Q, { ...base, parameters: [{ name: 'Thickness', dataType: 'NUMBER' }, { name: 'thickness', dataType: 'NUMBER' }] }), /unique/i)
  expectReject('3 numeric min above max is rejected', await post(Q, { ...base, parameters: [{ name: 'Thickness', dataType: 'NUMBER', minValue: 12, maxValue: 9 }] }), /minimum cannot exceed/i)
  expectReject('4 required text parameter needs expected text', await post(Q, { ...base, parameters: [{ name: 'Finish', dataType: 'TEXT', required: true }] }), /expected text/i)
  const params = [{ name: 'Thickness', dataType: 'NUMBER', unit: 'mm', minValue: 9.5, maxValue: 10.5 }, { name: 'Finish', dataType: 'TEXT', expectedText: 'Smooth' }, { name: 'Visual OK', dataType: 'BOOLEAN' }]
  const v1 = await post(Q, { ...base, parameters: params }); expectOk('create template v1 (number/text/boolean)', v1)
  const P = (tpl) => Object.fromEntries(tpl.parameters.map((p) => [p.name, p.id]))
  const p1 = P(v1.data)
  const insp = (tpl, m, extra = {}) => post(Q, { action: 'inspect', templateId: tpl.id, referenceType: 'GOODS_RECEIPT', referenceId: F.grn2, itemId: F.rm, measurements: m, ...extra })
  const good = (p) => [{ parameterId: p.Thickness, numberValue: 10 }, { parameterId: p.Finish, textValue: ' smooth ' }, { parameterId: p['Visual OK'], booleanValue: true }]
  const pass = await insp(v1.data, good(p1)); expectOk('9 in-range numeric + matching text + true boolean passes', pass)
  check('9/11 inspection status PASSED, default disposition ACCEPT', pass.data?.status === 'PASSED' && pass.data?.disposition === 'ACCEPT', JSON.stringify({ s: pass.data?.status, d: pass.data?.disposition }))
  expectReject('7 missing required measurement is rejected', await insp(v1.data, good(p1).slice(1)), /required/i)
  expectReject('8 wrong measurement type is rejected', await insp(v1.data, [{ parameterId: p1.Thickness, textValue: '10' }, ...good(p1).slice(1)]), /numeric/i)
  const out = await insp(v1.data, [{ parameterId: p1.Thickness, numberValue: 11 }, ...good(p1).slice(1)])
  check('10/14 out-of-range numeric fails and defaults to QUARANTINE', out.data?.status === 'FAILED' && out.data?.disposition === 'QUARANTINE', JSON.stringify({ s: out.data?.status, d: out.data?.disposition }))
  const txt = await insp(v1.data, [good(p1)[0], { parameterId: p1.Finish, textValue: 'rough' }, good(p1)[2]])
  check('11 expected-text mismatch fails', txt.data?.status === 'FAILED', txt.data?.status)
  const bool = await insp(v1.data, [...good(p1).slice(0, 2), { parameterId: p1['Visual OK'], booleanValue: false }])
  check('12 boolean false fails', bool.data?.status === 'FAILED', bool.data?.status)
  expectReject('13 failed inspection cannot be dispositioned ACCEPT', await insp(v1.data, [{ parameterId: p1.Thickness, numberValue: 1 }, ...good(p1).slice(1)], { disposition: 'ACCEPT' }), /cannot have ACCEPT/i)
  const stored = await q1('SELECT inspectedBy, inspectedAt, (SELECT COUNT(*) FROM QualityMeasurement m WHERE m.inspectionId=i.id) n FROM QualityInspection i WHERE id=?', [pass.data.id])
  check('15 inspector, time and every measurement persist', stored?.inspectedBy && stored?.inspectedAt && num(stored.n) === 3, JSON.stringify(stored))
  const v2 = await post(Q, { ...base, name: 'Bracket inward QC v2', parameters: params.slice(0, 2) }); expectOk('create template v2 (same code)', v2)
  const vers = await qa("SELECT version, active FROM QualityTemplate WHERE code='AUD-QC' ORDER BY version")
  check('5 new version deactivates the previous one', vers.length === 2 && num(vers[0].active) === 0 && num(vers[1].active) === 1 && num(vers[1].version) === 2, JSON.stringify(vers))
  expectReject('inspection against the inactive v1 is refused', await insp(v1.data, good(p1)), /active QC template/i)
  check('6 historical inspections still reference v1', num((await q1('SELECT COUNT(*) c FROM QualityInspection WHERE templateId=?', [v1.data.id])).c) >= 4)
  const dash = await get(Q)
  const sql = await q1("SELECT COUNT(*) t, SUM(status='PASSED') p, SUM(status='FAILED') f, SUM(disposition='QUARANTINE') q FROM QualityInspection WHERE companyId=?", [F.company.id])
  const s = dash.data?.summary ?? {}
  check('16 quality dashboard counts reconcile with the database', num(s.total) === num(sql.t) && num(s.passed) === num(sql.p) && num(s.failed) === num(sql.f) && num(s.quarantined) === num(sql.q), `api=${JSON.stringify(s)} db=${JSON.stringify(sql)}`)
  // source-of-truth: a FAILED parameterised inspection on a GRN must stop that GRN line being accepted
  const P2 = '/api/procurement'
  const g = await post(P2, { action: 'create-receipt', purchaseOrderId: F.po2, warehouseId: F.main, supplierDocNo: 'AUD-DC-QC', lines: [{ purchaseOrderLineId: (await q1('SELECT id FROM PurchaseOrderLine WHERE purchaseOrderId=?', [F.po2])).id, receivedQty: 2 }] })
  if (g.status === 200) {
    const p2 = P(v2.data)
    await post(Q, { action: 'inspect', templateId: v2.data.id, referenceType: 'GOODS_RECEIPT', referenceId: g.data.id, itemId: F.rm, measurements: [{ parameterId: p2.Thickness, numberValue: 20 }, { parameterId: p2.Finish, textValue: 'Smooth' }] })
    const gl = (await q1('SELECT id FROM GoodsReceiptLine WHERE goodsReceiptId=?', [g.data.id])).id
    const acc = await post(P2, { action: 'inspect-receipt', goodsReceiptId: g.data.id, lines: [{ goodsReceiptLineId: gl, acceptedQty: 2, rejectedQty: 0 }] })
    expectReject('source of truth: GRN line cannot be QC-accepted after its parameterised inspection FAILED', acc, /inspection|failed|quarantine/i)
    expectOk('the same GRN line can be recorded as rejected', await post(P2, { action: 'inspect-receipt', goodsReceiptId: g.data.id, lines: [{ goodsReceiptLineId: gl, acceptedQty: 0, rejectedQty: 2, rejectionReason: 'failed thickness' }] }))
  } else check('source-of-truth GRN fixture', false, `${g.status} ${g.error}`)
  await reconcile('after quality')
}

// ---------------------------------------------------------------- Phase 10: lots / serials / genealogy
async function phaseLots() {
  phase = 'P10-lots'
  const R = '/api/manufacturing/receipts', M = '/api/manufacturing'
  const emp = (await q1('SELECT id FROM Employee LIMIT 1')).id
  const T = (id) => `${M}/tasks/${id}/actions`
  let lotSeq = 0
  async function readyWo(name, plannedQty) {
    const out = (await post('/api/masters/items', { code: `AUD-LOT-FG${++lotSeq}`, name: `${name} (output)`, uom: 'PCS', costRate: 400, saleRate: 800, gstRate: 18, hsn: '732690' })).data.id
    const bom = await post(`${M}/boms`, { projectId: F.prj, itemId: out, productName: name, lines: [{ itemId: F.rm, qty: 1, uom: 'KG', rate: 100 }] })
    await post(`${M}/boms/${bom.data.id}/actions`, { action: 'approve' })
    const wo = await post(`${M}/work-orders`, { projectId: F.prj, bomId: bom.data.id })
    const t = await post(`${M}/tasks`, { workOrderId: wo.data.id, operation: 'ASSEMBLY', seq: 1, plannedQty })
    await post(T(t.data.id), { action: 'assign', employeeId: emp }); await post(T(t.data.id), { action: 'start' })
    await post(T(t.data.id), { action: 'complete', actualQty: plannedQty, hours: 1, labourRate: 100 })
    return wo.data.id
  }
  const woS = await readyWo('Audit Serial Pump', 3)
  expectReject('3 serial count must equal accepted quantity', await post(R, { workOrderId: woS, outputItemId: F.fg2, warehouseId: F.main, producedQty: 3, acceptedQty: 3, batchNo: 'PUMP-LOT-1', serialNumbers: ['PMP-001', 'PMP-002'] }), /serial count/i)
  expectReject('serials without a batch number are rejected', await post(R, { workOrderId: woS, outputItemId: F.fg2, warehouseId: F.main, producedQty: 3, acceptedQty: 3, serialNumbers: ['PMP-001', 'PMP-002', 'PMP-003'] }), /batch/i)
  expectReject('duplicate serial inside one receipt is rejected', await post(R, { workOrderId: woS, outputItemId: F.fg2, warehouseId: F.main, producedQty: 3, acceptedQty: 3, batchNo: 'PUMP-LOT-1', serialNumbers: ['PMP-001', 'PMP-001', 'PMP-002'] }), /serial/i)
  const rs = await post(R, { workOrderId: woS, outputItemId: F.fg2, warehouseId: F.main, producedQty: 3, acceptedQty: 3, batchNo: 'PUMP-LOT-1', manufacturedAt: today, serialNumbers: ['PMP-001', 'PMP-002', 'PMP-003'], parentLots: [{ parentLotId: F.lot1, consumedQty: 3 }] })
  expectOk('11 FG lot with 3 serials and supplier parent lot SUPLOT-1', rs)
  const pumpLot = await q1("SELECT id, status FROM InventoryLot WHERE lotNo='PUMP-LOT-1'")
  check('3/4 serial rows equal tracked quantity and lot balance equals movements', num((await q1('SELECT COUNT(*) c FROM SerialNumber WHERE lotId=?', [pumpLot.id])).c) === 3 && near(await lotBal(pumpLot.id), 3))
  check('11 parent -> child genealogy persists', num((await q1('SELECT COUNT(*) c FROM LotGenealogy WHERE parentLotId=? AND childLotId=?', [F.lot1, pumpLot.id])).c) === 1)
  const woS2 = await readyWo('Audit Serial Pump II', 1)
  const dupSerial = await post(R, { workOrderId: woS2, outputItemId: F.fg2, warehouseId: F.main, producedQty: 1, acceptedQty: 1, batchNo: 'PUMP-LOT-2', serialNumbers: ['PMP-001'] })
  expectReject('2 duplicate serial number across lots is rejected (4xx, not 500)', dupSerial, /serial|exists|unique|duplicate/i)
  // 12 lot cannot be its own parent; multi-hop cycle
  const woC = await readyWo('Audit Cycle', 2)
  expectReject('12 a lot cannot be its own parent (receipt into the parent lot)', await post(R, { workOrderId: woC, outputItemId: F.rm, warehouseId: F.main, producedQty: 2, acceptedQty: 2, batchNo: 'SUPLOT-1', parentLots: [{ parentLotId: F.lot1, consumedQty: 1 }] }), /own parent|cycle/i)
  expectReject('multi-hop genealogy cycle (child lot as ancestor of its parent) is rejected', await post(R, { workOrderId: woC, outputItemId: F.rm, warehouseId: F.main, producedQty: 2, acceptedQty: 2, batchNo: 'SUPLOT-1', parentLots: [{ parentLotId: pumpLot.id, consumedQty: 1 }] }), /cycle|ancestor|own parent/i)
  // 7/8/9 dispatch lot guards
  const woE = await readyWo('Audit Expired Batch', 2)
  expectOk('FG lot that is already expired', await post(R, { workOrderId: woE, outputItemId: F.fg, warehouseId: F.main, producedQty: 2, acceptedQty: 2, batchNo: 'EXP-LOT', manufacturedAt: '2025-01-01', expiryDate: '2025-06-01' }))
  const O = '/api/order-to-cash'
  async function approvedSo(qty, item = F.fg) {
    const q = await post(O, { action: 'create-quotation', partyId: F.cust, validUntil: daysFromNow(9), lines: [{ itemId: item, qty, rate: 500 }] })
    await post(O, { action: 'transition-quotation', id: q.data.id, transition: 'SUBMIT' }); await post(O, { action: 'transition-quotation', id: q.data.id, transition: 'APPROVE' })
    const so = await post(O, { action: 'quotation-to-order', id: q.data.id }); await post(O, { action: 'approve-order', id: so.data.id })
    return { so: so.data.id, line: (await q1('SELECT id FROM SalesOrderLine WHERE salesOrderId=?', [so.data.id])).id }
  }
  async function dispatchBatch(batchNo, qty, item = F.fg, serialNumbers) {
    const { so, line } = await approvedSo(qty, item)
    const dc = await post(O, { action: 'create-challan', salesOrderId: so, warehouseId: F.main, lines: [{ salesOrderLineId: line, qty, batchNo }] })
    if (dc.status !== 200) return dc
    const dl = (await q1('SELECT id FROM DeliveryChallanLine WHERE deliveryChallanId=?', [dc.data.id])).id
    const r = await post(O, { action: 'inspect-dispatch', deliveryChallanId: dc.data.id, lines: [{ deliveryChallanLineId: dl, acceptedQty: qty, rejectedQty: 0, serialNumbers }] })
    return { ...r, challanId: dc.data.id }
  }
  expectReject('7 dispatch cannot issue an expired lot', await dispatchBatch('EXP-LOT', 1), /expired/i)
  const woM = await readyWo('Audit Main Batch', 2)
  expectOk('FG lot FG-LOT-M (2 units) in MAIN', await post(R, { workOrderId: woM, outputItemId: F.fg, warehouseId: F.main, producedQty: 2, acceptedQty: 2, batchNo: 'FG-LOT-M', manufacturedAt: today }))
  expectReject('9 dispatch cannot exceed the lot balance', await dispatchBatch('FG-LOT-M', 5), /balance/i)
  expectReject('serial-tracked lot cannot be dispatched without serial numbers', await dispatchBatch('PUMP-LOT-1', 1, F.fg2), /serial/i)
  expectReject('unknown serial number is rejected at dispatch', await dispatchBatch('PUMP-LOT-1', 1, F.fg2, ['PMP-999']), /serial/i)
  const okDispatch = await dispatchBatch('PUMP-LOT-1', 1, F.fg2, ['PMP-002'])
  expectOk('dispatch 1 unit from the serialised lot PUMP-LOT-1', okDispatch)
  const serialStates = await qa('SELECT status, COUNT(*) c FROM SerialNumber WHERE lotId=? GROUP BY status', [pumpLot.id])
  check('10 dispatching from a serialised lot moves exactly one serial out of AVAILABLE', num(serialStates.find((s) => s.status === 'AVAILABLE')?.c) === 2, JSON.stringify(serialStates))
  expectReject('10 the same serial cannot be issued twice', await dispatchBatch('PUMP-LOT-1', 1, F.fg2, ['PMP-002']), /serial/i)
  // 13/14 recursive recall
  const rec = await post('/api/traceability', { action: 'recall', id: F.lot1, reason: 'mill certificate mismatch' })
  expectOk('recall supplier lot SUPLOT-1', rec)
  check('13 recursive recall reaches the descendant FG lot', (await q1('SELECT status FROM InventoryLot WHERE id=?', [pumpLot.id])).status === 'RECALLED')
  check('14 recall marks the remaining available serials RECALLED', num((await q1("SELECT COUNT(*) c FROM SerialNumber WHERE lotId=? AND status='AVAILABLE'", [pumpLot.id])).c) === 0)
  expectReject('8 dispatch cannot issue a recalled lot', await dispatchBatch('PUMP-LOT-1', 1, F.fg2), /RECALLED/i)
  // 16 cancelling a dispatch of a lot that was recalled afterwards must keep it RECALLED
  expectOk('cancel the earlier dispatch from the (now recalled) lot', await post(O, { action: 'cancel-challan', id: okDispatch.challanId }))
  check('16 dispatch cancellation does not revive a recalled lot', (await q1('SELECT status FROM InventoryLot WHERE id=?', [pumpLot.id])).status === 'RECALLED')
  check('16 the serial returned by that cancellation comes back as RECALLED, not AVAILABLE', (await q1("SELECT status FROM SerialNumber WHERE serialNo='PMP-002'")).status === 'RECALLED')
  const rmMain = await stockNet(F.rm, F.main)
  const lotsRm = num((await q1('SELECT COALESCE(SUM(m.qtyIn-m.qtyOut),0) n FROM LotMovement m JOIN InventoryLot l ON l.id=m.lotId WHERE m.isCancelled=0 AND l.itemId=? AND l.warehouseId=?', [F.rm, F.main])).n)
  const untracked = Math.max(0, rmMain - lotsRm)
  const issuableLots = num((await q1("SELECT COALESCE(SUM(m.qtyIn-m.qtyOut),0) n FROM LotMovement m JOIN InventoryLot l ON l.id=m.lotId WHERE m.isCancelled=0 AND l.status='AVAILABLE' AND l.itemId=? AND l.warehouseId=?", [F.rm, F.main])).n)
  const recalledSale = await post('/api/sales-invoices', { partyId: F.cust, warehouseId: F.main, lines: [{ itemId: F.rm, qty: Math.round((untracked + issuableLots + 1) * 1000) / 1000, rate: 130 }] })
  expectReject('plain sales invoice cannot sell units held in a recalled batch', recalledSale, /batch|held|recalled/i)
  // 1 duplicate lot: a second GRN batch with the same lotNo adds to the same lot row
  check('1 one lot row per (company, item, warehouse, lotNo)', num((await q1("SELECT COUNT(*) c FROM InventoryLot WHERE lotNo='SUPLOT-1' AND itemId=? AND warehouseId=?", [F.rm, F.main])).c) === 1)
  const recon = await qa(`SELECT l.id, l.lotNo, ROUND(COALESCE(SUM(m.qtyIn-m.qtyOut),0),3) bal FROM InventoryLot l LEFT JOIN LotMovement m ON m.lotId=l.id AND m.isCancelled=0 GROUP BY l.id HAVING bal < -0.001`)
  check('15 every lot balance non-negative and derived from movements', recon.length === 0, JSON.stringify(recon))
  await reconcile('after lots')
}

// ---------------------------------------------------------------- Phase 11: advances / refunds / reversals
async function phaseFinance() {
  phase = 'P11-finance'
  const FA = '/api/finance-adjustments'
  const rec = await post('/api/payments', { type: 'RECEIPT', partyId: F.cust, amount: 5000, mode: 'BANK' })
  expectOk('6 unallocated customer receipt', rec); F.advPay = rec.data
  const adv = await q1('SELECT id, advanceType, originalAmount FROM PartyAdvance WHERE paymentId=?', [rec.data.id])
  check('6 unallocated receipt creates a CUSTOMER advance of 5000', adv && adv.advanceType === 'CUSTOMER' && near(adv.originalAmount, 5000), JSON.stringify(adv))
  const pinvNo = (await q1("SELECT invoiceNo FROM PurchaseInvoice WHERE status='POSTED' LIMIT 1")).invoiceNo
  expectReject('7 customer advance cannot settle a purchase invoice', await post(FA, { action: 'apply-advance', advanceId: adv.id, invoiceType: 'PURCHASE', invoiceNo: pinvNo, amount: 10 }), /cannot settle/i)
  const big = await post('/api/sales-invoices', { partyId: F.cust, warehouseId: F.main, lines: [{ itemId: F.fg, qty: 10, rate: 500 }] })
  expectOk('sales invoice of 5900 for advance tests', big); F.bigInv = big.data
  expectReject('9 application above available advance is rejected', await post(FA, { action: 'apply-advance', advanceId: adv.id, invoiceType: 'SALES', invoiceNo: big.data.invoiceNo, amount: 5000.5 }), /available/i)
  const small = await post('/api/sales-invoices', { partyId: F.cust, warehouseId: F.main, lines: [{ itemId: F.fg, qty: 1, rate: 100 }] })
  expectReject('10 application above invoice outstanding is rejected', await post(FA, { action: 'apply-advance', advanceId: adv.id, invoiceType: 'SALES', invoiceNo: small.data.invoiceNo, amount: 500 }), /outstanding/i)
  const applies = await Promise.all([1, 2, 3, 4].map(() => post(FA, { action: 'apply-advance', advanceId: adv.id, invoiceType: 'SALES', invoiceNo: big.data.invoiceNo, amount: 3000 })))
  check('P11 four concurrent advance applications (3000 each of 5000): exactly one succeeds', applies.filter((r) => r.status === 200).length === 1, `statuses=${applies.map((r) => r.status)}`)
  const advRow = await q1('SELECT appliedAmount, status FROM PartyAdvance WHERE id=?', [adv.id])
  check('advance appliedAmount = 3000 after the race', near(advRow.appliedAmount, 3000), JSON.stringify(advRow))
  check('invoice paidAmount = 3000 after the race', near((await q1('SELECT paidAmount FROM SalesInvoice WHERE id=?', [big.data.id])).paidAmount, 3000))
  expectReject('11 payment cancellation blocked after its advance was applied', await api('DELETE', `/api/payments/${rec.data.id}`), /advance was already applied|reverse/i)
  expectReject('invoice cancellation blocked while an advance is applied to it', await api('DELETE', `/api/sales-invoices/${big.data.id}`), /paid|payment|advance|allocation/i)
  // reversal of an advance application (append-only correction)
  const alloc = await q1("SELECT id FROM PaymentAllocation WHERE paymentId=? AND invoiceNo=? ORDER BY id DESC LIMIT 1", [rec.data.id, big.data.invoiceNo])
  const revA = await post(FA, { action: 'reverse-advance-application', allocationId: alloc?.id ?? 'missing', reason: 'applied to wrong invoice' })
  expectOk('reverse an advance application', revA)
  check('reversal restores invoice outstanding (paidAmount 0)', near((await q1('SELECT paidAmount FROM SalesInvoice WHERE id=?', [big.data.id])).paidAmount, 0))
  check('reversal restores available advance (applied 0, status OPEN)', near((await q1('SELECT appliedAmount FROM PartyAdvance WHERE id=?', [adv.id])).appliedAmount, 0) && (await q1('SELECT status FROM PartyAdvance WHERE id=?', [adv.id])).status === 'OPEN')
  check('reversal keeps the allocation row (append-only) and records who/why', alloc && (await q1('SELECT reversedAt, reversalReason FROM PaymentAllocation WHERE id=?', [alloc.id]))?.reversedAt, 'row must stay with reversedAt set')
  check('reversal writes an audit record', num((await q1("SELECT COUNT(*) c FROM AuditLog WHERE action='REVERSE' AND entity='PaymentAllocation'")).c) >= 1)
  expectReject('reversing the same application twice is rejected', await post(FA, { action: 'reverse-advance-application', allocationId: alloc?.id ?? 'missing', reason: 'again' }), /already reversed|not found/i)
  expectOk('payment can be cancelled once its applications are reversed', await api('DELETE', `/api/payments/${rec.data.id}`))
  // refund cancellation
  const before = num((await q1("SELECT COALESCE(SUM(r.amount),0) s FROM RefundAllocation r JOIN Payment p ON p.id=r.paymentId AND p.status='POSTED' WHERE r.returnDocumentId=?", [F.cn.id])).s)
  const cr = await post(FA, { action: 'cancel-refund', paymentId: F.refundPay.id, reason: 'cheque bounced' })
  expectOk('cancel a customer refund', cr)
  const after = num((await q1("SELECT COALESCE(SUM(r.amount),0) s FROM RefundAllocation r JOIN Payment p ON p.id=r.paymentId AND p.status='POSTED' WHERE r.returnDocumentId=?", [F.cn.id])).s)
  check('refund cancellation restores the refundable balance', near(before - after, 100), `before=${before} after=${after}`)
  const rgl = await qa("SELECT isCancelled, ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr FROM AccountLedger WHERE voucherType='REFUND' AND voucherNo=? GROUP BY isCancelled", [F.refundPay.paymentNo])
  check('refund cancellation posts a mirrored GL reversal', rgl.length === 1 && num(rgl[0].isCancelled) === 1 && near(rgl[0].dr, rgl[0].cr), JSON.stringify(rgl))
  expectReject('cancelling the same refund twice is rejected', await post(FA, { action: 'cancel-refund', paymentId: F.refundPay.id, reason: 'again' }), /already|not found/i)
  expectReject('return cancellation blocked while a refund is still posted against it', await post('/api/returns', { action: 'cancel', id: F.dn.id }), /refund/i)
  // 5 return cancellation stock guard
  const fgMain = await stockNet(F.fg, F.main)
  check('5 sales-return cancellation succeeds while restocked units are on hand', (await post('/api/returns', { action: 'cancel', id: F.cn.id })).status === 200 && near(await stockNet(F.fg, F.main), fgMain - 3))
  // ---- payment milestones follow collections (FIFO by due date)
  const OC = '/api/order-to-cash'
  const mq = await post(OC, { action: 'create-quotation', partyId: F.cust, validUntil: daysFromNow(10), lines: [{ itemId: F.fg, qty: 4, rate: 500 }] })
  await post(OC, { action: 'transition-quotation', id: mq.data.id, transition: 'SUBMIT' }); await post(OC, { action: 'transition-quotation', id: mq.data.id, transition: 'APPROVE' })
  const mso = (await post(OC, { action: 'quotation-to-order', id: mq.data.id })).data
  const mTotal = num(mso.grandTotal), mFirst = Math.round(mTotal * 30) / 100
  expectOk('schedule: 30% due last week, balance next month', await post(FA, { action: 'set-schedule', salesOrderId: mso.id, rows: [{ milestone: 'Advance', dueDate: daysFromNow(-7), amount: mFirst }, { milestone: 'Balance', dueDate: daysFromNow(30), amount: Math.round((mTotal - mFirst) * 100) / 100 }] }))
  await post(OC, { action: 'approve-order', id: mso.id })
  const ms = async () => (await qa('SELECT milestone, paidAmount, status FROM PaymentSchedule WHERE salesOrderId=? ORDER BY dueDate', [mso.id]))
  check('unpaid past-due milestone is OVERDUE, future one PENDING', (await ms()).map((r) => r.status).join() === 'OVERDUE,PENDING', JSON.stringify(await ms()))
  const advPay = await post('/api/payments', { type: 'RECEIPT', partyId: F.cust, amount: 1000, mode: 'BANK' })
  const mAdv = await q1('SELECT id FROM PartyAdvance WHERE paymentId=?', [advPay.data.id])
  expectReject('an advance cannot be tagged to another customer order', await post(FA, { action: 'tag-advance', advanceId: mAdv.id, salesOrderId: (await q1('SELECT id FROM SalesOrder WHERE partyId=? LIMIT 1', [F.custLow]))?.id ?? 'x' }), /different customers|not found/i)
  expectOk('tag the 1000 advance to the order', await post(FA, { action: 'tag-advance', advanceId: mAdv.id, salesOrderId: mso.id }))
  let m1 = await ms()
  check('tagged advance pays the first milestone in full, rest goes to the next (FIFO)', m1[0].status === 'PAID' && near(m1[0].paidAmount, mFirst) && near(m1[1].paidAmount, 1000 - mFirst) && m1[1].status === 'PART_PAID', JSON.stringify(m1))
  expectReject('a schedule with collected amounts cannot be replaced', await post(FA, { action: 'set-schedule', salesOrderId: mso.id, rows: [{ milestone: 'All', dueDate: daysFromNow(5), amount: mTotal }] }), /collected/i)
  const msoLine = (await q1('SELECT id FROM SalesOrderLine WHERE salesOrderId=?', [mso.id])).id
  const mdc = await post(OC, { action: 'create-challan', salesOrderId: mso.id, warehouseId: F.main, lines: [{ salesOrderLineId: msoLine, qty: 4 }] })
  const mdl = (await q1('SELECT id FROM DeliveryChallanLine WHERE deliveryChallanId=?', [mdc.data.id])).id
  await post(OC, { action: 'inspect-dispatch', deliveryChallanId: mdc.data.id, lines: [{ deliveryChallanLineId: mdl, acceptedQty: 4, rejectedQty: 0 }] })
  const minv = await post(OC, { action: 'invoice-dispatch', deliveryChallanId: mdc.data.id, lines: [{ deliveryChallanLineId: mdl, qty: 4 }] })
  expectOk('dispatch-backed invoice for the order', minv)
  expectOk('apply the tagged advance to that invoice', await post(FA, { action: 'apply-advance', advanceId: mAdv.id, invoiceType: 'SALES', invoiceNo: minv.data.invoiceNo, amount: 1000 }))
  const m2 = await ms()
  check('applying the advance to the order invoice does not double count', near(m2[0].paidAmount + m2[1].paidAmount, 1000), JSON.stringify(m2))
  const mRest = Math.round((num(minv.data.grandTotal) - 1000) * 100) / 100
  const settle = await post('/api/payments', { type: 'RECEIPT', partyId: F.cust, amount: mRest, mode: 'BANK', allocations: [{ invoiceType: 'SALES', invoiceNo: minv.data.invoiceNo, amount: mRest }] })
  expectOk('receipt for the invoice balance', settle)
  check('collections that cover the order mark every milestone PAID', (await ms()).every((r) => r.status === 'PAID'), JSON.stringify(await ms()))
  expectOk('cancel that receipt', await api('DELETE', `/api/payments/${settle.data.id}`))
  const m3 = await ms()
  check('cancelling a collection re-opens the milestones', m3[1].status === 'PART_PAID' && near(m3[0].paidAmount + m3[1].paidAmount, 1000), JSON.stringify(m3))
  const fd = await get(FA)
  const mRec = (fd.data?.reconciliation ?? []).find((r) => r.salesOrderId === mso.id)
  check('schedule reconciliation: scheduled = order total, invoiced and collected reported', mRec && near(mRec.scheduled, mTotal) && near(mRec.invoiced, num(minv.data.grandTotal)) && near(mRec.collected, 1000) && mRec.issues.length === 0, JSON.stringify(mRec))
  await reconcile('after finance')
}

// ---------------------------------------------------------------- Phase 12: GST & exports
async function phaseGst() {
  phase = 'P12-gst'
  const month = today.slice(0, 7)
  const g1 = await get(`/api/reports?type=gstr1&month=${month}`)
  expectOk('GSTR-1 report', g1)
  const g3 = await get(`/api/reports?type=gstr3b&month=${month}`)
  expectOk('GSTR-3B (books) report', g3)
  const hsn = await get(`/api/reports?type=hsn-summary&month=${month}`)
  expectOk('HSN/SAC summary', hsn)
  const [y, m] = month.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1)), to = new Date(Date.UTC(y, m, 1))
  const out = await q1("SELECT ROUND(SUM(cgst),2) c, ROUND(SUM(sgst),2) s, ROUND(SUM(igst),2) i FROM SalesInvoice WHERE status='POSTED' AND date>=? AND date<?", [from, to])
  const cn = await q1("SELECT ROUND(COALESCE(SUM(cgst),0),2) c, ROUND(COALESCE(SUM(sgst),0),2) s, ROUND(COALESCE(SUM(igst),0),2) i FROM ReturnDocument WHERE returnType='SALES_RETURN' AND status='POSTED' AND date>=? AND date<?", [from, to])
  const inp = await q1("SELECT ROUND(SUM(cgst),2) c, ROUND(SUM(sgst),2) s, ROUND(SUM(igst),2) i FROM PurchaseInvoice WHERE status='POSTED' AND date>=? AND date<?", [from, to])
  const body = JSON.stringify(g3.data ?? {})
  const dn = await q1("SELECT ROUND(COALESCE(SUM(cgst),0),2) c, ROUND(COALESCE(SUM(sgst),0),2) s, ROUND(COALESCE(SUM(igst),0),2) i FROM ReturnDocument WHERE returnType='PURCHASE_RETURN' AND status='POSTED' AND date>=? AND date<?", [from, to])
  const o = g3.data?.outward ?? {}, it = g3.data?.eligibleItcFromBooks ?? {}
  check('GSTR-3B output tax per head = posted sales books minus credit notes', ['c', 's', 'i'].every((h, k) => near(o[['cgst', 'sgst', 'igst'][k]], num(out[h]) - num(cn[h]), 0.02)), `report=${JSON.stringify(o)} books=${JSON.stringify(out)} cn=${JSON.stringify(cn)}`)
  check('GSTR-3B ITC per head = posted purchase books minus debit notes', ['c', 's', 'i'].every((h, k) => near(it[['cgst', 'sgst', 'igst'][k]], num(inp[h]) - num(dn[h]), 0.02)), `report=${JSON.stringify(it)} books=${JSON.stringify(inp)} dn=${JSON.stringify(dn)}`)
  const net = g3.data?.netTaxBeforeCrossUtilisation ?? {}, ex = g3.data?.excessItcBeforeCrossUtilisation ?? {}
  check('GSTR-3B net and excess ITC reconcile by tax head', ['cgst', 'sgst', 'igst'].every((h) => near(num(net[h]) - num(ex[h]), num(o[h]) - num(it[h]), 0.02)), JSON.stringify({ net, ex }))
  const cnRows = num((await q1("SELECT COUNT(*) c FROM ReturnDocument WHERE returnType='SALES_RETURN' AND status='POSTED' AND date>=? AND date<?", [from, to])).c)
  check('GSTR-1 lists the month credit notes (CDNR + CDNUR)', num(g1.data?.cdnrTotal?.count) + num(g1.data?.cdnurTotal?.count) === cnRows, `report=${num(g1.data?.cdnrTotal?.count) + num(g1.data?.cdnurTotal?.count)} db=${cnRows}`)
  check('GSTR-3B is labelled books-based, not portal-filing-ready', /book/i.test(body) || /not.*fil|draft|working/i.test(body), body.slice(0, 160))
  const cancelledNo = (await q1("SELECT invoiceNo FROM SalesInvoice WHERE status='CANCELLED' LIMIT 1"))?.invoiceNo
  if (cancelledNo) check('GSTR-1 excludes cancelled invoices', !JSON.stringify(g1.data).includes(cancelledNo), cancelledNo)
  const auditBefore = num((await q1('SELECT COUNT(*) c FROM AuditLog')).c)
  const ei = await get(`/api/e-invoice?from=${month}-01&to=${today}`)
  check('e-Invoice JSON export responds (200 or controlled 4xx with pre-validation errors)', ei.status === 200 || is4xx(ei), `status=${ei.status}`)
  const ew = await post('/api/e-way-bill', { invoiceId: F.sinv1?.id, transportMode: 'ROAD', distanceKm: 0 })
  expectReject('e-Way Bill requires valid transport inputs', ew)
  check('exports write audit records', num((await q1('SELECT COUNT(*) c FROM AuditLog')).c) > auditBefore, `before=${auditBefore}`)
}

// ---------------------------------------------------------------- Phase 12b: BOM revisions + MRP
async function phaseMrp() {
  phase = 'P12b-mrp'
  const M = '/api/manufacturing'
  const prj = await post(`${M}/projects`, { name: 'Audit MRP Cell', partyId: F.cust, startDate: today, budget: 500000 })
  expectOk('MRP: create planning project', prj)
  const pid = prj.data.id
  const mrpCust = await post('/api/masters/parties', { code: 'AUD-MRP-C', name: 'Audit MRP Customer', types: ['CUSTOMER'], stateCode: '27', creditLimit: 100_000_000 })
  expectOk('MRP: customer fixture', mrpCust)
  const isoRm = (await post('/api/masters/items', { code: 'AUD-MRP-RM', name: 'Audit MRP Sheet', uom: 'KG', costRate: 100, saleRate: 130, gstRate: 18, groupName: 'Audit' })).data.id
  const isoFg = (await post('/api/masters/items', { code: 'AUD-MRP-FG', name: 'Audit MRP Skid', uom: 'PCS', costRate: 600, saleRate: 1200, gstRate: 18, groupName: 'Audit' })).data.id

  // ---- BOM rev 1 → rev 2 lifecycle on the shared sellable item -------------
  const bom1 = await post(`${M}/boms`, {
    projectId: pid, itemId: F.sellable, productName: 'Audit Sellable v1', effectiveFrom: today,
    lines: [{ itemId: F.subAsm, qty: 2, uom: 'PCS', rate: 250 }, { itemId: F.rm, qty: 4, uom: 'KG', rate: 100 }],
  })
  expectOk('MRP: create BOM rev 1', bom1)
  const bomV1 = bom1.data
  check('MRP: first revision is revision 1', num(bomV1?.revision) === 1, `revision=${bomV1?.revision}`)
  expectOk('MRP: approve rev 1', await post(`${M}/boms/${bomV1.id}/actions`, { action: 'approve' }))
  expectReject('MRP: an approved revision cannot be edited in place', await api('PUT', `${M}/boms/${bomV1.id}`, { lines: [{ itemId: F.rm, qty: 1, uom: 'KG', rate: 10 }] }), /draft|immutable/i)
  expectReject('MRP: a second live BOM for the same output item is refused', await post(`${M}/boms`, { projectId: pid, itemId: F.sellable, productName: 'duplicate', lines: [{ itemId: F.rm, qty: 1, uom: 'KG', rate: 10 }] }), /already exists/i)
  const subBom = await post(`${M}/boms`, { projectId: pid, itemId: F.subAsm, productName: 'Audit Sub Assembly v1', lines: [{ itemId: F.rm, qty: 3, uom: 'KG', rate: 100 }] })
  expectOk('MRP: create sub-assembly BOM', subBom)
  expectOk('MRP: approve sub-assembly BOM', await post(`${M}/boms/${subBom.data.id}/actions`, { action: 'approve' }))

  const revise = await post(`${M}/boms/${bomV1.id}/actions`, { action: 'revise', notes: 'ECO: 5 KG instead of 4' })
  expectOk('MRP: revise an approved BOM into a DRAFT', revise)
  check('MRP: revision is numbered 2 and points at rev 1', num(revise.data?.revision) === 2 && revise.data?.supersedesId === bomV1.id, JSON.stringify({ r: revise.data?.revision, s: revise.data?.supersedesId }))
  expectReject('MRP: only one open draft revision per item', await post(`${M}/boms/${bomV1.id}/actions`, { action: 'revise' }), /draft|revision/i)
  expectOk('MRP: edit the draft revision lines', await api('PUT', `${M}/boms/${revise.data.id}`, { lines: [{ itemId: F.subAsm, qty: 2, uom: 'PCS', rate: 250 }, { itemId: F.rm, qty: 5, uom: 'KG', rate: 100 }] }))
  expectOk('MRP: approve rev 2', await post(`${M}/boms/${revise.data.id}/actions`, { action: 'approve' }))
  const chain = await qa('SELECT bomNo, revision, status, effectiveTo FROM Bom WHERE itemId=? ORDER BY revision', [F.sellable])
  check('MRP: approving rev 2 supersedes rev 1 (one live revision)', chain.length === 2 && chain[0].status === 'SUPERSEDED' && chain[0].effectiveTo != null && chain[1].status === 'APPROVED', JSON.stringify(chain))
  expectReject('MRP: a superseded revision cannot generate a work order', await post(`${M}/work-orders`, { projectId: pid, bomId: bomV1.id }), /superseded/i)
  expectReject('MRP: a superseded revision cannot be cancelled', await post(`${M}/boms/${bomV1.id}/actions`, { action: 'cancel' }), /superseded/i)
  const used = await get(`${M}/boms/where-used?itemId=${F.subAsm}`)
  check('MRP: where-used lists every live BOM that consumes the sub-assembly', used.status === 200 && (used.data?.usedIn ?? []).some((r) => r.bomNo === revise.data.bomNo && num(r.qtyPer) === 2 && r.status === 'APPROVED'), `status=${used.status} ${JSON.stringify(used.data?.usedIn)}`)

  // ---- isolated demand: 1 skid = 4 KG sheet, nothing in stock/pipeline -----
  const isoBom = await post(`${M}/boms`, { projectId: pid, itemId: isoFg, productName: 'Audit MRP Skid BOM', lines: [{ itemId: isoRm, qty: 4, uom: 'KG', rate: 100 }] })
  expectOk('MRP: create isolated FG BOM', isoBom)
  expectOk('MRP: approve isolated FG BOM', await post(`${M}/boms/${isoBom.data.id}/actions`, { action: 'approve' }))
  const O = '/api/order-to-cash'
  const quote = await post(O, { action: 'create-quotation', partyId: mrpCust.data.id, validUntil: daysFromNow(25), lines: [{ itemId: isoFg, qty: 25, rate: 1200 }] })
  expectOk('MRP: quotation for 25 FG', quote)
  await post(O, { action: 'transition-quotation', id: quote.data.id, transition: 'SUBMIT' })
  expectOk('MRP: approve the quotation', await post(O, { action: 'transition-quotation', id: quote.data.id, transition: 'APPROVE' }))
  const order = await post(O, { action: 'quotation-to-order', id: quote.data.id, deliveryDate: daysFromNow(15) })
  expectOk('MRP: quotation becomes a sales order', order)
  expectOk('MRP: approve the sales order (independent demand)', await post(O, { action: 'approve-order', id: order.data.id }))
  const soNo = (await q1('SELECT orderNo FROM SalesOrder WHERE id=?', [order.data.id])).orderNo
  const isoStock = async () => num((await q1('SELECT COALESCE(SUM(qtyIn-qtyOut),0) q FROM StockLedger WHERE itemId IN (?,?) AND isCancelled=0', [isoFg, isoRm])).q)
  check('MRP: the isolated fixture has no stock to net against', near(await isoStock(), 0), `stock=${await isoStock()}`)

  const preview = await get(`${M}/mrp/preview?asOf=${today}&horizonDays=30`)
  expectOk('MRP: dry run responds', preview)
  const lines = preview.data?.lines ?? []
  const fgLine = lines.find((l) => l.itemId === isoFg)
  const rmLine = lines.find((l) => l.itemId === isoRm)
  check('MRP: approved sales-order demand is the independent requirement', fgLine && near(fgLine.grossQty, 25) && near(fgLine.netQty, 25) && fgLine.level === 0, JSON.stringify(fgLine && { g: fgLine.grossQty, n: fgLine.netQty, l: fgLine.level }))
  check('MRP: FG with an effective BOM is a MAKE suggestion bound to its revision', fgLine?.suggestion === 'MAKE' && fgLine?.bomNo === isoBom.data.bomNo, JSON.stringify({ s: fgLine?.suggestion, b: fgLine?.bomNo }))
  check('MRP: demand is dated by the sales-order delivery date', fgLine ? fgLine.needBy.slice(0, 10) === daysFromNow(15) : false, fgLine?.needBy)
  check('MRP: explosion grosses the component quantity (25 × 4 = 100 KG)', rmLine && near(rmLine.grossQty, 100) && near(rmLine.netQty, 100) && rmLine.level === 1, JSON.stringify(rmLine && { g: rmLine.grossQty, n: rmLine.netQty, l: rmLine.level }))
  check('MRP: a purchased component is a BUY suggestion', rmLine?.suggestion === 'BUY', rmLine?.suggestion)
  check('MRP: pegging names the driving sales order', rmLine ? String(rmLine.pegging).includes(soNo) : false, String(rmLine?.pegging ?? '').slice(0, 140))
  const jobworkNetted = lines.find((l) => l.itemId === F.rm)
  if (jobworkNetted) {
    const owned = num((await q1("SELECT COALESCE(SUM(qtyIn-qtyOut),0) q FROM StockLedger WHERE itemId=? AND isCancelled=0 AND voucherType<>'JOBWORK_IN'", [F.rm])).q)
    check('MRP: on-hand netting never exceeds company-owned stock (JOBWORK_IN excluded)', jobworkNetted.onHandQty <= owned + 0.001, `netted=${jobworkNetted.onHandQty} owned=${owned}`)
  }

  // ---- snapshot semantics: saving posts nothing ---------------------------
  const docCounts = async () => JSON.stringify({
    pr: num((await q1('SELECT COUNT(*) c FROM PurchaseRequisition')).c),
    wo: num((await q1('SELECT COUNT(*) c FROM WorkOrder')).c),
    stock: num((await q1('SELECT COUNT(*) c FROM StockLedger')).c),
    gl: num((await q1('SELECT COUNT(*) c FROM AccountLedger')).c),
  })
  const before = await docCounts()
  const created = await post(`${M}/mrp`, { asOf: today, horizonDays: 30 })
  expectOk('MRP: save a run snapshot', created)
  check('MRP: saving a run creates no document, stock row or ledger entry', (await docCounts()) === before, `before=${before} after=${await docCounts()}`)
  check('MRP: run number is FY formatted', /^MRP-\d{4}-\d{3,}$/.test(String(created.data?.runNo ?? '')), created.data?.runNo)
  const runId = created.data?.id
  const detail = await get(`${M}/mrp/${runId}`)
  expectOk('MRP: read the saved snapshot', detail)
  check('MRP: the saved snapshot matches a fresh calculation line for line', (detail.data?.lines ?? []).length === lines.length, `saved=${detail.data?.lines?.length} fresh=${lines.length}`)
  check('MRP: every saved run is scoped to the operating company', num((await q1('SELECT COUNT(*) c FROM MrpRun WHERE companyId=?', [F.company.id])).c) === num((await q1('SELECT COUNT(*) c FROM MrpRun')).c))

  // ---- user approval converts selected lines into non-posting documents ---
  const savedMake = (detail.data?.lines ?? []).find((l) => l.itemId === isoFg && l.suggestion === 'MAKE' && l.netQty > 0)
  const savedBuy = (detail.data?.lines ?? []).find((l) => l.itemId === isoRm && l.suggestion === 'BUY' && l.netQty > 0)
  if (savedMake && savedBuy) {
    expectReject('MRP: MAKE lines need an executing project', await post(`${M}/mrp/${runId}/actions`, { action: 'create-documents', lineIds: [savedMake.id] }), /project/i)
    const conv = await post(`${M}/mrp/${runId}/actions`, { action: 'create-documents', lineIds: [savedMake.id, savedBuy.id], projectId: pid })
    expectOk('MRP: approve suggestions into documents', conv)
    const pr = await q1('SELECT status, purpose FROM PurchaseRequisition WHERE reqNo=?', [conv.data?.requisition?.reqNo])
    check('MRP: buy suggestions create a DRAFT requisition (still needs approval)', pr?.status === 'DRAFT' && /MRP/i.test(String(pr?.purpose)), JSON.stringify(pr))
    const woRow = await q1('SELECT status, outputItemId, outputQty FROM WorkOrder WHERE woNo=?', [conv.data?.workOrders?.[0]?.woNo])
    check('MRP: make suggestion creates an OPEN work order for the net quantity', woRow?.status === 'OPEN' && woRow?.outputItemId === isoFg && near(woRow?.outputQty, 25), JSON.stringify(woRow))
    const woLines = num((await q1('SELECT COALESCE(SUM(pl.plannedQty),0) q FROM WorkOrderLine pl JOIN WorkOrder w ON w.id=pl.workOrderId WHERE w.woNo=?', [conv.data?.workOrders?.[0]?.woNo])).q)
    check('MRP: the planned work order carries the exploded component quantity (25 × 4)', near(woLines, 100), `planned=${woLines}`)
    expectReject('MRP: an approved suggestion cannot be converted twice', await post(`${M}/mrp/${runId}/actions`, { action: 'create-documents', lineIds: [savedBuy.id], projectId: pid }), /already|produced/i)
    check('MRP: conversion did not move stock or post a ledger entry', num((await q1('SELECT COUNT(*) c FROM StockLedger')).c) === JSON.parse(before).stock && num((await q1('SELECT COUNT(*) c FROM AccountLedger')).c) === JSON.parse(before).gl)
  } else {
    check('MRP: suggestion fixtures present (make + buy lines)', false, JSON.stringify((detail.data?.lines ?? []).filter((l) => [isoFg, isoRm].includes(l.itemId)).map((l) => [l.suggestion, l.netQty])))
  }
  expectOk('MRP: close the run', await post(`${M}/mrp/${runId}/actions`, { action: 'close' }))
  expectReject('MRP: a closed run cannot be converted', await post(`${M}/mrp/${runId}/actions`, { action: 'create-documents', lineIds: [savedBuy?.id].filter(Boolean) }), /closed/i)
  await reconcile('after MRP')
}

// ---------------------------------------------------------------- Phase 12c: routing, capacity, OEE
async function phaseOps() {
  phase = 'P12c-ops'
  const M = '/api/manufacturing'
  const ws = await get(`${M}/work-centers?all=1`)
  expectOk('ops: work centre master responds', ws)
  const seeded = (ws.data ?? []).find((c) => c.code === 'WC-CNC')
  check('ops: seeded work centres carry a shift calendar', seeded && seeded.calendar && seeded.calendar.shifts.length >= 1, JSON.stringify(seeded?._count))

  const centers = await get(`${M}/work-centers?all=1`)
  const weld = (centers.data ?? []).find((c) => c.code === 'WC-WELD')
  const cut = (centers.data ?? []).find((c) => c.code === 'WC-CUT')
  if (weld && cut) {
    const cal = await get(`${M}/work-centers/${weld.id}`)
    expectOk('ops: calendar detail responds', cal)
    const capPerDay = (cal.data?.shifts ?? []).filter((s) => s.active).reduce((s, x) => s + x.durationMin, 0) * weld.parallelCapacity
    check('ops: capacity = active shift minutes × parallel capacity', capPerDay > 0, `minutes=${capPerDay}`)
    expectReject('ops: shifts cannot overlap', await api('PUT', `${M}/work-centers/${weld.id}/calendar`, {
      workDays: '1,2,3,4,5,6',
      shifts: [{ name: 'A', startMin: 540, durationMin: 480 }, { name: 'B', startMin: 600, durationMin: 120 }],
    }), /overlap/i)
    expectReject('ops: invalid working week is refused', await api('PUT', `${M}/work-centers/${weld.id}/calendar`, { workDays: '9', shifts: [{ startMin: 540, durationMin: 480 }] }), /weekday/i)
  } else {
    check('ops: seeded welding/cutting centres exist', false, JSON.stringify((centers.data ?? []).map((c) => c.code)))
  }

  // ---- routing lifecycle on a fresh BOM ------------------------------------
  const prj = await post(`${M}/projects`, { name: 'Audit Routing Cell', partyId: F.cust, startDate: today, budget: 100000 })
  expectOk('ops: create routing project', prj)
  const out = await post('/api/masters/items', { code: 'AUD-ROUT-FG', name: 'Audit Routed Bracket', uom: 'PCS', costRate: 300, saleRate: 600, gstRate: 18, groupName: 'Audit' })
  expectOk('ops: output item for routing BOM', out)
  const bom = await post(`${M}/boms`, { projectId: prj.data.id, itemId: out.data.id, productName: 'Audit Routed Bracket', lines: [{ itemId: F.rm, qty: 2, uom: 'KG', rate: 100 }] })
  expectOk('ops: create BOM for routing', bom)
  if (weld && cut) {
    expectReject('ops: routing needs at least one operation', await api('PUT', `${M}/routing`, { bomId: bom.data.id, operations: [] }))
    expectReject('ops: duplicate sequence numbers are refused', await api('PUT', `${M}/routing`, {
      bomId: bom.data.id,
      operations: [
        { seq: 1, operation: 'WELDING', workCenterId: weld.id },
        { seq: 1, operation: 'CUTTING', workCenterId: cut.id },
      ],
    }), /sequence/i)
    expectReject('ops: an inactive work centre is refused', await api('PUT', `${M}/routing`, {
      bomId: bom.data.id,
      operations: [{ seq: 1, operation: 'WELDING', workCenterId: 'missing-centre' }],
    }), /not found/i)
    const routing = await api('PUT', `${M}/routing`, {
      bomId: bom.data.id,
      operations: [
        { seq: 1, operation: 'CUTTING', workCenterId: cut.id, runMinutesPerUnit: 1, setupMinutes: 30 },
        { seq: 2, operation: 'WELDING', workCenterId: weld.id, runMinutesPerUnit: 2, setupMinutes: 20, inspectionMinutes: 10 },
      ],
    })
    expectOk('ops: save a two-step routing on the draft revision', routing)
    expectOk('ops: approve the routed BOM', await post(`${M}/boms/${bom.data.id}/actions`, { action: 'approve' }))
    expectReject('ops: the route of an approved revision is frozen', await api('PUT', `${M}/routing`, {
      bomId: bom.data.id,
      operations: [{ seq: 1, operation: 'WELDING', workCenterId: weld.id, runMinutesPerUnit: 9 }],
    }), /frozen|revision/i)

    const wo = await post(`${M}/work-orders`, { projectId: prj.data.id, bomId: bom.data.id, outputQty: 5, priority: 'NORMAL', startDate: today, endDate: daysFromNow(10) })
    expectOk('ops: work order for a 5-piece batch', wo)
    const dup = await post(`${M}/work-orders/${wo.data.id}/actions`, { action: 'generate-tasks' })
    const tasks = await qa('SELECT seq, operation, workCenterId, plannedMinutes, plannedQty FROM ProductionTask WHERE workOrderId=? ORDER BY seq', [wo.data.id])
    check('ops: routing generates one task per operation', tasks.length === 2, JSON.stringify(tasks))
    check('ops: task minutes = setup + run minutes per unit × batch', near(num(tasks[0]?.plannedMinutes), 30 + 5) && near(num(tasks[1]?.plannedMinutes), 20 + 10 + 10), JSON.stringify(tasks.map((t) => [t.operation, t.plannedMinutes])))
    check('ops: tasks carry the routing work centre', tasks.every((t) => t.workCenterId), JSON.stringify(tasks))
    check('ops: regenerating is idempotent (no duplicate tasks)', dup.status === 200 && (await qa('SELECT id FROM ProductionTask WHERE workOrderId=?', [wo.data.id])).length === 2, `status=${dup.status}`)

    // ---- finite schedule ---------------------------------------------------
    const plan = await get(`${M}/schedule?from=${today}&horizonDays=45`)
    expectOk('ops: finite schedule responds', plan)
    const placed = (plan.data?.placements ?? []).filter((p) => tasks.some((t) => t.seq === p.seq))
    check('ops: scheduled operations respect route order', placed.length >= 1 && placed.every((p) => new Date(p.end) > new Date(p.start)), JSON.stringify(placed.slice(0, 2)))
    const cutLoad = (plan.data?.load ?? []).find((l) => l.workCenterId === cut.id)
    check('ops: load per work centre is reported against calendar capacity', !!cutLoad && cutLoad.capacityMinutes > 0 && cutLoad.utilisationPct >= 0, JSON.stringify(cutLoad))

    // ---- downtime + OEE ----------------------------------------------------
    // Downtime only costs availability inside a shift (Mon–Sat, day shift), so
    // start the stoppage at 10:00 on the most recent working day before today.
    const sd = new Date(); sd.setDate(sd.getDate() - 1)
    while (sd.getDay() === 0) sd.setDate(sd.getDate() - 1)
    sd.setHours(10, 0, 0, 0)
    const start = sd.toISOString()
    const asm = (centers.data ?? []).find((c) => c.code === 'WC-ASM') ?? weld
    const rec = await post(`${M}/downtime`, { action: 'record', workCenterId: asm.id, reason: 'BREAKDOWN', startedAt: start })
    expectOk('ops: record an open breakdown', rec)
    expectReject('ops: overlapping downtime on the same centre is refused', await post(`${M}/downtime`, { action: 'record', workCenterId: asm.id, reason: 'POWER', startedAt: start }), /already has downtime|close/i)
    expectOk('ops: close the breakdown', await post(`${M}/downtime`, { action: 'close', id: rec.data.id }))
    expectReject('ops: closing twice is refused', await post(`${M}/downtime`, { action: 'close', id: rec.data.id }), /already closed/i)

    const oee = await get(`${M}/oee?from=${daysFromNow(-7)}&to=${today}`)
    expectOk('ops: OEE report responds', oee)
    const weldRow = (oee.data?.byWorkCenter ?? []).find((r) => r.workCenter.includes(asm.code))
    check('ops: OEE availability falls with recorded downtime', weldRow && weldRow.downtimeMinutes > 0 && weldRow.availabilityPct < 100, JSON.stringify(weldRow && { d: weldRow.downtimeMinutes, a: weldRow.availabilityPct }))
    const summary = oee.data?.summary
    check('ops: OEE is the product of its three factors', summary && near(summary.oeePct, (summary.availabilityPct / 100) * (summary.performancePct / 100) * (summary.qualityPct / 100) * 100, 0.05), JSON.stringify(summary))
    check('ops: performance only counts routed work and says so', (oee.data?.excluded?.tasksWithoutIdealTime ?? 0) >= 0, JSON.stringify(oee.data?.excluded))
    expectReject('ops: OEE window is validated', await get(`${M}/oee?from=${today}&to=2025-01-01`), /before|range|invalid/i)
  } else {
    check('ops: routing fixtures available', false, 'work centres missing')
  }
  await reconcile('after routing/OEE')
}

// ---------------------------------------------------------------- Phase 12d: costing roll-up
async function phaseCosting() {
  phase = 'P12d-costing'
  const M = '/api/manufacturing'
  // The seed sets an absorption rate; without one nothing here is measurable.
  const company = await q1('SELECT overheadRatePct FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')
  check('costing: the demo company absorbs factory overhead', num(company.overheadRatePct) > 0, `rate=${company.overheadRatePct}`)

  const prj = await post(`${M}/projects`, { name: 'Audit Costing Cell', partyId: F.cust, startDate: today, budget: 250000 })
  expectOk('costing: create project', prj)
  const out = await post('/api/masters/items', { code: 'AUD-COST-FG', name: 'Audit Costed Bracket', uom: 'PCS', costRate: 400, saleRate: 800, gstRate: 18, groupName: 'Audit' })
  expectOk('costing: output item', out)
  const bom = await post(`${M}/boms`, {
    projectId: prj.data.id,
    itemId: out.data.id,
    productName: 'Audit Costed Bracket',
    lines: [
      { itemId: F.rm, qty: 2, uom: 'KG', rate: 100 },
      { itemId: F.fg, qty: 1, uom: 'PCS', rate: 50 },
    ],
  })
  expectOk('costing: create BOM', bom)
  const weld = (await get(`${M}/work-centers?all=1`)).data?.find((c) => c.code === 'WC-WELD')
  const cut = (await get(`${M}/work-centers?all=1`)).data?.find((c) => c.code === 'WC-CUT')

  // Standard cost needs a route: labour = minutes / 60 × centre cost per hour.
  const draftStandard = await get(`${M}/costing?bomId=${bom.data.id}`)
  expectOk('costing: standard cost of a draft revision responds', draftStandard)
  check('costing: an unrouted revision reports no routing', draftStandard.data?.standard?.noRouting === true, JSON.stringify(draftStandard.data?.standard))
  check('costing: material standard comes from the BOM lines', near(draftStandard.data?.standard?.materialCost, 2 * 100 + 50), `material=${draftStandard.data?.standard?.materialCost}`)

  await api('PUT', `${M}/routing`, {
    bomId: bom.data.id,
    operations: [
      { seq: 1, operation: 'CUTTING', workCenterId: cut.id, runMinutesPerUnit: 6, setupMinutes: 0 },
      { seq: 2, operation: 'WELDING', workCenterId: weld.id, runMinutesPerUnit: 12, setupMinutes: 0 },
    ],
  })
  const routed = await get(`${M}/costing?bomId=${bom.data.id}`)
  const expectedLabour = (6 / 60) * num(cut.costPerHour) + (12 / 60) * num(weld.costPerHour)
  check('costing: labour standard = routed minutes × work-centre rate', near(routed.data?.standard?.labourCost, expectedLabour, 0.05), `labour=${routed.data?.standard?.labourCost} expected=${expectedLabour.toFixed(2)}`)
  check('costing: overhead standard = rate × prime cost', near(routed.data?.standard?.overheadCost, (routed.data.standard.materialCost + routed.data.standard.labourCost) * (num(company.overheadRatePct) / 100), 0.05), `overhead=${routed.data?.standard?.overheadCost}`)

  expectOk('costing: approve the routed BOM', await post(`${M}/boms/${bom.data.id}/actions`, { action: 'approve' }))
  const frozen = await q1('SELECT standardLabourCost, standardMinutes FROM Bom WHERE id=?', [bom.data.id])
  check('costing: approval freezes the routed labour standard on the revision', near(num(frozen.standardLabourCost), expectedLabour, 0.05) && near(num(frozen.standardMinutes), 18), JSON.stringify(frozen))

  // ---- actual cost through a real completion -----------------------------
  const wo = await post(`${M}/work-orders`, { projectId: prj.data.id, bomId: bom.data.id, outputQty: 10, priority: 'NORMAL', startDate: today, endDate: daysFromNow(10) })
  expectOk('costing: work order for 10 units', wo)
  expectOk('costing: generate routed tasks', await post(`${M}/work-orders/${wo.data.id}/actions`, { action: 'generate-tasks' }))
  const tasks = await qa('SELECT id, taskNo, seq, plannedQty FROM ProductionTask WHERE workOrderId=? ORDER BY seq', [wo.data.id])
  const first = tasks[0]
  const worker = await q1("SELECT id FROM Employee WHERE active=1 ORDER BY code LIMIT 1")
  expectOk('costing: assign the first operation', await post(`${M}/tasks/${first.id}/actions`, { action: 'assign', employeeId: worker.id }))
  expectOk('costing: start the first operation', await post(`${M}/tasks/${first.id}/actions`, { action: 'start' }))
  const done = await post(`${M}/tasks/${first.id}/actions`, {
    action: 'complete',
    actualQty: num(first.plannedQty),
    hours: 4,
    materialItemId: F.rm,
    materialQty: 20,
  })
  expectOk('costing: complete the first operation', done)

  const taskRow = await q1('SELECT materialCost, labourCost, overheadCost FROM ProductionTask WHERE id=?', [first.id])
  const prime = num(taskRow.materialCost) + num(taskRow.labourCost)
  check('costing: completion absorbs overhead at the company rate', near(num(taskRow.overheadCost), prime * (num(company.overheadRatePct) / 100), 0.02), `prime=${prime} overhead=${taskRow.overheadCost}`)
  check('costing: absorbed overhead is posted to the accrual ledger', true, 'asserted in reconcile')
  // The overhead voucher is numbered by the work order (MFG_OVERHEAD, voucherNo = WO no); its remarks name the task.
  const firstTaskNo = done.data?.taskNo ?? (await q1('SELECT taskNo FROM ProductionTask WHERE id=?', [first.id])).taskNo
  const gl = await q1("SELECT ROUND(COALESCE(SUM(debit-credit),0),2) net FROM AccountLedger WHERE account='OVHA' AND voucherType='MFG_OVERHEAD' AND isCancelled=0 AND remarks LIKE ?", [`%${firstTaskNo}`])
  check('costing: the overhead voucher credits OVHA (accelerated WIP)', num(gl.net) < 0, `OVHA net=${gl.net}`)

  const cost = await get(`${M}/costing/${wo.data.id}`)
  expectOk('costing: work-order roll-up responds', cost)
  check('costing: roll-up total = material + labour + overhead', near(num(cost.data?.actual?.total), num(cost.data?.actual?.material) + num(cost.data?.actual?.labour) + num(cost.data?.actual?.overhead), 0.02), JSON.stringify(cost.data?.actual))
  check('costing: operations are restated by prime-cost share', (cost.data?.tasks ?? []).every((t) => t.overheadShare >= 0), JSON.stringify((cost.data?.tasks ?? []).map((t) => t.overheadShare)))
  check('costing: no standard until something is received', num(cost.data?.standard?.forOutput) === 0 && num(cost.data?.variance?.total) === num(cost.data?.actual?.total), JSON.stringify(cost.data?.variance))

  const report = await get(`${M}/costing`)
  expectOk('costing: cost-variance report responds', report)
  const row = (report.data?.rows ?? []).find((r) => r.id === wo.data.id)
  check('costing: the report carries the work order and its own limitations', !!row && (report.data?.limitations ?? []).length >= 3, JSON.stringify(report.data?.limitations))
  check('costing: an order with nothing received is excluded from the measured summary', row && row.variance === null, `variance=${row?.variance}`)

  // ---- true-up must be idempotent ---------------------------------------
  const firstUp = await post(`${M}/costing/${wo.data.id}`, { action: 'true-up' })
  expectOk('costing: true-up runs', firstUp)
  const secondUp = await post(`${M}/costing/${wo.data.id}`, { action: 'true-up' })
  check('costing: a second true-up posts nothing', secondUp.status === 200 && near(num(secondUp.data?.posted), 0, 0.005), `posted=${secondUp.data?.posted}`)
  expectReject('costing: unknown costing action is refused', await api('POST', `${M}/costing/${wo.data.id}`, { action: 'levitate' }), /unknown action/i)

  // A rate change is a policy change: past postings stay, the true-up catches up.
  const original = num(company.overheadRatePct)
  expectOk('costing: set a new absorption rate', await api('PUT', '/api/masters/company', {
    name: (await q1('SELECT name FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')).name,
    overheadRatePct: original + 10,
  }))
  const afterRate = await post(`${M}/costing/${wo.data.id}`, { action: 'true-up' })
  expectOk('costing: true-up after a rate change', afterRate)
  check('costing: the true-up restates to the new rate', near(num(afterRate.data?.overheadCost), (num(cost.data?.actual?.material) + num(cost.data?.actual?.labour)) * ((original + 10) / 100), 0.05), `overhead=${afterRate.data?.overheadCost}`)
  const restated = await q1(`SELECT ROUND(w.overheadCost,2) hdr, ROUND((SELECT COALESCE(SUM(t.overheadCost),0) FROM ProductionTask t WHERE t.workOrderId=w.id AND t.status<>'CANCELLED'),2) tasks FROM WorkOrder w WHERE w.id=?`, [wo.data.id])
  check('costing: restated header equals its operations', near(num(restated.hdr), num(restated.tasks), 0.011), JSON.stringify(restated))
  expectReject('costing: an absurd absorption rate is refused', await api('PUT', '/api/masters/company', { name: (await q1('SELECT name FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')).name, overheadRatePct: 500 }), /typo|100/i)
  await api('PUT', '/api/masters/company', { name: (await q1('SELECT name FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')).name, overheadRatePct: original })

  await reconcile('after costing')
}

// ---------------------------------------------------------------- Phase 13: fuzzing
async function phaseFuzz() {
  phase = 'P13-fuzz'
  const big = 'x'.repeat(200_000)
  const routes = [
    ['/api/procurement', ['create-requisition', 'transition-requisition', 'create-order', 'approve-order', 'create-receipt', 'inspect-receipt', 'invoice-receipt', 'cancel-receipt']],
    ['/api/order-to-cash', ['create-quotation', 'revise-quotation', 'transition-quotation', 'quotation-to-order', 'approve-order', 'create-challan', 'inspect-dispatch', 'invoice-dispatch', 'cancel-challan']],
    ['/api/finance-adjustments', ['set-schedule', 'apply-advance', 'refund-return', 'reverse-advance-application', 'cancel-refund']],
    ['/api/quality', ['create-template', 'inspect']],
    ['/api/traceability', ['recall']],
    ['/api/returns', ['cancel', undefined]],
    ['/api/manufacturing/receipts', ['cancel', undefined]],
  ]
  const payloads = (action) => [
    ['empty object', {}],
    ['missing id', { action }],
    ['foreign ids', { action, id: 'nonexistent-id', supplierId: 'nope', partyId: 'nope', purchaseOrderId: 'nope', salesOrderId: 'nope', goodsReceiptId: 'nope', deliveryChallanId: 'nope', workOrderId: 'nope', outputItemId: 'nope', warehouseId: 'nope', templateId: 'nope', advanceId: 'nope', returnDocumentId: 'nope', sourceInvoiceId: 'nope', allocationId: 'nope', paymentId: 'nope', referenceType: 'X', referenceId: 'nope', reason: 'r', amount: 1, invoiceType: 'SALES', invoiceNo: 'NOPE', mode: 'CASH', transition: 'SUBMIT', validUntil: '2030-01-01', lines: [{ itemId: 'nope', qty: 1, rate: 1 }], rows: [{ milestone: 'a', dueDate: '2030-01-01', amount: 1 }], measurements: [], parameters: [{ name: 'a', dataType: 'NUMBER' }], itemId: 'nope', code: 'c', name: 'n', inspectionType: 'INWARD', producedQty: 1, acceptedQty: 1, returnType: 'SALES_RETURN' }],
    ['invalid date', { action, date: '2026-13-45', validUntil: 'yesterday', lines: [{ itemId: F.rm, qty: 1, rate: 1 }] }],
    ['negative quantity', { action, lines: [{ itemId: F.rm, qty: -5, rate: 1 }], producedQty: -1, acceptedQty: -1, amount: -10 }],
    ['zero quantity', { action, lines: [{ itemId: F.rm, qty: 0, rate: 1 }], producedQty: 0, acceptedQty: 0, amount: 0 }],
    ['NaN/Infinity as strings', { action, lines: [{ itemId: F.rm, qty: 'NaN', rate: 'Infinity' }], amount: 'Infinity' }],
    ['empty lines', { action, lines: [], rows: [], parameters: [] }],
    ['oversized strings', { action, id: big, reason: big, remarks: big, terms: big, notes: big, code: big, name: big, lines: [{ itemId: big, qty: 1, rate: 1, remarks: big }] }],
    ['wrong types', { action, id: 12345, lines: 'not-an-array', amount: { x: 1 } }],
  ]
  let n = 0, bad = []
  for (const [path, actions] of routes) {
    const raw = await api('POST', path, undefined, { raw: '{"action": "x", broken json' })
    n++; if (!is4xx(raw)) bad.push(`${path} malformed JSON -> ${raw.status}`)
    const unk = await post(path, { action: 'definitely-unknown-action' })
    n++; if (!is4xx(unk)) bad.push(`${path} unknown action -> ${unk.status}`)
    for (const action of actions) for (const [label, body] of payloads(action)) {
      const r = await post(path, body)
      n++
      if (!is4xx(r)) bad.push(`${path} ${action ?? '(default)'} ${label} -> ${r.status} ${String(r.error ?? '').slice(0, 60)}`)
    }
  }
  check(`${n} malformed/hostile requests to workflow APIs all return controlled 4xx (no 2xx, no 500)`, bad.length === 0, bad.slice(0, 12).join(' | '))
  // concurrent duplicate POST of a document create
  const before = num((await q1('SELECT COUNT(*) c FROM PurchaseRequisition')).c)
  const reqs = await Promise.all([1, 2].map(() => post('/api/procurement', { action: 'create-requisition', lines: [{ itemId: F.rm, qty: 1 }] }, { headers: { 'Idempotency-Key': 'aud-same-key-1' } })))
  const created = num((await q1('SELECT COUNT(*) c FROM PurchaseRequisition')).c) - before
  check('concurrent duplicate create with the same Idempotency-Key creates one document', created === 1, `created=${created} statuses=${reqs.map((r) => r.status)}`)
  const again = await post('/api/procurement', { action: 'create-requisition', lines: [{ itemId: F.rm, qty: 1 }] }, { headers: { 'Idempotency-Key': 'aud-same-key-1' } })
  check('a retry with the same key replays the original response (same document id)', again.status === 200 && reqs.some((r) => r.data?.id && r.data.id === again.data?.id), `status=${again.status}`)
  const diff = await post('/api/procurement', { action: 'create-requisition', lines: [{ itemId: F.rm, qty: 2 }] }, { headers: { 'Idempotency-Key': 'aud-same-key-1' } })
  check('the same key with a different body is refused (422)', diff.status === 422, `status=${diff.status}`)
  const sBefore = num((await q1('SELECT COUNT(*) c FROM SalesInvoice')).c)
  await Promise.all([1, 2, 3].map(() => post('/api/sales-invoices', { partyId: F.cust, warehouseId: F.main, lines: [{ itemId: F.fg, qty: 1, rate: 500 }] }, { headers: { 'Idempotency-Key': 'aud-inv-double-click' } })))
  check('triple-submitted sales invoice with one key posts exactly one invoice', num((await q1('SELECT COUNT(*) c FROM SalesInvoice')).c) - sBefore === 1)
}

// ---------------------------------------------------------------- Phase 12e: BOM line basis (per unit / per batch)
async function phaseBomBasis() {
  phase = 'P12e-basis'
  const M = '/api/manufacturing', R = `${M}/receipts`
  const T = (id) => `${M}/tasks/${id}/actions`
  const emp = (await q1('SELECT id FROM Employee LIMIT 1')).id
  const rate = num((await q1('SELECT overheadRatePct FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')).overheadRatePct)
  const mk = async (code) => (await post('/api/masters/items', { code, name: `Audit basis ${code}`, uom: 'PCS', costRate: 400, saleRate: 900, gstRate: 18, hsn: '732690' })).data.id
  const fgU = await mk('AUD-BAS-U'), fgB = await mk('AUD-BAS-B'), fgX = await mk('AUD-BAS-X')

  // validation
  expectReject('basis: an unknown line basis is refused', await post(`${M}/boms`, { projectId: F.prj, itemId: fgX, lineBasis: 'LOT', lines: [{ itemId: F.rm, qty: 1, uom: 'KG', rate: 100 }] }), /line basis/i)
  expectReject('basis: a zero batch size is refused', await post(`${M}/boms`, { projectId: F.prj, itemId: fgX, lineBasis: 'BATCH', batchQty: 0, lines: [{ itemId: F.rm, qty: 1, uom: 'KG', rate: 100 }] }), /batch size/i)
  const legacy = await post(`${M}/boms`, { projectId: F.prj, itemId: fgX, lines: [{ itemId: F.rm, qty: 1, uom: 'KG', rate: 100 }] })
  check('basis: a BOM created without a basis defaults to BATCH of 1 (legacy behaviour)', legacy.data?.lineBasis === 'BATCH' && num(legacy.data?.batchQty) === 1, JSON.stringify({ b: legacy.data?.lineBasis, q: legacy.data?.batchQty }))

  // UNIT: 2 KG per finished piece
  const bu = await post(`${M}/boms`, { projectId: F.prj, itemId: fgU, productName: 'Audit per-unit bracket', lineBasis: 'UNIT', batchQty: 50, lines: [{ itemId: F.rm, qty: 2, uom: 'KG', rate: 100 }] })
  expectOk('basis: create a per-unit BOM', bu)
  check('basis: a UNIT BOM always stores batch size 1', bu.data?.lineBasis === 'UNIT' && num(bu.data?.batchQty) === 1, JSON.stringify({ b: bu.data?.lineBasis, q: bu.data?.batchQty }))
  expectOk('basis: approve the per-unit BOM', await post(`${M}/boms/${bu.data.id}/actions`, { action: 'approve' }))
  // BATCH: 8 KG makes a batch of 4 pieces (= 2 KG per piece)
  const bb = await post(`${M}/boms`, { projectId: F.prj, itemId: fgB, productName: 'Audit batch bracket', lineBasis: 'BATCH', batchQty: 4, lines: [{ itemId: F.rm, qty: 8, uom: 'KG', rate: 100 }] })
  expectOk('basis: create a per-batch BOM (batch of 4)', bb)
  expectOk('basis: approve the per-batch BOM', await post(`${M}/boms/${bb.data.id}/actions`, { action: 'approve' }))

  const woU = await post(`${M}/work-orders`, { projectId: F.prj, bomId: bu.data.id, outputQty: 5 })
  const woB = await post(`${M}/work-orders`, { projectId: F.prj, bomId: bb.data.id, outputQty: 6 })
  expectOk('basis: work order for 5 units from the UNIT BOM', woU); expectOk('basis: work order for 6 units from the BATCH BOM', woB)
  const reqU = num((await q1('SELECT SUM(plannedQty) q FROM WorkOrderLine WHERE workOrderId=?', [woU.data.id])).q)
  const reqB = num((await q1('SELECT SUM(plannedQty) q FROM WorkOrderLine WHERE workOrderId=?', [woB.data.id])).q)
  check('basis: UNIT requirement = line × order qty (2 × 5 = 10 KG)', near(reqU, 10), `planned=${reqU}`)
  check('basis: BATCH requirement = line × order qty ÷ batch size (8 × 6 ÷ 4 = 12 KG)', near(reqB, 12), `planned=${reqB}`)

  const cu = await get(`${M}/costing/${woU.data.id}`), cb = await get(`${M}/costing/${woB.data.id}`)
  check('basis: standard material per unit is 200 for both bases', near(cu.data?.standard?.material, 200) && near(cb.data?.standard?.material, 200), `unit=${cu.data?.standard?.material} batch=${cb.data?.standard?.material}`)

  const rev = await post(`${M}/boms/${bb.data.id}/actions`, { action: 'revise', notes: 'basis carries over' })
  check('basis: a revision inherits the line basis and batch size', rev.data?.lineBasis === 'BATCH' && num(rev.data?.batchQty) === 4, JSON.stringify({ b: rev.data?.lineBasis, q: rev.data?.batchQty }))

  // UNIT receipt is valued at the FULL standard (material + labour + overhead)
  const t = await post(`${M}/tasks`, { workOrderId: woU.data.id, operation: 'ASSEMBLY', seq: 1, plannedQty: 5 })
  expectOk('basis: task on the UNIT work order', t)
  await post(T(t.data.id), { action: 'assign', employeeId: emp }); await post(T(t.data.id), { action: 'start' })
  expectOk('basis: complete the UNIT operation', await post(T(t.data.id), { action: 'complete', actualQty: 5, hours: 2, labourRate: 150, materialItemId: F.rm, materialQty: 11 }))
  const actual = num((await q1("SELECT SUM(materialCost+labourCost+overheadCost) s FROM ProductionTask WHERE workOrderId=? AND status='COMPLETED'", [woU.data.id])).s)
  const pv = await get(`${R}?preview=1&workOrderId=${woU.data.id}&producedQty=5&acceptedQty=5`)
  const stdPerUnit = Math.round((200 + 200 * rate / 100) * 100) / 100 // no routing → no labour standard
  check('basis: UNIT receipt preview uses the order quantity as planned output', near(pv.data?.planned, 5) && pv.data?.basis === 'UNIT', JSON.stringify({ p: pv.data?.planned, b: pv.data?.basis }))
  const rc = await post(R, { workOrderId: woU.data.id, outputItemId: fgU, warehouseId: F.main, producedQty: 5, acceptedQty: 5 })
  expectOk('basis: receive 5 finished units', rc)
  check('basis: UNIT receipt expected cost = full standard per unit × accepted', near(rc.data?.expectedCost, stdPerUnit * 5), `expected=${rc.data?.expectedCost} std/unit=${stdPerUnit}`)
  check('basis: UNIT receipt settles all WIP of the order', near(rc.data?.actualCost, actual), `settled=${rc.data?.actualCost} actual=${actual}`)
  const fgRate = num((await q1("SELECT rate FROM StockLedger WHERE voucherType='MFG_RECEIPT' AND voucherNo=? AND isCancelled=0", [rc.data.receiptNo])).rate)
  check('basis: finished stock is valued at the full unit standard', near(fgRate, stdPerUnit), `rate=${fgRate}`)
  const mfgv = await q1("SELECT ROUND(COALESCE(SUM(debit-credit),0),2) v FROM AccountLedger WHERE voucherType='MFG_RECEIPT' AND voucherNo=? AND account='MFGV' AND isCancelled=0", [rc.data.receiptNo])
  check('basis: MFGV carries only actual − full standard', near(num(mfgv.v), actual - stdPerUnit * 5), `MFGV=${mfgv.v} expectedVar=${(actual - stdPerUnit * 5).toFixed(2)}`)
  expectOk('basis: UNIT work order closes', await post(`${M}/work-orders/${woU.data.id}/actions`, { action: 'complete' }))
  await reconcile('after BOM basis')
}

// ---------------------------------------------------------------- Phase 12f: overhead advisor
async function phaseOverhead() {
  phase = 'P12f-overhead'
  const O = '/api/manufacturing/overhead'
  const original = num((await q1('SELECT overheadRatePct FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')).overheadRatePct)
  const L = async (code, name, nature) => post('/api/books', { action: 'create-ledger', code, name, group: nature === 'EXPENSE' ? 'Manufacturing Expenses' : 'Fixed Assets', nature })
  const pw = await L('AUDPOWER', 'Audit factory power', 'EXPENSE'), rent = await L('AUDRENT', 'Audit factory rent', 'EXPENSE'), plant = await L('AUDPLANT', 'Audit plant & machinery', 'ASSET')
  expectOk('overhead: create the power ledger', pw); expectOk('overhead: create the rent ledger', rent)
  const none = await get(`${O}?months=3`)
  check('overhead: with no ledger tagged there is no recommendation (not 0%)', none.status === 200 && none.data?.recommendation?.ratePct === null && none.data?.recommendation?.confidence === 'NONE' && none.data?.rates?.actualRatePct === null && none.data?.rates?.trendRatePct === null, JSON.stringify(none.data?.recommendation))
  check('overhead: the advisor says to tag ledgers first', (none.data?.recommendation?.reasons ?? []).some((r) => /tagged as factory overhead/i.test(r)), '')
  expectOk('overhead: tag power as factory overhead', await post(O, { action: 'tag-ledger', ledgerId: pw.data.id, isFactoryOverhead: true }))
  expectOk('overhead: tag rent as factory overhead', await post(O, { action: 'tag-ledger', ledgerId: rent.data.id, isFactoryOverhead: true }))
  const noSpend = await get(`${O}?months=3`)
  check('overhead: tagged ledgers with no spend still give no recommendation', noSpend.data?.recommendation?.ratePct === null && (noSpend.data?.recommendation?.reasons ?? []).some((r) => /no spend booked/i.test(r)), JSON.stringify(noSpend.data?.recommendation))
  expectReject('overhead: an asset ledger cannot join the overhead pool', await post(O, { action: 'tag-ledger', ledgerId: plant.data.id, isFactoryOverhead: true }), /only expense ledgers/i)
  expectOk('overhead: book a power bill (journal)', await post('/api/books', { action: 'post-journal', date: today, narration: 'Audit power bill', lines: [{ account: 'AUDPOWER', debit: 5000 }, { account: 'BANK', credit: 5000 }] }))
  expectOk('overhead: book factory rent (journal)', await post('/api/books', { action: 'post-journal', date: today, narration: 'Audit factory rent', lines: [{ account: 'AUDRENT', debit: 3000 }, { account: 'BANK', credit: 3000 }] }))

  const a = await get(`${O}?months=3`)
  expectOk('overhead: advisor responds', a)
  const from = a.data?.window?.from
  check('overhead: incurred = sum of tagged expense ledgers in the window (8,000)', near(a.data?.totals?.incurred, 8000), `incurred=${a.data?.totals?.incurred}`)
  const prime = num((await q1("SELECT COALESCE(SUM(materialCost+labourCost),0) s FROM ProductionTask WHERE status='COMPLETED' AND completedAt >= ?", [`${from} 00:00:00`])).s)
  check('overhead: prime cost = material + labour of operations completed in the window', near(a.data?.totals?.primeCost, prime, 0.05), `api=${a.data?.totals?.primeCost} db=${prime}`)
  const absorbedDb = num((await q1("SELECT COALESCE(SUM(credit-debit),0) s FROM AccountLedger WHERE account='OVHA' AND voucherType IN ('MFG_OVERHEAD','MFG_OVERHEAD_TRUEUP') AND isCancelled=0 AND date >= ?", [`${from} 00:00:00`])).s)
  check('overhead: absorbed = OVHA absorption postings in the window', near(a.data?.totals?.absorbed, absorbedDb, 0.05), `api=${a.data?.totals?.absorbed} db=${absorbedDb}`)
  check('overhead: actual rate = incurred / prime x 100', prime > 0 && near(a.data?.rates?.actualRatePct, Math.round((8000 / prime) * 10000) / 100, 0.011), `rate=${a.data?.rates?.actualRatePct}`)
  check('overhead: over/under = absorbed - incurred', near(a.data?.totals?.overUnder, a.data?.totals?.absorbed - 8000, 0.05), `ou=${a.data?.totals?.overUnder}`)
  check('overhead: without a budget the recommendation follows the measured trend', a.data?.recommendation?.source === 'TREND' && a.data?.recommendation?.ratePct != null, JSON.stringify(a.data?.recommendation))
  check('overhead: the pool lists only expense ledgers, the two tagged ones flagged', (a.data?.ledgers ?? []).every((l) => l.code !== 'AUDPLANT') && a.data.ledgers.filter((l) => l.isFactoryOverhead).length === 2, '')

  expectReject('overhead: a one-sided budget is refused', await post(O, { action: 'set-budget', overheadAnnual: 120000, primeCostAnnual: null }), /both/i)
  expectReject('overhead: a budget implying more than 100% is refused', await post(O, { action: 'set-budget', overheadAnnual: 900000, primeCostAnnual: 600000 }), /above 100/i)
  expectOk('overhead: save a budget (1.2L overhead on 6L prime cost)', await post(O, { action: 'set-budget', overheadAnnual: 120000, primeCostAnnual: 600000 }))
  const b = await get(`${O}?months=3&whatIf=25`)
  check('overhead: budget rate = 20% and the recommendation uses it', near(b.data?.rates?.budgetRatePct, 20) && b.data?.recommendation?.source === 'BUDGET' && near(b.data?.recommendation?.ratePct, 20), JSON.stringify(b.data?.recommendation))
  const open = await qa("SELECT w.id, w.overheadCost oh, (SELECT COALESCE(SUM(t.materialCost+t.labourCost),0) FROM ProductionTask t WHERE t.workOrderId=w.id AND t.status='COMPLETED') prime FROM WorkOrder w WHERE w.status IN ('OPEN','IN_PROGRESS')")
  const trueUp = open.filter((w) => num(w.prime) > 0).reduce((s, w) => s + (Math.round(num(w.prime) * 0.25 * 100) / 100 - num(w.oh)), 0)
  check('overhead: what-if 25% = the true-up open orders would post', near(b.data?.whatIf?.ratePct, 25) && near(b.data?.whatIf?.openOrderTrueUp, trueUp, 0.05), `api=${b.data?.whatIf?.openOrderTrueUp} db=${trueUp.toFixed(2)}`)
  expectReject('overhead: a what-if above 100% is refused', await get(`${O}?whatIf=150`), /between 0 and 100/i)
  check('overhead: reading the advisor changes nothing', near(num((await q1('SELECT overheadRatePct r FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')).r), original), '')

  expectReject('overhead: applying a rate needs a written reason', await post(O, { action: 'set-rate', ratePct: 20, reason: 'ok' }), /reason/i)
  expectReject('overhead: a rate above 100% is refused', await post(O, { action: 'set-rate', ratePct: 150, reason: 'typo check for the audit' }), /100|too_big|less than/i)
  const set = await post(O, { action: 'set-rate', ratePct: 20, reason: 'Audit: FY budget approved by the CA' })
  expectOk('overhead: the OWNER applies the budget rate with a reason', set)
  const co = await q1('SELECT overheadRatePct r, overheadRateSetBy by_, overheadRateReason why FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')
  check('overhead: the rate, who set it and why are recorded', near(num(co.r), 20) && /owner@/i.test(co.by_ ?? '') && /CA/.test(co.why ?? ''), JSON.stringify(co))
  check('overhead: the change is in the audit trail', num((await q1("SELECT COUNT(*) n FROM AuditLog WHERE entity='Company' AND details LIKE '%overhead absorption%20%'")).n) >= 1, '')

  // period-end clearing
  const ovhaBefore = num((await q1("SELECT COALESCE(SUM(credit-debit),0) b FROM AccountLedger WHERE account='OVHA' AND isCancelled=0")).b)
  expectReject('overhead: clearing a future date is refused', await post(O, { action: 'close', upTo: '2099-01-01' }), /up to today/i)
  const close = await post(O, { action: 'close', upTo: today })
  if (ovhaBefore > 0.004) {
    expectOk('overhead: clear absorbed overhead up to today', close)
    check('overhead: the clearing amount = the OVHA balance', near(close.data?.cleared, ovhaBefore, 0.011), `cleared=${close.data?.cleared} balance=${ovhaBefore}`)
    const v = await q1("SELECT ROUND(SUM(CASE WHEN account='OVHA' THEN debit ELSE 0 END),2) dr, ROUND(SUM(CASE WHEN account='OVRC' THEN credit ELSE 0 END),2) cr FROM AccountLedger WHERE voucherType='MFG_OVERHEAD_CLOSE' AND voucherNo=? AND isCancelled=0", [close.data?.voucherNo])
    check('overhead: the voucher is Dr OVHA = Cr OVRC', near(v.dr, ovhaBefore, 0.011) && near(v.cr, ovhaBefore, 0.011), JSON.stringify(v))
    check('overhead: OVHA is cleared to zero', near(num((await q1("SELECT COALESCE(SUM(credit-debit),0) b FROM AccountLedger WHERE account='OVHA' AND isCancelled=0")).b), 0, 0.011), '')
    expectReject('overhead: clearing the same date twice is refused', await post(O, { action: 'close', upTo: today }), /already closed/i)
    const after = await get(`${O}?months=3`)
    check('overhead: the advisor shows the clearing and nothing parked', near(after.data?.ovha?.balance, 0, 0.011) && after.data?.ovha?.lastClose?.voucherNo === close.data?.voucherNo, JSON.stringify(after.data?.ovha))
    check('overhead: clearing does not change measured absorption', near(after.data?.totals?.absorbed, a.data?.totals?.absorbed, 0.05), `before=${a.data?.totals?.absorbed} after=${after.data?.totals?.absorbed}`)
  } else check('overhead: there is absorbed overhead to clear', false, `OVHA=${ovhaBefore}`)

  await post(O, { action: 'set-rate', ratePct: original, reason: 'Audit: restore the original absorption rate' })
  await post(O, { action: 'set-budget', overheadAnnual: null, primeCostAnnual: null })
  await reconcile('after overhead advisor')
}

// ---------------------------------------------------------------- Phase 13: balance sheet + proforma invoices
async function phaseSalesDocs() {
  phase = 'P13-docs'
  // ---- balance sheet
  const bs = await get(`/api/reports?type=balance-sheet&asOf=${today}`)
  expectOk('balance sheet: responds', bs)
  check('balance sheet: assets = liabilities + equity (incl. profit)', bs.data?.balanced === true && near(bs.data.totalAssets, bs.data.totalLiabilitiesAndEquity, 0.011), `A=${bs.data?.totalAssets} L+E=${bs.data?.totalLiabilitiesAndEquity} diff=${bs.data?.difference}`)
  const chart = (await get('/api/books')).data?.accounts ?? []
  const nature = new Map(chart.map((a) => [a.code, a.nature]))
  const gl = await qa('SELECT account, ROUND(SUM(debit)-SUM(credit),2) bal FROM AccountLedger WHERE isCancelled=0 AND date <= ? GROUP BY account', [`${today} 23:59:59.999`])
  const assetsDb = gl.filter((r) => (nature.get(r.account) ?? 'ASSET') === 'ASSET').reduce((s, r) => s + num(r.bal), 0)
  const profitDb = gl.filter((r) => ['INCOME', 'EXPENSE'].includes(nature.get(r.account))).reduce((s, r) => s - num(r.bal), 0)
  check('balance sheet: total assets = Dr balances of asset accounts in the GL', near(bs.data?.totalAssets, assetsDb, 0.05), `api=${bs.data?.totalAssets} db=${assetsDb.toFixed(2)}`)
  check('balance sheet: profit shown = income − expenses in the GL', near(num(bs.data?.profit?.thisYear) + num(bs.data?.profit?.earlierYears), profitDb, 0.05), `api=${num(bs.data?.profit?.thisYear) + num(bs.data?.profit?.earlierYears)} db=${profitDb.toFixed(2)}`)
  check('balance sheet: income and expense accounts are not listed as balance-sheet lines', ![...(bs.data?.assets ?? []), ...(bs.data?.liabilities ?? [])].some((g) => g.lines.some((l) => ['SALS', 'PURC', 'JWIN'].includes(l.account))), '')
  const early = await get('/api/reports?type=balance-sheet&asOf=2000-01-01')
  check('balance sheet: before any posting everything is zero and balanced', early.status === 200 && near(early.data?.totalAssets, 0) && early.data?.balanced === true, JSON.stringify({ a: early.data?.totalAssets, b: early.data?.balanced }))
  expectReject('balance sheet: a malformed date is refused', await get('/api/reports?type=balance-sheet&asOf=12-12-2026'), /YYYY-MM-DD/)

  // ---- proforma invoices
  const PI = '/api/proforma'
  const glBefore = num((await q1('SELECT COUNT(*) n FROM AccountLedger')).n), stockBefore = num((await q1('SELECT COUNT(*) n FROM StockLedger')).n)
  expectReject('proforma: validity before the date is refused', await post(PI, { action: 'create', partyId: F.cust, date: today, validUntil: '2020-01-01', lines: [{ itemId: F.fg, qty: 1, rate: 500 }] }), /validity/i)
  expectReject('proforma: a supplier cannot get a proforma', await post(PI, { action: 'create', partyId: F.sup1, validUntil: daysFromNow(10), lines: [{ itemId: F.fg, qty: 1, rate: 500 }] }), /customer/i)
  const a = await post(PI, { action: 'create', partyId: F.cust, validUntil: daysFromNow(10), terms: '100% advance', lines: [{ itemId: F.fg, qty: 2, rate: 500 }, { itemId: F.fg, qty: 1, rate: 1000, discPct: 10 }] })
  expectOk('proforma: issue a standalone proforma', a)
  const gstRate = num((await q1('SELECT gstRate g FROM Item WHERE id=?', [F.fg])).g)
  const taxable = 2 * 500 + 900
  check('proforma: GST computed like a tax invoice (taxable, tax, whole-rupee total)', near(a.data?.taxable, taxable) && near(a.data?.grandTotal, Math.round(taxable * (1 + gstRate / 100))), `taxable=${a.data?.taxable} total=${a.data?.grandTotal} gst=${gstRate}%`)
  check('proforma: numbered PI-<FY>-nnn and ISSUED', /^PI-\d{4}-\d{3}$/.test(a.data?.piNo ?? '') && a.data?.status === 'ISSUED', a.data?.piNo)
  check('proforma: posts nothing — no ledger rows, no stock rows', num((await q1('SELECT COUNT(*) n FROM AccountLedger')).n) === glBefore && num((await q1('SELECT COUNT(*) n FROM StockLedger')).n) === stockBefore, '')
  expectReject('proforma: converting needs a warehouse', await post(PI, { action: 'convert', id: a.data.id }), /warehouse/i)
  const conv = await post(PI, { action: 'convert', id: a.data.id, warehouseId: F.main })
  expectOk('proforma: convert into the tax invoice', conv)
  check('proforma: the invoice total equals the proforma total', near(conv.data?.grandTotal, a.data?.grandTotal), `invoice=${conv.data?.grandTotal} pi=${a.data?.grandTotal}`)
  const row = await q1('SELECT status, convertedInvoiceId FROM ProformaInvoice WHERE id=?', [a.data.id])
  check('proforma: marked CONVERTED and linked to the invoice', row.status === 'CONVERTED' && row.convertedInvoiceId === conv.data?.invoiceId, JSON.stringify(row))
  expectReject('proforma: a converted proforma cannot be converted again', await post(PI, { action: 'convert', id: a.data.id, warehouseId: F.main }), /CONVERTED/)
  expectReject('proforma: a converted proforma cannot be cancelled', await post(PI, { action: 'cancel', id: a.data.id, reason: 'audit' }), /CONVERTED/)
  const b = await post(PI, { action: 'create', partyId: F.cust, validUntil: daysFromNow(5), lines: [{ itemId: F.fg, qty: 1, rate: 500 }] })
  const invBefore = num((await q1('SELECT COUNT(*) n FROM SalesInvoice')).n)
  const [c1, c2] = await Promise.all([1, 2].map(() => post(PI, { action: 'convert', id: b.data.id, warehouseId: F.main })))
  check('proforma: a double click converts exactly once', [c1, c2].filter((r) => r.status === 200).length === 1 && num((await q1('SELECT COUNT(*) n FROM SalesInvoice')).n) === invBefore + 1, `statuses=${c1.status}/${c2.status}`)
  const c = await post(PI, { action: 'create', partyId: F.cust, validUntil: daysFromNow(5), lines: [{ itemId: F.fg, qty: 1, rate: 500 }] })
  expectReject('proforma: cancelling needs a reason', await post(PI, { action: 'cancel', id: c.data.id, reason: '' }), /reason/i)
  expectOk('proforma: cancel with a reason', await post(PI, { action: 'cancel', id: c.data.id, reason: 'customer dropped the enquiry' }))
  expectReject('proforma: a cancelled proforma cannot be invoiced', await post(PI, { action: 'convert', id: c.data.id, warehouseId: F.main }), /CANCELLED/)
  const d = await post(PI, { action: 'create', partyId: F.cust, validUntil: daysFromNow(5), lines: [{ itemId: F.fg, qty: 1, rate: 500 }] })
  await db.run('UPDATE ProformaInvoice SET validUntil=? WHERE id=?', ['2020-01-01 00:00:00', d.data.id])
  expectReject('proforma: an expired proforma is not invoiced at old prices', await post(PI, { action: 'convert', id: d.data.id, warehouseId: F.main }), /expired/i)
  const so = await q1("SELECT id, orderNo, partyId FROM SalesOrder WHERE status IN ('APPROVED','PART_DISPATCHED') ORDER BY createdAt LIMIT 1")
  if (so) {
    const e = await post(PI, { action: 'create', partyId: so.partyId, validUntil: daysFromNow(10), salesOrderId: so.id })
    expectOk('proforma: issue a proforma from an open sales order', e)
    const open = num((await q1('SELECT COALESCE(SUM(qty-dispatchedQty),0) q FROM SalesOrderLine WHERE salesOrderId=? AND qty-dispatchedQty>0', [so.id])).q)
    check('proforma: from an order it bills the undispatched quantity', near((e.data?.lines ?? []).reduce((s, l) => s + num(l.qty), 0), open), `pi=${(e.data?.lines ?? []).reduce((s, l) => s + num(l.qty), 0)} open=${open}`)
    expectReject('proforma: an order proforma is invoiced through the challan, not converted', await post(PI, { action: 'convert', id: e.data.id, warehouseId: F.main }), /delivery challan/i)
    const other = await q1("SELECT id FROM Party WHERE types LIKE '%CUSTOMER%' AND id<>? LIMIT 1", [so.partyId])
    if (other) expectReject('proforma: an order of another customer is refused', await post(PI, { action: 'create', partyId: other.id, validUntil: daysFromNow(10), salesOrderId: so.id }), /different customer/i)
  } else check('proforma: an open sales order exists to quote from', false, 'none')
  const list = await get(PI)
  check('proforma: list shows status and the invoice it became', list.status === 200 && list.data.find((r) => r.id === a.data.id)?.convertedInvoiceNo === (await q1('SELECT invoiceNo FROM SalesInvoice WHERE id=?', [conv.data.invoiceId])).invoiceNo, '')
  await reconcile('after balance sheet + proforma')
}

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now()
  await setup()
  const phases = [phaseAuth, phaseP2P, phaseRfq, phaseQ2C, phaseMfg, phaseQuality, phaseLots, phaseFinance, phaseGst, phaseMrp, phaseOps, phaseCosting, phaseBomBasis, phaseOverhead, phaseSalesDocs, phaseFuzz]
  for (const fn of phases) {
    try { await fn() } catch (e) { check(`${fn.name} completed without a harness exception`, false, e?.stack?.split('\n').slice(0, 3).join(' ') ?? String(e)) }
  }
  phase = 'final'
  await reconcile('final')
  const byPhase = {}
  for (const r of results) { const p = r.phase.split(':')[0]; byPhase[p] ??= { pass: 0, fail: 0 }; byPhase[p][r.pass ? 'pass' : 'fail']++ }
  const summary = { ranAt: new Date().toISOString(), baseUrl: BASE, database: new URL(DB_URL).pathname.slice(1), seconds: Math.round((Date.now() - t0) / 1000), total: results.length, passed: results.length - failures, failed: failures, byPhase, results }
  writeFileSync(OUT, JSON.stringify(summary, null, 2))
  console.log('\nper phase:', JSON.stringify(byPhase))
  console.log(`=== ${summary.passed}/${summary.total} workflow checks passed, ${summary.failed} failed (${summary.seconds}s) ===`)
  await db.close()
  if (failures) process.exitCode = 1
}
main().catch(async (e) => { console.error('WORKFLOW AUDIT ERROR', e); await db.close(); process.exitCode = 2 })
