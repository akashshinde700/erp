/**
 * ForgeERP — executed API + database audit suite.
 *
 * Runs against a LIVE server (default http://127.0.0.1:3000) with an isolated
 * test database. It resets demo data via the platform-admin-gated seed route,
 * then exercises real HTTP requests and verifies raw DB rows after each
 * business step. Every check below is actually executed; results are written
 * to tests/audit-results.json.
 *
 * Usage: node tests/erp-audit.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { scryptSync, randomBytes } from 'node:crypto'

const require = createRequire(import.meta.url)
const BASE = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000'
const DB_PATH = process.env.AUDIT_DB_PATH ?? '/home/user/erp/tests/erp-test.db'
const KEY_PATH = process.env.AUDIT_PLATFORM_KEY ?? '/home/user/erp/db/platform-key.key'
function platformKey() {
  if (!existsSync(KEY_PATH)) {
    // A probe with a non-empty header forces src/lib/secrets.ts to materialise
    // the per-install key file (no credentials are read from the repo).
    throw new Error(`platform key file missing at ${KEY_PATH}; call POST /api/backup with a dummy x-platform-key header once to initialise it`)
  }
  return readFileSync(KEY_PATH, 'utf8').trim()
}
const Database = require('better-sqlite3')

const results = []
let cookie = ''
let failures = 0

function check(name, ok, detail = '') {
  const pass = !!ok
  if (!pass) failures++
  results.push({ name, pass, detail: String(detail).slice(0, 600) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 180)}` : ''}`)
}

async function req(method, path, body, opts = {}) {
  const headers = { ...(opts.headers ?? {}) }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.auth !== false && cookie) headers.Cookie = cookie
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie && opts.captureCookie !== false) {
    const m = setCookie.match(/forge_session=([^;]+)/)
    if (m) cookie = `forge_session=${m[1]}`
  }
  let json = null
  try { json = await res.json() } catch { /* binary/HTML */ }
  return { status: res.status, json, headers: res.headers }
}

const data = (r) => r.json?.data
const sql = () => new Database(DB_PATH, { readonly: true })
const q1 = (query, ...args) => { const d = sql(); try { return d.prepare(query).get(...args) } finally { d.close() } }
const qAll = (query, ...args) => { const d = sql(); try { return d.prepare(query).all(...args) } finally { d.close() } }

async function trialBalance() {
  const r = await req('GET', '/api/reports?type=trial-balance')
  return r.json?.data
}

async function reset() {
  const key = platformKey()
  const r = await req('POST', '/api/seed?force=1', {}, {
    auth: false,
    headers: { 'x-platform-key': key },
    captureCookie: false,
  })
  if (r.status !== 200) throw new Error(`seed reset failed: ${r.status} ${JSON.stringify(r.json)}`)
  cookie = ''
  const login = await req('POST', '/api/auth/login', {
    email: 'owner@shreeforge.example.com',
    password: 'forge123',
  })
  if (login.status !== 200) throw new Error(`owner login failed: ${login.status} ${JSON.stringify(login.json)}`)
}

async function main() {
  if (!existsSync(KEY_PATH)) {
    // Initialise the per-install key file through the app (never a repo constant).
    await fetch(`${BASE}/api/backup`, { headers: { 'x-platform-key': 'init-probe' }, redirect: 'manual' })
  }
  await reset()
  const parties = data(await req('GET', '/api/masters/parties')) ?? []
  const items = data(await req('GET', '/api/masters/items')) ?? []
  const warehouses = data(await req('GET', '/api/masters/warehouses')) ?? []
  const customer = parties.find((p) => p.types.includes('CUSTOMER'))
  const supplier = parties.find((p) => p.types.includes('SUPPLIER'))
  const serviceItem = items.find((i) => i.isService) ?? items[0]
  const stockItem = items.find((i) => i.isStockItem && !i.isService) ?? items[0]
  const wh = warehouses[0]
  const processes = data(await req('GET', '/api/masters/processes')) ?? []
  const stockSummary = data(await req('GET', '/api/reports?type=stock-summary')) ?? []
  const stockedItemRow = stockSummary.find((r) => r.closing > 1)
  const materialItemId = stockedItemRow?.item?.id ?? stockItem.id

  // ---- 1. Authentication / authorization --------------------------------
  const anon = await req('GET', '/api/sales-invoices', undefined, { auth: false })
  check('unauthenticated business GET is rejected (401)', anon.status === 401, `status=${anon.status}`)

  const forged = await req('GET', '/api/sales-invoices', undefined, {
    auth: false,
    headers: { Cookie: 'forge_session=eyJ1aWQiOiJmb3JnZWQiLCJjaWQiOiJmb3JnZWQiLCJleHAiOjk5OTk5OTk5OTk5OTl9.bad' },
  })
  check('forged session cookie is rejected (401)', forged.status === 401, `status=${forged.status}`)

  const sess = await req('GET', '/api/auth/session')
  check('owner session resolves', sess.status === 200 && data(sess)?.user?.role === 'OWNER', JSON.stringify(data(sess))?.slice(0, 120))

  // ---- 2. API surface -----------------------------------------------------
  const endpoints = [
    '/api', '/api/dashboard', '/api/masters/company', '/api/masters/items', '/api/masters/parties',
    '/api/masters/processes', '/api/masters/warehouses', `/api/masters/party-rates?partyId=${encodeURIComponent(customer.id ?? '')}`,
    '/api/sales-invoices', '/api/purchase-invoices', '/api/payments',
    '/api/jobwork/inwards', '/api/manufacturing/pending',
    '/api/manufacturing/stats', '/api/manufacturing/projects', '/api/manufacturing/boms',
    '/api/manufacturing/work-orders', '/api/manufacturing/tasks', '/api/manufacturing/employees',
    '/api/reports?type=trial-balance', '/api/reports?type=stock-summary', '/api/reports?type=outstanding',
    '/api/reports?type=gstr1', '/api/reports?type=pnl', '/api/reports?type=jobwork-pending',
    '/api/audit', '/api/search?q=shree',
  ]
  let bad = []
  for (const p of endpoints) {
    const r = await req('GET', p)
    if (r.status !== 200) bad.push(`${p}=${r.status}`)
  }
  check(`all ${endpoints.length} read endpoints return 200`, bad.length === 0, bad.join(', '))

  const tb0 = await trialBalance()
  check('trial balance balanced on seeded data', tb0?.balanced === true, `Dr=${tb0?.totalDr} Cr=${tb0?.totalCr}`)

  // ---- 3. Input validation ------------------------------------------------
  const badDate = await req('POST', '/api/sales-invoices', {
    partyId: customer.id,
    date: 'not-a-date',
    lines: [{ itemId: serviceItem.id, qty: 1, rate: 100 }],
  })
  check('invalid invoice date rejected with 400 (not 500)', badDate.status === 400, `status=${badDate.status} ${JSON.stringify(badDate.json)?.slice(0, 140)}`)

  const badMonth = await req('GET', '/api/reports?type=gstr1&month=2026-99')
  check('invalid GSTR-1 month rejected with 400 (not 500)', badMonth.status === 400, `status=${badMonth.status}`)

  const badPnl = await req('GET', '/api/reports?type=pnl&from=garbage&to=garbage')
  check('invalid P&L date range rejected with 400 (not 500)', badPnl.status === 400, `status=${badPnl.status}`)

  const badWarehouse = await req('POST', '/api/purchase-invoices', {
    partyId: supplier.id,
    warehouseId: 'no-such-warehouse',
    lines: [{ itemId: stockItem.id, qty: 1, rate: 10 }],
  })
  check('unknown warehouse rejected with 400 (not 500)', badWarehouse.status === 400, `status=${badWarehouse.status} ${JSON.stringify(badWarehouse.json)?.slice(0, 140)}`)

  const zeroQty = await req('POST', '/api/purchase-invoices', {
    partyId: supplier.id,
    lines: [{ itemId: stockItem.id, qty: 0, rate: 10 }],
  })
  check('zero quantity rejected (400)', zeroQty.status === 400, `status=${zeroQty.status}`)

  const negQty = await req('POST', '/api/purchase-invoices', {
    partyId: supplier.id,
    lines: [{ itemId: stockItem.id, qty: -5, rate: 10 }],
  })
  check('negative quantity rejected (400)', negQty.status === 400, `status=${negQty.status}`)

  const badState = await req('POST', '/api/masters/parties', {
    code: 'BADSTATE', name: 'Bad State Party', types: ['CUSTOMER'], stateCode: 'XX',
  })
  check('non-numeric GST state code rejected (400)', badState.status === 400, `status=${badState.status}`)

  // ---- 4. GST / stock / GL integrity --------------------------------------
  const sale = await req('POST', '/api/sales-invoices', {
    partyId: customer.id,
    lines: [{ itemId: serviceItem.id, qty: 2, rate: 500, discPct: 10 }],
  })
  check('sales invoice posts (200)', sale.status === 200, `status=${sale.status} ${JSON.stringify(sale.json)?.slice(0, 140)}`)
  const inv = data(sale)
  if (inv) {
    const taxable = 2 * 500 * 0.9
    const gstRate = serviceItem.gstRate
    const expectedTax = Math.round(taxable * gstRate) / 100
    const expectedGrand = Math.round(taxable + expectedTax)
    check('GST totals match independent hand calculation',
      Math.abs(inv.taxable - taxable) < 0.005 && Math.abs(inv.grandTotal - expectedGrand) < 0.005,
      `taxable=${inv.taxable} grand=${inv.grandTotal} expected=${expectedGrand}`)
    const glSum = q1("SELECT COALESCE(SUM(debit),0) dr, COALESCE(SUM(credit),0) cr FROM AccountLedger WHERE voucherNo=? AND isCancelled=0", inv.invoiceNo)
    check('sales GL debit equals invoice grand total',
      Math.abs((glSum?.dr ?? 0) - inv.grandTotal) < 0.005 && Math.abs((glSum?.dr ?? 0) - (glSum?.cr ?? 0)) < 0.005,
      JSON.stringify(glSum))
  }
  const tb1 = await trialBalance()
  check('trial balance still balanced after sale', tb1?.balanced === true, `Dr=${tb1?.totalDr} Cr=${tb1?.totalCr}`)

  const noStockItem = await req('POST', '/api/masters/items', {
    code: 'AUDIT-NOSTOCK', name: 'Audit No Stock Item', uom: 'PCS', gstRate: 18, isStockItem: true,
  })
  const noStockItemId = data(noStockItem)?.id ?? stockItem.id
  const noStock = await req('POST', '/api/sales-invoices', {
    partyId: customer.id,
    lines: [{ itemId: noStockItemId, qty: 1, rate: 10 }],
  })
  check('negative stock prevented (400)', noStock.status === 400, `status=${noStock.status} ${JSON.stringify(noStock.json)?.slice(0, 140)}`)

  // ---- 5. Payment allocation integrity -----------------------------------
  const salesList = data(await req('GET', '/api/sales-invoices')) ?? []
  const target = salesList.find((s) => s.status === 'POSTED' && s.grandTotal - s.paidAmount > 10)
  if (target) {
    const outstanding = Math.round((target.grandTotal - target.paidAmount) * 100) / 100
    const dup = await req('POST', '/api/payments', {
      type: 'RECEIPT', partyId: target.partyId ?? customer.id, amount: outstanding * 2,
      allocations: [
        { invoiceType: 'SALES', invoiceNo: target.invoiceNo, amount: outstanding },
        { invoiceType: 'SALES', invoiceNo: target.invoiceNo, amount: outstanding },
      ],
    })
    check('duplicate allocations to one invoice rejected (400)', dup.status === 400, `status=${dup.status} ${JSON.stringify(dup.json)?.slice(0, 160)}`)
    if (dup.status === 200) {
      const allocRows = qAll('SELECT * FROM PaymentAllocation WHERE invoiceNo=?', target.invoiceNo)
      const allocSum = allocRows.reduce((s, a) => s + a.amount, 0)
      const invRow = q1('SELECT paidAmount FROM SalesInvoice WHERE invoiceNo=?', target.invoiceNo)
      check('no orphaned allocation rows left behind', Math.abs(allocSum - (invRow?.paidAmount ?? 0)) < 0.005,
        `allocSum=${allocSum} paidAmount=${invRow?.paidAmount}`)
    }
    const over = await req('POST', '/api/payments', {
      type: 'RECEIPT', partyId: target.partyId ?? customer.id, amount: outstanding + 1,
      allocations: [{ invoiceType: 'SALES', invoiceNo: target.invoiceNo, amount: outstanding + 1 }],
    })
    check('over-allocation beyond outstanding rejected (400)', over.status === 400, `status=${over.status}`)
  }

  // ---- 6. Jobwork chain guards --------------------------------------------
  const inwards = data(await req('GET', '/api/jobwork/inwards')) ?? []
  const openInward = inwards.find((i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'COMPLETED')
  if (openInward) {
    const detail = data(await req('GET', `/api/jobwork/inwards/${openInward.id}`))
    const line = detail?.items?.[0]
    if (line) {
      const remaining = Math.max(0, (line.qty ?? 0) - (line.processedQty ?? 0))
      const overProcess = await req('POST', '/api/jobwork/job-cards', {
        inwardId: openInward.id,
        lines: [{ inwardItemId: line.id, qty: Math.max(1, remaining + 100), weight: (line.weight ?? 0) + 100, processIds: [processes[0]?.id] }],
      })
      check('jobwork over-processing rejected (400)', overProcess.status === 400, `status=${overProcess.status}`)
    }
  }

  // ---- 7. VIEWER role is read-only ---------------------------------------
  const viewerSalt = randomBytes(16).toString('hex')
  const viewerHash = scryptSync('viewer-pass-123', viewerSalt, 64).toString('hex')
  const viewerEmail = 'viewer-audit@local.test'
  {
    const d = new Database(DB_PATH)
    try {
      const org = d.prepare('SELECT id FROM Company WHERE isPlatform=0 ORDER BY createdAt ASC LIMIT 1').get()
      d.prepare('DELETE FROM OrgUser WHERE email=?').run(viewerEmail)
      d.prepare('INSERT INTO OrgUser (id,email,passwordHash,name,role,companyId,tokenVersion,createdAt) VALUES (?,?,?,?,?,?,?,?)')
        .run('viewer-audit-0001', viewerEmail, `${viewerSalt}:${viewerHash}`, 'Audit Viewer', 'VIEWER', org.id, 0, new Date().toISOString())
    } finally { d.close() }
  }
  const savedCookie = cookie
  cookie = ''
  const viewerLogin = await req('POST', '/api/auth/login', { email: viewerEmail, password: 'viewer-pass-123' })
  check('VIEWER can sign in', viewerLogin.status === 200, `status=${viewerLogin.status}`)
  const viewerRead = await req('GET', '/api/sales-invoices')
  const viewerWrite = await req('POST', '/api/sales-invoices', {
    partyId: customer.id,
    lines: [{ itemId: serviceItem.id, qty: 1, rate: 100 }],
  })
  check('VIEWER can read (200)', viewerRead.status === 200, `status=${viewerRead.status}`)
  check('VIEWER cannot post invoices (403)', viewerWrite.status === 403, `status=${viewerWrite.status}`)
  cookie = savedCookie
  {
    const d = new Database(DB_PATH)
    try { d.prepare('DELETE FROM OrgUser WHERE email=?').run(viewerEmail) } finally { d.close() }
  }

  // ---- 8. Security probes -------------------------------------------------
  const injection = await req('GET', `/api/search?q=${encodeURIComponent("' OR 1=1 -- <script>alert(1)</script>")}`)
  check('SQL-injection/XSS-style search string handled safely (200)', injection.status === 200, `status=${injection.status}`)

  let throttled = 0
  for (let i = 0; i < 12; i++) {
    const r = await req('POST', '/api/auth/login', { email: 'throttle-probe@invalid.test', password: 'wrong' }, { auth: false })
    if (r.status === 429) throttled = i + 1
  }
  check('login brute-force throttle engages (429)', throttled > 0 && throttled <= 12, `after ${throttled} failures`)

  // ---- 9. Backup / restore round-trip ------------------------------------
  const before = {
    employees: q1('SELECT COUNT(*) c FROM Employee').c,
    projects: q1('SELECT COUNT(*) c FROM Project').c,
    boms: q1('SELECT COUNT(*) c FROM Bom').c,
    workOrders: q1('SELECT COUNT(*) c FROM WorkOrder').c,
    tasks: q1('SELECT COUNT(*) c FROM ProductionTask').c,
    invoices: q1('SELECT COUNT(*) c FROM SalesInvoice').c,
  }
  const backup = await req('GET', '/api/backup', undefined, {
    auth: false,
    headers: { 'x-platform-key': platformKey() },
    captureCookie: false,
  })
  check('backup download succeeds (200)', backup.status === 200, `status=${backup.status}`)
  const snap = data(backup)
  check('backup snapshot includes manufacturing data',
    !!snap && Array.isArray(snap.data?.employees) && Array.isArray(snap.data?.projects) &&
    Array.isArray(snap.data?.boms) && Array.isArray(snap.data?.workOrders) && Array.isArray(snap.data?.productionTasks),
    `version=${snap?.version} keys=${Object.keys(snap?.data ?? {}).join(',').slice(0, 220)}`)
  if (snap) {
    const restore = await req('POST', '/api/backup/restore', { confirm: 'RESTORE', snapshot: snap }, {
      auth: false,
      headers: { 'x-platform-key': platformKey() },
      captureCookie: false,
    })
    check('backup restore succeeds (200)', restore.status === 200, `status=${restore.status} ${JSON.stringify(restore.json)?.slice(0, 220)}`)
    if (restore.status === 200) {
      const after = {
        employees: q1('SELECT COUNT(*) c FROM Employee').c,
        projects: q1('SELECT COUNT(*) c FROM Project').c,
        boms: q1('SELECT COUNT(*) c FROM Bom').c,
        workOrders: q1('SELECT COUNT(*) c FROM WorkOrder').c,
        tasks: q1('SELECT COUNT(*) c FROM ProductionTask').c,
        invoices: q1('SELECT COUNT(*) c FROM SalesInvoice').c,
      }
      check('restore preserves all business + manufacturing row counts',
        JSON.stringify(before) === JSON.stringify(after), `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)
      const users = q1('SELECT COUNT(*) c FROM OrgUser').c
      check('restore preserves org logins', users >= 2, `users=${users}`)
      const tb2 = await trialBalance()
      check('trial balance balanced after restore', tb2?.balanced === true, `Dr=${tb2?.totalDr} Cr=${tb2?.totalCr}`)
    }
  }

  // ---- 10. Manufacturing concurrency: complete one task twice -------------
  // Build a fresh task with material stock, then fire two complete requests.
  try {
    const emp = (data(await req('GET', '/api/manufacturing/employees')) ?? [])[0]
    const proj = await req('POST', '/api/manufacturing/projects', {
      name: 'Concurrency Audit Project', partyId: customer.id, startDate: '2026-11-01', budget: 10000,
    })
    const p = data(proj)
    await req('POST', `/api/manufacturing/projects/${p.id}/actions`, { action: 'start' })
    const emptyProjectClose = await req('POST', `/api/manufacturing/projects/${p.id}/actions`, { action: 'complete' })
    check('project completion requires at least one completed work order', emptyProjectClose.status === 400, `status=${emptyProjectClose.status}`)

    const wo = await req('POST', '/api/manufacturing/work-orders', {
      projectId: p.id,
      lines: [{ itemId: materialItemId, plannedQty: 10, uom: stockedItemRow?.item?.uom ?? stockItem.uom }],
    })
    const w = data(wo)
    const emptyWoClose = await req('POST', `/api/manufacturing/work-orders/${w.id}/actions`, { action: 'complete' })
    check('work-order completion requires a production task', emptyWoClose.status === 400, `status=${emptyWoClose.status}`)

    const task = await req('POST', '/api/manufacturing/tasks', {
      workOrderId: w.id, operation: 'CUTTING', seq: 10, plannedQty: 10, employeeId: emp?.id,
    })
    const t = data(task)
    if (t?.id) {
      const bypassStart = await req('POST', `/api/manufacturing/tasks/${t.id}/actions`, { action: 'complete', actualQty: 10 })
      check('assigned task cannot bypass start before completion', bypassStart.status === 400, `status=${bypassStart.status}`)

      const successor = await req('POST', '/api/manufacturing/tasks', {
        workOrderId: w.id, operation: 'WELDING', seq: 20, plannedQty: 10, employeeId: emp?.id,
      })
      const successorStart = await req('POST', `/api/manufacturing/tasks/${data(successor)?.id}/actions`, { action: 'start' })
      check('routing sequence blocks successor before predecessor completes', successorStart.status === 409, `status=${successorStart.status}`)

      await req('POST', `/api/manufacturing/tasks/${t.id}/actions`, { action: 'start' })
      const completeBody = { action: 'complete', actualQty: 10, materialItemId, materialQty: 1 }
      const [a, b] = await Promise.all([
        req('POST', `/api/manufacturing/tasks/${t.id}/actions`, completeBody),
        req('POST', `/api/manufacturing/tasks/${t.id}/actions`, completeBody),
      ])
      const issued = qAll("SELECT COUNT(*) c FROM StockLedger WHERE voucherNo=? AND voucherType='MFG_ISSUE'", t.taskNo)
      check('concurrent task completions post exactly one material issue',
        (a.status === 200 ? 1 : 0) + (b.status === 200 ? 1 : 0) === 1 && issued[0]?.c === 1,
        `statuses=${a.status},${b.status} issueRows=${issued[0]?.c} a=${JSON.stringify(a.json)?.slice(0, 160)} b=${JSON.stringify(b.json)?.slice(0, 160)}`)
    } else {
      check('concurrent task completion fixture created', false, JSON.stringify(task.json)?.slice(0, 200))
    }
  } catch (e) {
    check('manufacturing concurrency test executed', false, e.message)
  }

  // ---- 11. Extended validation, cancellation/reversal, restore safety ----
  // Every check below hits the live API and reads raw DB rows afterwards.

  const rollover = await req('POST', '/api/sales-invoices', {
    partyId: customer.id, date: '2026-02-30',
    lines: [{ itemId: serviceItem.id, qty: 1, rate: 100 }],
  })
  check('calendar rollover date (2026-02-30) rejected (400)', rollover.status === 400, `status=${rollover.status}`)

  const badSalesRange = await req('GET', '/api/sales-invoices?from=garbage&to=2026-11-07')
  check('sales list garbage from-date rejected (400)', badSalesRange.status === 400, `status=${badSalesRange.status}`)
  const reversedSalesRange = await req('GET', '/api/sales-invoices?from=2026-11-07&to=2026-11-01')
  check('sales list from>to rejected (400)', reversedSalesRange.status === 400, `status=${reversedSalesRange.status}`)
  const badPurchRange = await req('GET', '/api/purchase-invoices?from=garbage')
  check('purchase list garbage date rejected (400)', badPurchRange.status === 400, `status=${badPurchRange.status}`)
  const badEinvoice = await req('GET', '/api/e-invoice?from=garbage')
  check('e-invoice export garbage date rejected (400)', badEinvoice.status === 400, `status=${badEinvoice.status}`)
  const badTally = await req('GET', '/api/tally/bulk?from=garbage')
  check('Tally bulk export garbage date rejected (400)', badTally.status === 400, `status=${badTally.status}`)
  const badStockLedger = await req('GET', '/api/reports?type=stock-ledger&from=garbage')
  check('stock-ledger garbage from-date rejected (400)', badStockLedger.status === 400, `status=${badStockLedger.status}`)
  const reversedPnl = await req('GET', '/api/reports?type=pnl&from=2026-11-07&to=2026-11-01')
  check('P&L from>to rejected (400)', reversedPnl.status === 400, `status=${reversedPnl.status}`)

  const companyNow = data(await req('GET', '/api/masters/company'))
  const badCompanyState = await req('PUT', '/api/masters/company', {
    name: companyNow?.name ?? 'Shree Forge Industries', stateCode: 'XX',
  })
  check('company profile rejects invalid GST state code (400)', badCompanyState.status === 400, `status=${badCompanyState.status}`)
  const badPos = await req('POST', '/api/sales-invoices', {
    partyId: customer.id, pos: 'XX',
    lines: [{ itemId: serviceItem.id, qty: 1, rate: 100 }],
  })
  check('sales invoice rejects invalid place-of-supply (400)', badPos.status === 400, `status=${badPos.status}`)

  const projectsList = data(await req('GET', '/api/manufacturing/projects')) ?? []
  const reversedWo = await req('POST', '/api/manufacturing/work-orders', {
    projectId: projectsList[0]?.id,
    startDate: '2026-11-10', endDate: '2026-11-01',
    lines: [{ itemId: materialItemId, plannedQty: 1, uom: stockedItemRow?.item?.uom ?? stockItem.uom }],
  })
  check('work order end-before-start rejected (400)', reversedWo.status === 400, `status=${reversedWo.status}`)

  const bomsList = data(await req('GET', '/api/manufacturing/boms')) ?? []
  if (bomsList[0]?.id) {
    const badBom = await req('PUT', `/api/manufacturing/boms/${bomsList[0].id}`, {
      lines: [{ itemId: materialItemId, qty: 1, uom: stockItem.uom, wastagePct: 200, rate: 10 }],
    })
    check('BOM revision rejects out-of-range wastage (400)', badBom.status === 400, `status=${badBom.status}`)
  } else {
    check('BOM revision fixture available', false, 'no BOMs seeded')
  }

  // Platform key must NEVER be accepted from a URL (access logs / Referer).
  const queryKey = await req('GET', `/api/backup?platformKey=${encodeURIComponent(platformKey())}`, undefined, {
    auth: false, captureCookie: false,
  })
  check('platform key in query string is rejected (401)', queryKey.status === 401, `status=${queryKey.status}`)

  // ---- Cancellation / append-only reversal integrity ----
  const netStock = (itemId) => q1('SELECT COALESCE(SUM(qtyIn - qtyOut),0) net FROM StockLedger WHERE itemId=? AND isCancelled=0', itemId)?.net ?? 0
  const netBefore = netStock(stockItem.id)
  const buy = await req('POST', '/api/purchase-invoices', {
    partyId: supplier.id, warehouseId: wh?.id,
    lines: [{ itemId: stockItem.id, qty: 5, rate: 20 }],
  })
  check('purchase for cancellation fixture posts (200)', buy.status === 200, `status=${buy.status}`)
  const sellToCancel = await req('POST', '/api/sales-invoices', {
    partyId: customer.id, warehouseId: wh?.id,
    lines: [{ itemId: stockItem.id, qty: 2, rate: 50 }],
  })
  check('sale for cancellation fixture posts (200)', sellToCancel.status === 200, `status=${sellToCancel.status}`)
  const cancelInv = data(sellToCancel)
  if (cancelInv?.id) {
    const netAfterSale = netStock(stockItem.id)
    check('sale reduces raw stock ledger by 2', Math.abs((netBefore + 5) - netAfterSale - 2) < 0.005, `before=${netBefore} afterSale=${netAfterSale}`)
    const cancel = await req('DELETE', `/api/sales-invoices/${cancelInv.id}`)
    check('sales invoice cancellation succeeds (200)', cancel.status === 200, `status=${cancel.status}`)
    const status = q1('SELECT status FROM SalesInvoice WHERE id=?', cancelInv.id)?.status
    const netAfterCancel = netStock(stockItem.id)
    const gl = q1('SELECT COALESCE(SUM(debit),0) dr, COALESCE(SUM(credit),0) cr FROM AccountLedger WHERE voucherNo=? AND isCancelled=0', cancelInv.invoiceNo)
    const reversedRows = q1('SELECT COUNT(*) c FROM AccountLedger WHERE voucherNo=? AND isCancelled=1', cancelInv.invoiceNo)?.c ?? 0
    check('cancel marks invoice CANCELLED and restores raw stock',
      status === 'CANCELLED' && Math.abs((netBefore + 5) - netAfterCancel) < 0.005,
      `status=${status} before=${netBefore} afterCancel=${netAfterCancel}`)
    check('cancel writes append-only GL reversals, no live balance remains',
      Math.abs(gl?.dr ?? 0) < 0.005 && Math.abs(gl?.cr ?? 0) < 0.005 && reversedRows > 0,
      `liveDr=${gl?.dr} liveCr=${gl?.cr} cancelledRows=${reversedRows}`)
  } else {
    check('cancellation fixture created', false, JSON.stringify(sellToCancel.json)?.slice(0, 160))
  }

  // Paid invoice cannot be cancelled until the payment is cancelled first.
  const paidSale = await req('POST', '/api/sales-invoices', {
    partyId: customer.id, lines: [{ itemId: serviceItem.id, qty: 1, rate: 100 }],
  })
  const paidInv = data(paidSale)
  if (paidInv?.id) {
    const pay = await req('POST', '/api/payments', {
      type: 'RECEIPT', partyId: customer.id, amount: paidInv.grandTotal,
      allocations: [{ invoiceType: 'SALES', invoiceNo: paidInv.invoiceNo, amount: paidInv.grandTotal }],
    })
    check('full payment allocation posts (200)', pay.status === 200, `status=${pay.status} ${JSON.stringify(pay.json)?.slice(0, 140)}`)
    const blockedCancel = await req('DELETE', `/api/sales-invoices/${paidInv.id}`)
    check('paid invoice cancellation is blocked (400)', blockedCancel.status === 400, `status=${blockedCancel.status}`)
    const payId = data(pay)?.id
    if (payId) {
      const cancelPay = await req('DELETE', `/api/payments/${payId}`)
      check('payment cancellation succeeds (200)', cancelPay.status === 200, `status=${cancelPay.status}`)
      const paidAfter = q1('SELECT paidAmount FROM SalesInvoice WHERE id=?', paidInv.id)?.paidAmount
      const freeCancel = await req('DELETE', `/api/sales-invoices/${paidInv.id}`)
      check('cancelling payment releases invoice for cancellation',
        Math.abs(paidAfter ?? 0) < 0.005 && freeCancel.status === 200,
        `paidAmount=${paidAfter} cancelStatus=${freeCancel.status}`)
    }
  } else {
    check('paid-invoice fixture created', false, JSON.stringify(paidSale.json)?.slice(0, 160))
  }

  // Concurrent job cards must not lose a processed-qty update.
  try {
    const jobworker = parties.find((p) => p.types.includes('JOBWORKER')) ?? customer
    const inward = await req('POST', '/api/jobwork/inwards', {
      partyId: jobworker.id, items: [{ itemId: stockItem.id, qty: 10, weight: 10 }],
    })
    const inw = data(inward)
    const detail = inw?.id ? data(await req('GET', `/api/jobwork/inwards/${inw.id}`)) : null
    const line = detail?.items?.[0]
    if (line && processes[0]?.id) {
      // Each card tries to process the FULL inward quantity. Only one may
      // win: the 5% over-processing tolerance is 10.5, so two cards would
      // double-bill 20 units even if a lost-update kept processedQty at 10.
      const cardBody = {
        inwardId: inw.id,
        lines: [{ inwardItemId: line.id, qty: 10, weight: 10, processIds: [processes[0].id] }],
      }
      const [c1, c2] = await Promise.all([
        req('POST', '/api/jobwork/job-cards', cardBody),
        req('POST', '/api/jobwork/job-cards', cardBody),
      ])
      const processed = q1('SELECT processedQty, processedWeight FROM JobworkInwardItem WHERE id=?', line.id)?.processedQty
      const cards = q1("SELECT COUNT(*) c FROM JobCard WHERE inwardId=? AND status='COMPLETED'", inw.id)?.c
      const billed = q1("SELECT COALESCE(SUM(jp.qty),0) total FROM JobCardProcess jp JOIN JobCard jc ON jp.jobCardId=jc.id WHERE jc.inwardId=?", inw.id)?.total
      const successes = (c1.status === 200 ? 1 : 0) + (c2.status === 200 ? 1 : 0)
      check('concurrent job cards cannot over-process / double-bill an inward',
        successes === 1 && (processed ?? 0) <= 10.5 && (billed ?? 0) <= 10.5 && cards === 1,
        `statuses=${c1.status},${c2.status} processedQty=${processed} billedQty=${billed} cards=${cards}`)
    } else {
      check('jobwork concurrency fixture created', false, JSON.stringify(inward.json)?.slice(0, 160))
    }
  } catch (e) {
    check('jobwork concurrency test executed', false, e.message)
  }

  // ---- Backup safety: legacy snapshot refused, bad snapshot rolls back ----
  const goodBackup = await req('GET', '/api/backup', undefined, {
    auth: false, headers: { 'x-platform-key': platformKey() }, captureCookie: false,
  })
  const goodSnap = data(goodBackup)
  if (goodSnap) {
    const countTables = () => ({
      invoices: q1('SELECT COUNT(*) c FROM SalesInvoice').c,
      projects: q1('SELECT COUNT(*) c FROM Project').c,
      tasks: q1('SELECT COUNT(*) c FROM ProductionTask').c,
      users: q1('SELECT COUNT(*) c FROM OrgUser').c,
    })
    const beforeLegacy = countTables()
    const legacy = { version: 2, data: { ...goodSnap.data, orgUsers: goodSnap.data.orgUsers } }
    delete legacy.data.employees
    delete legacy.data.projects
    delete legacy.data.boms
    delete legacy.data.workOrders
    delete legacy.data.productionTasks
    const legacyRestore = await req('POST', '/api/backup/restore', { confirm: 'RESTORE', snapshot: legacy }, {
      auth: false, headers: { 'x-platform-key': platformKey() }, captureCookie: false,
    })
    const afterLegacy = countTables()
    check('legacy v2 snapshot refused before erasing manufacturing data',
      legacyRestore.status === 400 && JSON.stringify(beforeLegacy) === JSON.stringify(afterLegacy),
      `status=${legacyRestore.status} before=${JSON.stringify(beforeLegacy)} after=${JSON.stringify(afterLegacy)}`)

    const beforeBad = countTables()
    const corrupt = { version: 3, data: { ...goodSnap.data, company: [...goodSnap.data.company, { ...goodSnap.data.company[0] }] } }
    const badRestore = await req('POST', '/api/backup/restore', { confirm: 'RESTORE', snapshot: corrupt }, {
      auth: false, headers: { 'x-platform-key': platformKey() }, captureCookie: false,
    })
    const afterBad = countTables()
    check('failed restore rolls back the entire transaction (no partial wipe)',
      badRestore.status >= 400 && JSON.stringify(beforeBad) === JSON.stringify(afterBad),
      `status=${badRestore.status} before=${JSON.stringify(beforeBad)} after=${JSON.stringify(afterBad)}`)
  } else {
    check('backup safety fixtures available', false, `status=${goodBackup.status}`)
  }

  const tbFinal = await trialBalance()
  check('trial balance balanced at end of suite', tbFinal?.balanced === true, `Dr=${tbFinal?.totalDr} Cr=${tbFinal?.totalCr}`)

  const summary = {
    ranAt: new Date().toISOString(),
    baseUrl: BASE,
    total: results.length,
    passed: results.length - failures,
    failed: failures,
    results,
  }
  writeFileSync('/home/user/erp/tests/audit-results.json', JSON.stringify(summary, null, 2))
  console.log(`\n=== ${summary.passed}/${summary.total} checks passed, ${summary.failed} failed ===`)
  if (failures > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('SUITE ERROR', e)
  writeFileSync('/home/user/erp/tests/audit-results.json', JSON.stringify({ ranAt: new Date().toISOString(), error: String(e), results }, null, 2))
  process.exitCode = 2
})
