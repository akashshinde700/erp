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
  const wip = await qa(`SELECT w.woNo, ROUND((SELECT COALESCE(SUM(t.materialCost+t.labourCost),0) FROM ProductionTask t WHERE t.workOrderId=w.id AND t.status<>'CANCELLED'),2) actual,
      ROUND((SELECT COALESCE(SUM(r.actualCost),0) FROM ProductionReceipt r WHERE r.workOrderId=w.id AND r.status='POSTED'),2) settled FROM WorkOrder w WHERE w.status='COMPLETED' HAVING ABS(actual-settled) > 0.011`)
  check(`${label}: completed work orders have WIP fully settled`, wip.length === 0, JSON.stringify(wip.slice(0, 3)))
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
  const bom = await post(`${M}/boms`, { projectId: F.prj, productName: 'Audit Bracket', lines: [{ itemId: F.rm, qty: 10, uom: 'KG', rate: 100 }] })
  expectOk('create BOM', bom); F.bom = bom.data.id
  expectOk('approve BOM', await post(`${M}/boms/${F.bom}/actions`, { action: 'approve' }))
  const wo = await post(`${M}/work-orders`, { projectId: F.prj, bomId: F.bom, priority: 'HIGH' })
  expectOk('work order from approved BOM', wo); F.wo = wo.data.id
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
  const actualTotal = num((await q1("SELECT SUM(materialCost+labourCost) s FROM ProductionTask WHERE workOrderId=? AND status='COMPLETED'", [F.wo])).s)
  const bomCost = num((await q1('SELECT SUM(estCost) s FROM BomItem WHERE bomId=?', [F.bom])).s)
  const ra = await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 4, acceptedQty: 4, batchNo: 'FGLOT-A', manufacturedAt: today })
  expectOk('FG receipt A (4 of 10)', ra)
  check('12 expected cost comes from BOM (4/10 of BOM est cost)', near(ra.data.expectedCost, bomCost * 0.4), `expected=${ra.data?.expectedCost} bom=${bomCost}`)
  check('13 actual cost is 4/10 of material + labour', near(ra.data.actualCost, actualTotal * 0.4), `actual=${ra.data?.actualCost} total=${actualTotal}`)
  check('14 variance = actual - expected', near(ra.data.variance, num(ra.data.actualCost) - num(ra.data.expectedCost)), JSON.stringify({ a: ra.data?.actualCost, e: ra.data?.expectedCost, v: ra.data?.variance }))
  const w2Pre = await stockNet(F.fg, F.w2)
  expectOk('20 cancel FG receipt A (stock still on hand)', await post(R, { action: 'cancel', id: ra.data.id }))
  check('20 cancellation reverses FG stock', near(await stockNet(F.fg, F.w2), w2Pre - 4), `now=${await stockNet(F.fg, F.w2)}`)
  const mrGl = await qa("SELECT isCancelled, ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr, COUNT(*) n FROM AccountLedger WHERE voucherType='MFG_RECEIPT' AND voucherNo=? GROUP BY isCancelled", [ra.data.receiptNo])
  check('20 cancellation writes a mirrored GL reversal (no active rows left)', mrGl.length === 1 && num(mrGl[0].isCancelled) === 1 && near(mrGl[0].dr, mrGl[0].cr), JSON.stringify(mrGl))
  const rb = await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 4, acceptedQty: 4, batchNo: 'FGLOT-B', manufacturedAt: today })
  expectOk('FG receipt B (4 of 10)', rb)
  const rc = await post(R, { workOrderId: F.wo, outputItemId: F.fg, warehouseId: F.w2, producedQty: 6, acceptedQty: 5, rejectedQty: 1, qcNotes: 'weld porosity', batchNo: 'FGLOT-C', manufacturedAt: today })
  expectOk('FG receipt C (produced 6: 5 accepted, 1 rejected)', rc)
  const settled = num((await q1("SELECT SUM(actualCost) s FROM ProductionReceipt WHERE workOrderId=? AND status='POSTED'", [F.wo])).s)
  check('15/16 producing the full planned 10 settles all WIP even with a QC rejection', near(settled, actualTotal), `settled=${settled} actual=${actualTotal} residue=${(actualTotal - settled).toFixed(2)}`)
  const close = await post(`${M}/work-orders/${F.wo}/actions`, { action: 'complete' })
  check('WO closes once FG is received and WIP settled', close.status === 200, `status=${close.status} ${close.error ?? ''}`)
  // 18: WIP guard on a second work order with only a partial receipt
  const bom2 = await post(`${M}/boms`, { projectId: F.prj, productName: 'Audit Bracket II', lines: [{ itemId: F.rm, qty: 5, uom: 'KG', rate: 100 }] })
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
  async function readyWo(name, plannedQty) {
    const bom = await post(`${M}/boms`, { projectId: F.prj, productName: name, lines: [{ itemId: F.rm, qty: 1, uom: 'KG', rate: 100 }] })
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

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now()
  await setup()
  const phases = [phaseAuth, phaseP2P, phaseQ2C, phaseMfg, phaseQuality, phaseLots, phaseFinance, phaseGst, phaseFuzz]
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
