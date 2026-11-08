/**
 * ForgeERP — representative-volume performance probe (disposable DB only).
 *
 * Bulk-inserts synthetic rows straight into the database (balanced GL pairs,
 * positive stock, real FK targets taken from the seeded data), then times the
 * heavy read endpoints. The generated data is never committed and the target
 * database must look disposable; re-seed afterwards.
 *
 *   AUDIT_BASE_URL=http://127.0.0.1:3012 AUDIT_DB_URL=mysql://.../forgeerp_audit node tests/perf-load.mjs
 */
import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { openAuditDb } from './audit-db.mjs'

const BASE = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000'
const DB_URL = process.env.AUDIT_DB_URL
if (!DB_URL || !/audit|test|perf|tmp/i.test(new URL(DB_URL).pathname)) throw new Error('disposable AUDIT_DB_URL required')
const db = openAuditDb({ url: DB_URL })
const id = () => 'perf' + randomBytes(10).toString('hex')
const N = { stock: 10_000, invoices: 2_000, lots: 1_000, serials: 5_000, tasks: 1_000 }

async function bulk(table, cols, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    await db.run(`INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ${chunk.map(() => `(${cols.map(() => '?').join(',')})`).join(',')}`, chunk.flat())
  }
}

async function load() {
  const company = await db.get('SELECT id FROM Company WHERE isPlatform=0 ORDER BY createdAt LIMIT 1')
  const wh = await db.get("SELECT id FROM Warehouse WHERE code='MAIN'")
  const items = (await db.all('SELECT id, uom FROM Item WHERE isStockItem=1 AND isService=0 LIMIT 5'))
  const party = await db.get("SELECT id FROM Party WHERE types LIKE '%CUSTOMER%' LIMIT 1")
  const wo = await db.get('SELECT id FROM WorkOrder LIMIT 1')
  const now = Date.now()
  const day = (i) => new Date(now - (i % 360) * 86_400_000)
  // stock: inflows first so balances stay positive
  await bulk('StockLedger', ['id', 'postingDate', 'voucherType', 'voucherNo', 'itemId', 'warehouseId', 'qtyIn', 'qtyOut', 'rate'],
    Array.from({ length: N.stock }, (_, i) => [id(), day(i), 'PERF', `PERF-STK-${i}`, items[i % items.length].id, wh.id, i % 4 === 3 ? 0 : 10, i % 4 === 3 ? 5 : 0, 50]))
  // invoices + one line each + balanced GL pair
  const inv = Array.from({ length: N.invoices }, (_, i) => ({ id: id(), no: `PERF-INV-${String(i).padStart(5, '0')}`, d: day(i) }))
  await bulk('SalesInvoice', ['id', 'invoiceNo', 'date', 'partyId', 'taxable', 'cgst', 'sgst', 'igst', 'grandTotal', 'status'], inv.map((x) => [x.id, x.no, x.d, party.id, 1000, 90, 90, 0, 1180, 'POSTED']))
  await bulk('SalesInvoiceItem', ['id', 'invoiceId', 'itemId', 'uom', 'qty', 'rate', 'taxable', 'gstRate', 'cgst', 'sgst', 'igst', 'total'], inv.map((x, i) => [id(), x.id, items[i % items.length].id, items[i % items.length].uom, 2, 500, 1000, 18, 90, 90, 0, 1180]))
  await bulk('AccountLedger', ['id', 'date', 'account', 'accountName', 'partyId', 'debit', 'credit', 'voucherType', 'voucherNo'],
    inv.flatMap((x) => [[id(), x.d, 'DEBT', 'Sundry Debtors', party.id, 1180, 0, 'PERF', x.no], [id(), x.d, 'SALS', 'Sales', null, 0, 1180, 'PERF', x.no]]))
  // lots with a receipt movement each; serials spread across the lots
  const lots = Array.from({ length: N.lots }, (_, i) => ({ id: id(), item: items[i % items.length].id, no: `PERF-LOT-${i}` }))
  await bulk('InventoryLot', ['id', 'companyId', 'itemId', 'warehouseId', 'lotNo', 'sourceType', 'sourceId', 'expiryDate'], lots.map((l, i) => [l.id, company.id, l.item, wh.id, l.no, 'PERF', 'perf', new Date(now + (i % 500) * 86_400_000)]))
  await bulk('LotMovement', ['id', 'companyId', 'lotId', 'itemId', 'warehouseId', 'postingDate', 'movementType', 'qtyIn', 'voucherType', 'voucherNo'], lots.map((l, i) => [id(), company.id, l.id, l.item, wh.id, day(i), 'RECEIPT', 5, 'PERF', `PERF-LOT-${i}`]))
  await bulk('SerialNumber', ['id', 'companyId', 'itemId', 'warehouseId', 'lotId', 'serialNo', 'sourceType', 'sourceId'], Array.from({ length: N.serials }, (_, i) => { const l = lots[i % lots.length]; return [id(), company.id, l.item, wh.id, l.id, `PERF-SN-${i}`, 'PERF', 'perf'] }))
  await bulk('ProductionTask', ['id', 'taskNo', 'workOrderId', 'operation', 'plannedQty', 'status'], Array.from({ length: N.tasks }, (_, i) => [id(), `PERF-T-${i}`, wo.id, 'CUTTING', 10, i % 3 === 0 ? 'PENDING' : 'COMPLETED']))
}

async function timed(path, cookie) {
  const runs = []
  let bytes = 0, status = 0
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    const res = await fetch(BASE + path, { headers: { Cookie: cookie } })
    const body = await res.arrayBuffer()
    runs.push(performance.now() - t); bytes = body.byteLength; status = res.status
  }
  runs.sort((a, b) => a - b)
  return { path, status, medianMs: Math.round(runs[1]), maxMs: Math.round(runs[2]), kb: Math.round(bytes / 1024) }
}

async function main() {
  const t0 = Date.now()
  await load()
  const loadSec = Math.round((Date.now() - t0) / 1000)
  const counts = {}
  for (const t of ['StockLedger', 'SalesInvoice', 'InventoryLot', 'SerialNumber', 'ProductionTask', 'AccountLedger', 'LotMovement']) counts[t] = Number((await db.get(`SELECT COUNT(*) c FROM \`${t}\``)).c)
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@shreeforge.example.com', password: 'forge123' }) })
  const cookie = (login.headers.get('set-cookie') ?? '').match(/forge_session=[^;]+/)?.[0] ?? ''
  const month = new Date().toISOString().slice(0, 7)
  const today = new Date().toISOString().slice(0, 10)
  const paths = ['/api/dashboard', '/api/sales-invoices', '/api/reports?type=trial-balance', '/api/reports?type=stock-summary', `/api/reports?type=gstr1&month=${month}`, `/api/reports?type=gstr3b&month=${month}`, `/api/reports?type=hsn-summary&month=${month}`, '/api/reports?type=outstanding', '/api/reports?type=action-center', `/api/reports?type=cash-bank-book&from=${month}-01&to=${today}`, '/api/reports?type=inventory-planning', '/api/traceability', '/api/procurement', '/api/order-to-cash', '/api/manufacturing/tasks', '/api/manufacturing/pending', '/api/audit', '/api/search?q=PERF-INV-0001']
  const timings = []
  for (const p of paths) { const r = await timed(p, cookie); timings.push(r); console.log(`${String(r.status).padEnd(4)} ${String(r.medianMs).padStart(6)} ms (max ${r.maxMs})  ${String(r.kb).padStart(7)} KB  ${p}`) }
  const indexes = await db.all("SELECT table_name t, index_name i, GROUP_CONCAT(column_name ORDER BY seq_in_index) c FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name IN ('StockLedger','AccountLedger','SalesInvoice','LotMovement','SerialNumber','ProductionTask') GROUP BY table_name, index_name")
  const out = { ranAt: new Date().toISOString(), loadSeconds: loadSec, counts, timings, indexes }
  writeFileSync(process.env.PERF_RESULTS ?? 'perf-results.json', JSON.stringify(out, null, 2))
  await db.close()
}
main().catch(async (e) => { console.error('PERF ERROR', e); await db.close(); process.exitCode = 2 })
