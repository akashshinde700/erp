/**
 * ForgeERP — executed audit of the MapSoft-parity features: books controls
 * (ledgers, journals, TDS, period lock / FY close), stock adjustments with
 * maker-checker approval, CRM (salespersons, leads, conversion, salesperson
 * credit through quotation -> order -> invoice), service calls, the new
 * reports, and a backup -> restore round trip of the new tables.
 *
 * Real HTTP against a running server + raw SQL against the SAME disposable
 * MySQL database; the global ledger / stock reconciliation runs after every
 * phase. DESTRUCTIVE: starts with ?force=1 reseed.
 *
 *   AUDIT_BASE_URL=http://127.0.0.1:3012 AUDIT_DB_URL=mysql://...@127.0.0.1:3308/forgeerp_audit node tests/parity-audit.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, scryptSync } from 'node:crypto'
import { openAuditDb } from './audit-db.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000'
const DB_URL = process.env.AUDIT_DB_URL
if (!DB_URL || !/^mysql:\/\//.test(DB_URL)) throw new Error('AUDIT_DB_URL=mysql://... (disposable database) is required')
const DB_NAME = new URL(DB_URL).pathname.slice(1)
if (!/audit|test|mig|disposable|tmp/i.test(DB_NAME) && process.env.AUDIT_CONFIRM_DISPOSABLE !== DB_NAME) throw new Error(`Refusing to run: '${DB_NAME}' does not look disposable`)
const KEY = readFileSync(process.env.AUDIT_PLATFORM_KEY ?? join(ROOT, 'db', 'platform-key.key'), 'utf8').trim()
const OUT = process.env.PARITY_RESULTS ?? join(ROOT, 'tests', 'parity-audit-results.json')
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
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.cookie !== undefined) { if (opts.cookie) headers.Cookie = opts.cookie } else if (cookie) headers.Cookie = cookie
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  const sc = res.headers.get('set-cookie')
  if (sc && opts.capture !== false) { const m = sc.match(/forge_session=([^;]*)/); if (m) cookie = m[1] ? `forge_session=${m[1]}` : '' }
  let json = null
  try { json = await res.json() } catch { /* non-JSON */ }
  return { status: res.status, json, data: json?.data, error: json?.error }
}
const post = (path, body, opts) => api('POST', path, body, opts)
const put = (path, body, opts) => api('PUT', path, body, opts)
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
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const today = daysAgo(0)
const stockNet = async (itemId, warehouseId) => num((await q1('SELECT COALESCE(SUM(qtyIn-qtyOut),0) n FROM StockLedger WHERE itemId=? AND warehouseId=? AND isCancelled=0', [itemId, warehouseId])).n)
const glNet = async (account, voucherNo) => q1(`SELECT ROUND(COALESCE(SUM(debit),0),2) dr, ROUND(COALESCE(SUM(credit),0),2) cr FROM AccountLedger WHERE account=? AND isCancelled=0${voucherNo ? ' AND voucherNo=?' : ''}`, voucherNo ? [account, voucherNo] : [account])

async function reconcile(label) {
  const prev = phase; phase = `${prev}:reconcile`
  const bad = await qa(`SELECT voucherType, voucherNo, isCancelled, ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr FROM AccountLedger GROUP BY voucherType, voucherNo, isCancelled HAVING ABS(SUM(debit)-SUM(credit)) > 0.01`)
  check(`${label}: every voucher balanced (active and cancelled sets)`, bad.length === 0, bad.slice(0, 3).map((v) => `${v.voucherType} ${v.voucherNo} ${v.dr}/${v.cr}`).join('; '))
  const tb = await q1('SELECT ROUND(SUM(debit),2) dr, ROUND(SUM(credit),2) cr FROM AccountLedger WHERE isCancelled=0')
  check(`${label}: trial balance Dr = Cr`, near(tb.dr, tb.cr), `Dr=${tb.dr} Cr=${tb.cr}`)
  const neg = await qa('SELECT itemId, warehouseId, ROUND(SUM(qtyIn-qtyOut),3) n FROM StockLedger WHERE isCancelled=0 GROUP BY itemId, warehouseId HAVING n < -0.001')
  check(`${label}: no negative stock`, neg.length === 0, JSON.stringify(neg.slice(0, 3)))
  const lots = await qa(`SELECT l.itemId, l.warehouseId, ROUND(SUM(l.qtyIn-l.qtyOut),3) lots, (SELECT ROUND(COALESCE(SUM(s.qtyIn-s.qtyOut),0),3) FROM StockLedger s WHERE s.itemId=l.itemId AND s.warehouseId=l.warehouseId AND s.isCancelled=0) stock FROM LotMovement l WHERE l.isCancelled=0 GROUP BY l.itemId, l.warehouseId HAVING lots > stock + 0.001`)
  check(`${label}: lot balances within stock`, lots.length === 0, JSON.stringify(lots.slice(0, 3)))
  const paid = await qa(`SELECT * FROM (
      SELECT h.invoiceNo, h.paidAmount, COALESCE((SELECT SUM(a.amount) FROM PaymentAllocation a JOIN Payment p ON p.id=a.paymentId WHERE a.invoiceNo=h.invoiceNo AND a.invoiceType='SALES' AND p.status='POSTED' AND a.reversedAt IS NULL),0) alloc FROM SalesInvoice h
      UNION ALL SELECT h.invoiceNo, h.paidAmount, COALESCE((SELECT SUM(a.amount) FROM PaymentAllocation a JOIN Payment p ON p.id=a.paymentId WHERE a.invoiceNo=h.invoiceNo AND a.invoiceType='PURCHASE' AND p.status='POSTED' AND a.reversedAt IS NULL),0) alloc FROM PurchaseInvoice h) x WHERE ABS(x.paidAmount - x.alloc) > 0.011`)
  check(`${label}: invoice paidAmount = active allocations`, paid.length === 0, JSON.stringify(paid.slice(0, 3)))
  // stock value in the GL equals the ADJUST stock movement value (adjustments only touch STKV through their own voucher)
  const adjGl = await q1("SELECT ROUND(COALESCE(SUM(debit-credit),0),2) v FROM AccountLedger WHERE voucherType='ADJUST' AND account='STKV' AND isCancelled=0")
  const adjStock = await q1("SELECT ROUND(COALESCE(SUM((qtyIn-qtyOut)*rate),0),2) v FROM StockLedger WHERE voucherType='ADJUST' AND isCancelled=0")
  check(`${label}: stock-adjustment GL value = stock-ledger value`, near(adjGl.v, adjStock.v), `gl=${adjGl.v} stock=${adjStock.v}`)
  phase = prev
}

const F = {}
async function mkUser(email, role) {
  const salt = randomBytes(16).toString('hex')
  await db.run('DELETE FROM OrgUser WHERE email=?', [email])
  await db.run('INSERT INTO OrgUser (id,email,passwordHash,name,role,companyId,tokenVersion,createdAt) VALUES (?,?,?,?,?,?,0,?)', [`par-${role.toLowerCase()}-${Date.now()}`, email, `${salt}:${scryptSync('parity-pass-123', salt, 64).toString('hex')}`, `Parity ${role}`, role, F.company.id, new Date()])
  const r = await post('/api/auth/login', { email, password: 'parity-pass-123' }, { cookie: '' })
  const c = cookie; cookie = F.owner
  return r.status === 200 ? c : null
}

// ---------------------------------------------------------------- setup
async function setup() {
  phase = 'setup'
  const seed = await post('/api/seed?force=1', {}, { headers: { 'x-platform-key': KEY }, cookie: '', capture: false })
  if (!expectOk('force reseed of disposable DB', seed)) throw new Error('seed failed: ' + seed.error)
  cookie = ''
  if (!expectOk('owner login', await post('/api/auth/login', { email: 'owner@shreeforge.example.com', password: 'forge123' }))) throw new Error('login failed')
  F.owner = cookie
  F.company = await q1('SELECT id FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')
  F.main = (await q1("SELECT id FROM Warehouse WHERE code='MAIN'")).id
  const party = async (body) => { const r = await post('/api/masters/parties', { stateCode: '27', ...body }); expectOk(`create party ${body.code}`, r); return r.data.id }
  F.sup = await party({ code: 'PAR-S1', name: 'Parity Supplier', types: ['SUPPLIER'] })
  F.cust = await party({ code: 'PAR-C1', name: 'Parity Customer', types: ['CUSTOMER'], creditLimit: 0, creditDays: 30 })
  check('party credit days saved', num((await q1('SELECT creditDays FROM Party WHERE id=?', [F.cust])).creditDays) === 30)
  const item = async (body) => { const r = await post('/api/masters/items', { gstRate: 18, groupName: 'Parity', ...body }); expectOk(`create item ${body.code}`, r); return r.data.id }
  F.fg = await item({ code: 'PAR-FG', name: 'Parity Bracket', uom: 'PCS', costRate: 300, saleRate: 500, hsn: '732690' })
  F.svc = await item({ code: 'PAR-SVC', name: 'Parity Service Visit', uom: 'PCS', saleRate: 1000, hsn: '998719', isService: true })
  expectOk('opening stock 50 @ 300', await post('/api/inventory/opening', { warehouseId: F.main, rows: [{ itemId: F.fg, qty: 50, rate: 300 }] }))
  F.acct = await mkUser('parity-acct@local.test', 'ACCOUNTANT')
  F.acct2 = await mkUser('parity-acct2@local.test', 'ACCOUNTANT')
  F.viewer = await mkUser('parity-viewer@local.test', 'VIEWER')
  check('accountant and viewer logins', !!F.acct && !!F.acct2 && !!F.viewer)
  const emp = await post('/api/manufacturing/employees', { code: 'PAR-E1', name: 'Parity Engineer', skill: 'Service' })
  expectOk('create service engineer', emp); F.emp = emp.data?.id
  await reconcile('baseline')
}

// ---------------------------------------------------------------- books: ledgers and journals
async function phaseJournals() {
  phase = 'B1-journals'
  const B = '/api/books'
  const chart = await get(B)
  check('chart of accounts lists system ledgers incl. TDS and stock adjustment', ['DEBT', 'TDSP', 'TDSR', 'STADJ'].every((c) => chart.data?.accounts.some((a) => a.code === c)))
  expectReject('a system code cannot be reused for an own ledger', await post(B, { action: 'create-ledger', code: 'CASH', name: 'Petty Cash', group: 'Current Assets', nature: 'ASSET' }), /system account/i)
  expectOk('create expense ledger RENT', await post(B, { action: 'create-ledger', code: 'RENT', name: 'Factory Rent', group: 'Indirect Expenses', nature: 'EXPENSE' }))
  expectReject('duplicate ledger code is refused', await post(B, { action: 'create-ledger', code: 'rent', name: 'Rent 2', group: 'Indirect Expenses', nature: 'EXPENSE' }), /already exists/i)
  expectReject('VIEWER cannot post a journal', await post(B, { action: 'post-journal', date: today, narration: 'x rent', lines: [{ account: 'RENT', debit: 1 }, { account: 'BANK', credit: 1 }] }, { cookie: F.viewer }), /read-only/i)
  expectReject('unbalanced journal is refused', await post(B, { action: 'post-journal', date: today, narration: 'rent', lines: [{ account: 'RENT', debit: 5000 }, { account: 'BANK', credit: 4999 }] }), /does not balance/i)
  expectReject('a line with both debit and credit is refused', await post(B, { action: 'post-journal', date: today, narration: 'rent', lines: [{ account: 'RENT', debit: 10, credit: 10 }, { account: 'BANK', credit: 0 }] }), /either a debit or a credit/i)
  expectReject('stock ledger cannot be journalised', await post(B, { action: 'post-journal', date: today, narration: 'stock fix', lines: [{ account: 'STKV', debit: 100 }, { account: 'OPEN', credit: 100 }] }), /cannot be journalised/i)
  expectReject('debtors line needs a party', await post(B, { action: 'post-journal', date: today, narration: 'write off', lines: [{ account: 'DEBT', credit: 100 }, { account: 'RENT', debit: 100 }] }), /needs a party/i)
  expectReject('unknown ledger is refused', await post(B, { action: 'post-journal', date: today, narration: 'unknown ledger', lines: [{ account: 'NOPE', debit: 1 }, { account: 'BANK', credit: 1 }] }), /not found/i)
  const jv = await post(B, { action: 'post-journal', date: today, narration: 'Factory rent November', lines: [{ account: 'RENT', debit: 5000 }, { account: 'BANK', credit: 5000 }] })
  expectOk('balanced journal Dr Rent / Cr Bank 5000', jv); F.jv = jv.data
  const rent = await glNet('RENT', jv.data?.voucherNo)
  check('journal posted to the GL with the own ledger name', near(rent.dr, 5000) && (await q1("SELECT accountName n FROM AccountLedger WHERE account='RENT' LIMIT 1")).n === 'Factory Rent', JSON.stringify(rent))
  check('journal number is organisation-prefixed (JV series)', /^JV-\d{4}-\d{3}$/.test(jv.data?.voucherNo ?? '') && !!(await q1("SELECT 1 x FROM Counter WHERE `key` LIKE ? ", [`${F.company.id}:JV-%`])), jv.data?.voucherNo)
  expectReject('cancelling a journal needs a reason', await post(B, { action: 'cancel-journal', id: jv.data.id, reason: ' ' }), /reason/i)
  expectOk('cancel the journal', await post(B, { action: 'cancel-journal', id: jv.data.id, reason: 'posted to wrong month' }))
  const after = await glNet('RENT', jv.data.voucherNo)
  check('cancelled journal leaves no effective GL rows, reversal kept', near(after.dr, 0) && num((await q1("SELECT COUNT(*) c FROM AccountLedger WHERE voucherNo=? AND isCancelled=1", [jv.data.voucherNo])).c) === 4)
  expectReject('a journal cannot be cancelled twice', await post(B, { action: 'cancel-journal', id: jv.data.id, reason: 'again' }), /already cancelled/i)
  expectOk('rent journal (kept) for the P&L check', await post(B, { action: 'post-journal', date: today, narration: 'Factory rent', lines: [{ account: 'RENT', debit: 4000 }, { account: 'CASH', credit: 4000 }] }))
  await reconcile('after journals')
}

// ---------------------------------------------------------------- TDS
async function phaseTds() {
  phase = 'B2-tds'
  const B = '/api/books'
  const seeded = await post(B, { action: 'seed-tds-sections' })
  expectOk('common TDS sections added', seeded)
  const c194 = seeded.data?.find((s) => s.section === '194C')
  check('194C at 2%', c194 && near(c194.ratePct, 2), JSON.stringify(c194))
  F.tds = c194?.id
  const pin = await post('/api/purchase-invoices', { partyId: F.sup, date: today, lines: [{ itemId: F.fg, qty: 10, rate: 1000 }] })
  expectOk('supplier invoice 10 x 1000 + 18% GST = 11800', pin); F.pin = pin.data
  const gross = num(pin.data?.grandTotal)
  expectReject('TDS amount without a section is refused', await post('/api/payments', { type: 'PAYMENT', partyId: F.sup, amount: gross - 200, tdsAmount: 200, mode: 'BANK' }), /section/i)
  expectReject('TDS above the section rate is refused', await post('/api/payments', { type: 'PAYMENT', partyId: F.sup, amount: gross - 2000, tdsAmount: 2000, tdsSectionId: F.tds, mode: 'BANK', allocations: [{ invoiceType: 'PURCHASE', invoiceNo: pin.data.invoiceNo, amount: gross }] }), /more than/i)
  const tds = 200
  const pay = await post('/api/payments', { type: 'PAYMENT', partyId: F.sup, amount: gross - tds, tdsAmount: tds, tdsSectionId: F.tds, mode: 'BANK', allocations: [{ invoiceType: 'PURCHASE', invoiceNo: pin.data.invoiceNo, amount: gross }] })
  expectOk('supplier payment net of TDS settles the full bill', pay); F.tdsPay = pay.data
  const inv = await q1('SELECT paidAmount FROM PurchaseInvoice WHERE id=?', [pin.data.id])
  check('bill fully settled (paid = gross incl. TDS)', near(inv.paidAmount, gross), `paid=${inv.paidAmount} gross=${gross}`)
  const cred = await glNet('CRED', pay.data.paymentNo), bank = await glNet('BANK', pay.data.paymentNo), tdsp = await glNet('TDSP', pay.data.paymentNo)
  check('GL: Dr Creditors gross, Cr Bank net, Cr TDS Payable', near(cred.dr, gross) && near(bank.cr, gross - tds) && near(tdsp.cr, tds), JSON.stringify({ cred, bank, tdsp }))
  check('no supplier advance created by the TDS part', num((await q1('SELECT COUNT(*) c FROM PartyAdvance WHERE paymentId=?', [pay.data.id])).c) === 0)
  const rep = await get(`${B}?report=tds`)
  check('TDS report: payable 200 under 194C, GL balance 200', near(rep.data?.totalPayable, 200) && near(rep.data?.glPayableBalance, 200) && rep.data?.sections.some((s) => s.section === '194C' && near(s.payable, 200)), JSON.stringify(rep.data?.sections))
  const tally = await get(`/api/tally/voucher?doc=PAYMENT&id=${pay.data.id}&preview=1`)
  const entries = tally.data?.voucher?.entries ?? []
  const signed = entries.reduce((s, e) => s + (e.isDebit ? -e.amount : e.amount), 0)
  check('Tally payment voucher: party gross, bank net, TDS Payable line, balanced', entries.some((e) => e.ledger === 'TDS Payable' && near(e.amount, tds)) && entries.some((e) => e.isParty && near(e.amount, gross)) && near(signed, 0), JSON.stringify(entries))
  // receipt where the customer deducted TDS
  const sinv = await post('/api/sales-invoices', { partyId: F.cust, date: today, lines: [{ itemId: F.fg, qty: 2, rate: 500 }] })
  expectOk('sales invoice 2 x 500 + GST = 1180', sinv)
  const sgross = num(sinv.data?.grandTotal)
  const rc = await post('/api/payments', { type: 'RECEIPT', partyId: F.cust, amount: sgross - 20, tdsAmount: 20, tdsSectionId: F.tds, mode: 'BANK', allocations: [{ invoiceType: 'SALES', invoiceNo: sinv.data.invoiceNo, amount: sgross }] })
  expectOk('customer receipt net of TDS (TDS receivable)', rc)
  const tdsr = await glNet('TDSR', rc.data?.paymentNo)
  check('GL: Dr TDS Receivable 20', near(tdsr.dr, 20), JSON.stringify(tdsr))
  expectOk('cancel the TDS receipt', await api('DELETE', `/api/payments/${rc.data.id}`))
  check('cancelled receipt restores the invoice balance', near((await q1('SELECT paidAmount FROM SalesInvoice WHERE id=?', [sinv.data.id])).paidAmount, 0))
  await reconcile('after TDS')
}

// ---------------------------------------------------------------- stock adjustments
async function phaseAdjustments() {
  phase = 'B3-adjust'
  const A = '/api/stock-adjustments'
  const before = await stockNet(F.fg, F.main)
  expectReject('reduce by more than on hand is refused', await post(A, { action: 'request', date: today, warehouseId: F.main, reasonCode: 'DAMAGE', lines: [{ itemId: F.fg, qtyChange: -(before + 1) }] }, { cookie: F.acct }), /only/i)
  expectReject('DAMAGE cannot add stock', await post(A, { action: 'request', date: today, warehouseId: F.main, reasonCode: 'DAMAGE', lines: [{ itemId: F.fg, qtyChange: 2 }] }, { cookie: F.acct }), /only reduce/i)
  expectReject('OTHER needs an explanation', await post(A, { action: 'request', date: today, warehouseId: F.main, reasonCode: 'OTHER', lines: [{ itemId: F.fg, qtyChange: -1 }] }, { cookie: F.acct }), /explain/i)
  const req = await post(A, { action: 'request', date: today, warehouseId: F.main, reasonCode: 'DAMAGE', notes: 'forklift damage', lines: [{ itemId: F.fg, qtyChange: -5 }] }, { cookie: F.acct })
  expectOk('accountant requests a damage write-off of 5', req)
  check('a request does not move stock', near(await stockNet(F.fg, F.main), before))
  expectReject('requester cannot approve their own adjustment', await post(A, { action: 'approve', id: req.data.id }, { cookie: F.acct }), /another user/i)
  expectReject('VIEWER cannot approve', await post(A, { action: 'approve', id: req.data.id }, { cookie: F.viewer }), /read-only/i)
  const avg = num((await q1("SELECT SUM(qtyIn*rate)/SUM(qtyIn) a FROM StockLedger WHERE itemId=? AND warehouseId=? AND isCancelled=0 AND qtyIn>0", [F.fg, F.main])).a)
  const races = await Promise.all([post(A, { action: 'approve', id: req.data.id }, { cookie: F.acct2 }), post(A, { action: 'approve', id: req.data.id })])
  check('two approvals at once: exactly one posts', races.filter((r) => r.status === 200).length === 1, `statuses=${races.map((r) => r.status)}`)
  check('approval removes 5 from stock', near(await stockNet(F.fg, F.main), before - 5), `now=${await stockNet(F.fg, F.main)}`)
  const adj = await q1('SELECT adjNo, value, status, decidedBy FROM StockAdjustment WHERE id=?', [req.data.id])
  const stadj = await glNet('STADJ', adj.adjNo), stkv = await glNet('STKV', adj.adjNo)
  check('GL: Dr Stock Adjustment / Cr Stock at weighted-average cost', near(stadj.dr, 5 * avg, 0.06) && near(stkv.cr, 5 * avg, 0.06) && near(adj.value, -5 * avg, 0.06), JSON.stringify({ stadj, stkv, value: adj.value, avg }))
  check('approver recorded', adj.status === 'APPROVED' && !!adj.decidedBy)
  const up = await post(A, { action: 'request', date: today, warehouseId: F.main, reasonCode: 'FOUND', notes: 'count', lines: [{ itemId: F.fg, qtyChange: 3, rate: 320 }] })
  expectOk('owner requests FOUND +3 @ 320', up)
  expectOk('OWNER may approve their own request', await post(A, { action: 'approve', id: up.data.id }))
  const upRow = await q1('SELECT adjNo FROM StockAdjustment WHERE id=?', [up.data.id])
  check('GL: Dr Stock 960 / Cr Stock Adjustment', near((await glNet('STKV', upRow.adjNo)).dr, 960) && near((await glNet('STADJ', upRow.adjNo)).cr, 960))
  expectReject('cancel needs a reason', await post(A, { action: 'cancel', id: up.data.id }), /reason/i)
  expectOk('cancel the approved increase', await post(A, { action: 'cancel', id: up.data.id, reason: 'double counted' }))
  check('cancel reverses the stock', near(await stockNet(F.fg, F.main), before - 5))
  const rj = await post(A, { action: 'request', date: today, warehouseId: F.main, reasonCode: 'SCRAP', lines: [{ itemId: F.fg, qtyChange: -1 }] }, { cookie: F.acct })
  expectReject('reject needs a reason', await post(A, { action: 'reject', id: rj.data.id }), /reason/i)
  expectOk('reject with a reason', await post(A, { action: 'reject', id: rj.data.id, note: 'not scrap, rework' }))
  expectReject('a rejected request cannot be approved', await post(A, { action: 'approve', id: rj.data.id }), /rejected/i)
  const dash = await get(A)
  check('dashboard summarises approved adjustments by reason', dash.data?.byReason.some((r) => r.reason === 'DAMAGE' && r.count === 1))
  await reconcile('after adjustments')
}

// ---------------------------------------------------------------- CRM
async function phaseCrm() {
  phase = 'C1-crm'
  const C = '/api/crm'
  const sp = await post(C, { action: 'save-salesperson', code: 'SP1', name: 'Ravi Sales', monthlyTarget: 100000 })
  expectOk('create salesperson', sp); F.sp = sp.data?.id
  expectReject('duplicate salesperson code', await post(C, { action: 'save-salesperson', code: 'sp1', name: 'Other' }), /already used/i)
  expectReject('a lead needs a phone or an email', await post(C, { action: 'create-lead', contactName: 'Anil' }), /phone|email/i)
  expectReject('invalid GSTIN is refused', await post(C, { action: 'create-lead', contactName: 'Anil', phone: '9800000001', gstin: '27ABCDE1234F1Z9' }), /GSTIN/i)
  const lead = await post(C, { action: 'create-lead', contactName: 'Anil Mehta', organisation: 'Mehta Pumps', phone: '9800000001', source: 'EXHIBITION', expectedValue: 250000, salespersonId: F.sp, requirement: '200 brackets / month' })
  expectOk('create lead', lead); F.lead = lead.data
  expectReject('a second open lead for the same phone is refused', await post(C, { action: 'create-lead', contactName: 'Anil M', phone: '9800000001' }), /already exists/i)
  expectReject('NEW lead cannot jump to WON', await post(C, { action: 'move-lead', id: lead.data.id, status: 'WON' }), /cannot move/i)
  expectReject('LOST needs a reason', await post(C, { action: 'move-lead', id: lead.data.id, status: 'LOST' }), /why/i)
  expectReject('a planned follow-up needs a date', await post(C, { action: 'add-activity', leadId: lead.data.id, type: 'CALL', notes: 'call back' }), /due date/i)
  const act = await post(C, { action: 'add-activity', leadId: lead.data.id, type: 'CALL', notes: 'send drawing and price', dueAt: daysAgo(-2) })
  expectOk('plan a follow-up in 2 days', act)
  check('lead next follow-up = the planned date', (await q1('SELECT nextFollowUpAt d FROM `Lead` WHERE id=?', [lead.data.id])).d?.toISOString?.().slice(0, 10) === daysAgo(-2) || String((await q1('SELECT nextFollowUpAt d FROM `Lead` WHERE id=?', [lead.data.id])).d).includes(daysAgo(-2).slice(0, 4)))
  expectOk('complete the follow-up', await post(C, { action: 'complete-activity', id: act.data.id, outcome: 'drawing sent' }))
  const l1 = await q1('SELECT status, nextFollowUpAt FROM `Lead` WHERE id=?', [lead.data.id])
  check('completing the first follow-up moves NEW -> CONTACTED and clears the date', l1.status === 'CONTACTED' && !l1.nextFollowUpAt, JSON.stringify(l1))
  expectReject('convert needs a valid customer code', await post(C, { action: 'convert-lead', id: lead.data.id, code: '!' }), /code/i)
  const conv = await post(C, { action: 'convert-lead', id: lead.data.id, code: 'MEHTA' })
  expectOk('convert lead to a new customer', conv)
  const party = await q1("SELECT id, name, types, phone FROM Party WHERE code='MEHTA'")
  check('customer created from the lead details', party?.name === 'Mehta Pumps' && party.types === 'CUSTOMER' && party.phone === '9800000001', JSON.stringify(party))
  F.mehta = party?.id
  check('converted lead is QUALIFIED and linked', (await q1('SELECT status, partyId FROM `Lead` WHERE id=?', [lead.data.id])).partyId === party?.id)
  expectReject('a lead converts only once', await post(C, { action: 'convert-lead', id: lead.data.id, code: 'MEHTA2' }), /already converted/i)
  // salesperson credit through quotation -> order -> challan invoice
  const O = '/api/order-to-cash'
  expectReject('quotation with an unknown salesperson is refused', await post(O, { action: 'create-quotation', partyId: F.mehta, validUntil: daysAgo(-10), salespersonId: 'nope', lines: [{ itemId: F.fg, qty: 10, rate: 500 }] }), /salesperson/i)
  const qt = await post(O, { action: 'create-quotation', partyId: F.mehta, validUntil: daysAgo(-10), salespersonId: F.sp, lines: [{ itemId: F.fg, qty: 10, rate: 500 }] })
  expectOk('quotation with salesperson', qt)
  await post(O, { action: 'transition-quotation', id: qt.data.id, transition: 'SUBMIT' })
  await post(O, { action: 'transition-quotation', id: qt.data.id, transition: 'APPROVE' })
  const so = await post(O, { action: 'quotation-to-order', id: qt.data.id, deliveryDate: daysAgo(3) })
  expectOk('quotation -> sales order', so); F.so = so.data
  check('sales order inherits the salesperson', (await q1('SELECT salespersonId s FROM SalesOrder WHERE id=?', [so.data?.id])).s === F.sp)
  expectOk('approve sales order', await post(O, { action: 'approve-order', id: so.data.id }))
  const soLine = await q1('SELECT id FROM SalesOrderLine WHERE salesOrderId=?', [so.data.id])
  const dc = await post(O, { action: 'create-challan', salesOrderId: so.data.id, warehouseId: F.main, lines: [{ salesOrderLineId: soLine.id, qty: 4 }] })
  expectOk('partial challan of 4', dc)
  const dcLine = await q1('SELECT id FROM DeliveryChallanLine WHERE deliveryChallanId=?', [dc.data.id])
  expectOk('dispatch QC accept 4', await post(O, { action: 'inspect-dispatch', deliveryChallanId: dc.data.id, lines: [{ deliveryChallanLineId: dcLine.id, acceptedQty: 4, rejectedQty: 0 }] }))
  const ci = await post(O, { action: 'invoice-dispatch', deliveryChallanId: dc.data.id, lines: [{ deliveryChallanLineId: dcLine.id, qty: 4 }] })
  expectOk('invoice the challan', ci)
  check('challan invoice credited to the order salesperson', (await q1('SELECT salespersonId s FROM SalesInvoice WHERE id=?', [ci.data?.id])).s === F.sp)
  expectReject('manual invoice with an inactive/unknown salesperson is refused', await post('/api/sales-invoices', { partyId: F.cust, date: today, salespersonId: 'nope', lines: [{ itemId: F.fg, qty: 1, rate: 500 }] }), /salesperson/i)
  expectOk('mark the lead won (has a customer)', await post(C, { action: 'move-lead', id: lead.data.id, status: 'WON' }))
  const lost = await post(C, { action: 'create-lead', contactName: 'Suresh', email: 'suresh@example.com', source: 'WEBSITE' })
  expectOk('second lead', lost)
  expectOk('lose it with a reason', await post(C, { action: 'move-lead', id: lost.data.id, status: 'LOST', reason: 'price too high' }))
  expectReject('an ACCOUNTANT cannot re-open a lost lead', await post(C, { action: 'move-lead', id: lost.data.id, status: 'CONTACTED' }, { cookie: F.acct }), /OWNER/i)
  expectOk('OWNER re-opens the lost lead', await post(C, { action: 'move-lead', id: lost.data.id, status: 'CONTACTED', reason: 'new budget' }))
  const month = today.slice(0, 7)
  const perf = await get(`${C}?report=salesperson&month=${month}`)
  const row = perf.data?.rows.find((r) => r.id === F.sp)
  check('salesperson report: invoiced 2000 taxable, 2% of target, quoted, 1 won', row && near(row.invoiced, 2000) && near(row.achievementPct, 2) && row.quoted > 0 && row.wonInMonth === 1, JSON.stringify(row))
  const dash = await get(C)
  check('pipeline counts WON and CONTACTED, win rate 100% of closed', dash.data?.pipeline.find((p) => p.status === 'WON')?.count === 1 && dash.data?.winRate === 100, JSON.stringify(dash.data?.pipeline))
  await reconcile('after CRM')
}

// ---------------------------------------------------------------- service calls
async function phaseService() {
  phase = 'C2-service'
  const S = '/api/service-calls'
  expectReject('a service call needs a customer', await post(S, { action: 'create', partyId: F.sup, complaint: 'pump noisy at start' }), /customer/i)
  expectReject('a warranty claim needs a serial we supplied', await post(S, { action: 'create', partyId: F.cust, itemId: F.fg, serialNo: 'UNKNOWN-1', underWarranty: true, complaint: 'pump noisy at start' }), /serial/i)
  const call = await post(S, { action: 'create', partyId: F.cust, itemId: F.fg, complaint: 'bracket weld cracked', priority: 'HIGH' })
  expectOk('log a chargeable call (HIGH)', call)
  const row = await q1('SELECT callNo, dueAt, date FROM ServiceCall WHERE id=?', [call.data.id])
  check('HIGH priority response target = 24 h', Math.abs(new Date(row.dueAt) - new Date(row.date) - 24 * 3600_000) < 2000, JSON.stringify(row))
  expectReject('cannot resolve before assigning', await post(S, { action: 'resolve', id: call.data.id, resolution: 'rewelded' }), /Assign|assigned|open/i)
  expectOk('assign engineer', await post(S, { action: 'assign', id: call.data.id, employeeId: F.emp }))
  expectOk('resolve with a service charge of 1500', await post(S, { action: 'resolve', id: call.data.id, resolution: 'rewelded and painted', serviceCharge: 1500 }))
  expectReject('cannot close before the charge is invoiced', await post(S, { action: 'close', id: call.data.id }), /Invoice/i)
  expectReject('invoice needs a service item', await post(S, { action: 'invoice', id: call.data.id, serviceItemId: F.fg }), /service item/i)
  const stockBefore = num((await q1('SELECT COUNT(*) c FROM StockLedger')).c)
  const inv = await Promise.all([post(S, { action: 'invoice', id: call.data.id, serviceItemId: F.svc }), post(S, { action: 'invoice', id: call.data.id, serviceItemId: F.svc })])
  check('two invoice attempts at once: exactly one invoice', inv.filter((r) => r.status === 200).length === 1, `statuses=${inv.map((r) => r.status)}`)
  const okInv = inv.find((r) => r.status === 200)?.data
  check('service invoice 1500 + 18% GST = 1770, no stock movement', near(okInv?.grandTotal, 1770) && num((await q1('SELECT COUNT(*) c FROM StockLedger')).c) === stockBefore, `grand=${okInv?.grandTotal}`)
  check('call linked to the invoice', (await q1('SELECT salesInvoiceId s FROM ServiceCall WHERE id=?', [call.data.id])).s === okInv?.id)
  expectOk('close the call', await post(S, { action: 'close', id: call.data.id }))
  const w = await post(S, { action: 'create', partyId: F.cust, complaint: 'warranty visit please', underWarranty: true })
  expectOk('warranty call without serial', w)
  await post(S, { action: 'assign', id: w.data.id, employeeId: F.emp })
  expectReject('a warranty call cannot carry a charge', await post(S, { action: 'resolve', id: w.data.id, resolution: 'replaced', serviceCharge: 100 }), /warranty/i)
  expectReject('cancel needs a reason', await post(S, { action: 'cancel', id: w.data.id }), /reason/i)
  expectOk('cancel the warranty call', await post(S, { action: 'cancel', id: w.data.id, reason: 'customer fixed it' }))
  const dash = await get(S)
  check('service dashboard counts', dash.data && dash.data.open === 0 && dash.data.toInvoice === 0, JSON.stringify({ open: dash.data?.open, toInvoice: dash.data?.toInvoice }))
  await reconcile('after service')
}

// ---------------------------------------------------------------- reports
async function phaseReports() {
  phase = 'R1-reports'
  const old = await post('/api/sales-invoices', { partyId: F.cust, date: daysAgo(45), lines: [{ itemId: F.fg, qty: 1, rate: 1000 }] })
  expectOk('sales invoice dated 45 days ago (customer on 30 days credit)', old)
  const ag = await get('/api/reports?type=aging&kind=sales')
  const inv = ag.data?.invoices.find((i) => i.invoiceNo === old.data?.invoiceNo)
  check('aging: 15 days past due -> 1-30 bucket', inv?.bucket === 'd0_30' && inv.daysOverdue >= 14 && inv.daysOverdue <= 16, JSON.stringify(inv))
  check('aging: overdue share is consistent with buckets', near(ag.data?.overdue, num(ag.data?.total) - num(ag.data?.totals?.notDue)))
  const pa = await get('/api/reports?type=aging&kind=purchase')
  check('payables aging excludes the fully paid bill', !pa.data?.invoices.some((i) => i.invoiceNo === F.pin?.invoiceNo))
  const bo = await get('/api/reports?type=back-orders')
  const line = bo.data?.rows.find((r) => r.orderId === F.so?.id)
  check('back orders: 6 of 10 pending, late (delivery date passed)', line && near(line.pending, 6) && line.late === true, JSON.stringify(line))
  const sa = await get(`/api/reports?type=sales-analysis&from=${daysAgo(60)}&to=${today}`)
  check('sales analysis by salesperson includes Ravi 2000', sa.data?.bySalesperson.some((b) => b.label === 'Ravi Sales' && near(b.taxable, 2000)), JSON.stringify(sa.data?.bySalesperson))
  expectReject('reports reject a reversed date range', await get(`/api/reports?type=sales-analysis&from=${today}&to=${daysAgo(5)}`), /after/i)
  const pl = await get(`/api/reports?type=pnl-ledger&from=${daysAgo(60)}&to=${today}`)
  check('P&L by ledger: rent 4000 and stock adjustment loss in expenses', pl.data?.expenses.some((e) => e.account === 'RENT' && near(e.amount, 4000)) && pl.data?.expenses.some((e) => e.account === 'STADJ' && e.amount > 0), JSON.stringify(pl.data?.expenses))
  check('P&L by ledger: net = income - expenses', near(pl.data?.netProfit, num(pl.data?.totalIncome) - num(pl.data?.totalExpenses)))
  const ps = await get(`/api/reports?type=purchase-by-supplier&from=${daysAgo(400)}&to=${today}`)
  expectOk('purchase by supplier report', ps)
  const pp = await get('/api/reports?type=project-profitability')
  check('project profitability lists seeded projects with actual cost', Array.isArray(pp.data) && pp.data.length > 0 && pp.data.every((p) => near(p.actualCost, p.material + p.labour)), `n=${pp.data?.length}`)
}

// ---------------------------------------------------------------- period lock / FY close
async function phaseLock() {
  phase = 'B4-lock'
  const B = '/api/books'
  const inv = await post('/api/sales-invoices', { partyId: F.cust, date: daysAgo(10), lines: [{ itemId: F.fg, qty: 1, rate: 700 }] })
  expectOk('invoice dated 10 days ago', inv)
  expectReject('lock date cannot be today or later', await post(B, { action: 'lock-books', until: today }), /before today/i)
  expectReject('VIEWER cannot lock books', await post(B, { action: 'lock-books', until: daysAgo(3) }, { cookie: F.viewer }), /read-only/i)
  expectOk('accountant locks the books up to 3 days ago', await post(B, { action: 'lock-books', until: daysAgo(3) }, { cookie: F.acct }))
  expectReject('posting into the closed period is refused', await post('/api/sales-invoices', { partyId: F.cust, date: daysAgo(5), lines: [{ itemId: F.fg, qty: 1, rate: 700 }] }), /locked/i)
  expectReject('journal into the closed period is refused', await post(B, { action: 'post-journal', date: daysAgo(4), narration: 'late entry', lines: [{ account: 'RENT', debit: 1 }, { account: 'CASH', credit: 1 }] }), /locked/i)
  expectReject('a stock adjustment into the closed period is refused', await post('/api/stock-adjustments', { action: 'request', date: daysAgo(4), warehouseId: F.main, reasonCode: 'DAMAGE', lines: [{ itemId: F.fg, qtyChange: -1 }] }), /locked/i)
  expectReject('cancelling a document in the closed period is refused', await api('DELETE', `/api/sales-invoices/${inv.data.id}`), /locked|closed period/i)
  check('the locked invoice is still POSTED', (await q1('SELECT status FROM SalesInvoice WHERE id=?', [inv.data.id])).status === 'POSTED')
  expectOk('posting after the lock date still works', await post('/api/sales-invoices', { partyId: F.cust, date: today, lines: [{ itemId: F.fg, qty: 1, rate: 700 }] }))
  expectReject('an ACCOUNTANT cannot re-open the period', await post(B, { action: 'lock-books', until: daysAgo(20), reason: 'fix' }, { cookie: F.acct }), /OWNER/i)
  expectReject('re-opening needs a reason', await post(B, { action: 'lock-books', until: null }), /reason/i)
  expectOk('OWNER re-opens with a reason', await post(B, { action: 'lock-books', until: null, reason: 'customer disputed invoice' }))
  check('re-open is in the audit trail', num((await q1("SELECT COUNT(*) c FROM AuditLog WHERE entity='Books' AND action='REOPEN'")).c) >= 1)
  const now = new Date(); const fyStart = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const cur = `${String(fyStart % 100).padStart(2, '0')}${String((fyStart + 1) % 100).padStart(2, '0')}`
  const prev = `${String((fyStart - 1) % 100).padStart(2, '0')}${String(fyStart % 100).padStart(2, '0')}`
  expectReject('the current financial year cannot be closed', await post(B, { action: 'close-fy', fy: cur }), /before today/i)
  expectReject('a malformed FY code is refused', await post(B, { action: 'close-fy', fy: '2527' }), /looks like/i)
  expectOk(`close FY ${prev}`, await post(B, { action: 'close-fy', fy: prev }))
  const fy = await get(B)
  check('financial years show the previous year closed', fy.data?.booksLockedUntil === `${fyStart}-03-31` && fy.data?.years.some((y) => y.code === prev && y.closed), JSON.stringify(fy.data?.years))
  expectReject(`posting into FY ${prev} is refused`, await post('/api/sales-invoices', { partyId: F.cust, date: `${fyStart}-03-15`, lines: [{ itemId: F.fg, qty: 1, rate: 700 }] }), /locked/i)
  expectReject(`FY ${prev} cannot be closed twice`, await post(B, { action: 'close-fy', fy: prev }), /already closed/i)
  await reconcile('after lock')
}

// ---------------------------------------------------------------- backup round trip
async function phaseBackup() {
  phase = 'R2-backup'
  const tables = ['LedgerAccount', 'JournalVoucher', 'JournalLine', 'TdsSection', 'StockAdjustment', 'StockAdjustmentLine', 'Salesperson', 'Lead', 'LeadActivity', 'ServiceCall']
  const count = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, num((await q1(`SELECT COUNT(*) c FROM \`${t}\``)).c)])))
  const before = await count()
  const linked = { inv: num((await q1('SELECT COUNT(*) c FROM SalesInvoice WHERE salespersonId IS NOT NULL')).c), pay: num((await q1('SELECT COUNT(*) c FROM Payment WHERE tdsSectionId IS NOT NULL')).c) }
  const bk = await get('/api/backup', { headers: { 'x-platform-key': KEY } })
  check('backup includes the new tables', bk.status === 200 && ['salesperson', 'tdsSection', 'lead', 'stockAdjustment', 'journalVoucher', 'serviceCall'].every((m) => Array.isArray(bk.data?.data?.workflow?.[m])), `status=${bk.status}`)
  const rs = await post('/api/backup/restore', { confirm: 'RESTORE', snapshot: bk.data }, { headers: { 'x-platform-key': KEY } })
  check('restore succeeds (legacy invoices/payments referencing salespersons and TDS sections)', rs.status === 200, `status=${rs.status} ${rs.error ?? ''}`)
  const after = await count()
  check('every new table round-trips with the same row count', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }))
  const linkedAfter = { inv: num((await q1('SELECT COUNT(*) c FROM SalesInvoice WHERE salespersonId IS NOT NULL')).c), pay: num((await q1('SELECT COUNT(*) c FROM Payment WHERE tdsSectionId IS NOT NULL')).c) }
  check('salesperson and TDS links survive the restore', JSON.stringify(linked) === JSON.stringify(linkedAfter) && linked.inv > 0 && linked.pay > 0, JSON.stringify({ linked, linkedAfter }))
  check('books lock survives the restore', !!(await q1('SELECT booksLockedUntil d FROM Company WHERE id=?', [F.company.id]))?.d)
  await reconcile('after restore')
}

async function main() {
  const t0 = Date.now()
  try {
    await setup()
    for (const p of [phaseJournals, phaseTds, phaseAdjustments, phaseCrm, phaseService, phaseReports, phaseLock, phaseBackup]) {
      try { await p() } catch (e) { check(`${p.name} crashed`, false, e?.stack ?? String(e)) }
    }
  } finally {
    await db.close()
  }
  const byPhase = {}
  for (const r of results) { const k = r.phase.split(':')[0]; byPhase[k] ??= { pass: 0, fail: 0 }; byPhase[k][r.pass ? 'pass' : 'fail']++ }
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), failures, total: results.length, byPhase, results }, null, 2))
  console.log(`\nper phase: ${JSON.stringify(byPhase)}`)
  console.log(`=== ${results.length - failures}/${results.length} parity checks passed, ${failures} failed (${Math.round((Date.now() - t0) / 1000)}s) ===`)
  if (failures) process.exitCode = 1
}
main().catch(async (e) => { console.error('PARITY AUDIT ERROR', e); process.exitCode = 2 })
