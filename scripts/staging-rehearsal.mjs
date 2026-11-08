#!/usr/bin/env node
/**
 * ForgeERP — staging migration rehearsal on a copy of live data.
 *
 * Loads a production dump (deploy.py writes one to ~/backups/predeploy/ before
 * every deploy) into a DISPOSABLE database, applies the pending Prisma
 * migrations exactly the way deploy.py does, and proves nothing was lost:
 *
 *   1. read-only pre-flight (operating companies, duplicate supplier invoices)
 *   2. row count of every table before the migration
 *   3. baseline (`migrate resolve --applied <init>`) when the dump predates
 *      migration history and matches schema.baseline.prisma
 *   4. `prisma migrate deploy`, then `migrate status` and a drift diff
 *   5. after: every pre-existing table keeps its rows, every business row
 *      belongs to an operating company, no counter is un-prefixed, the ledger
 *      still balances, every requested invariant holds
 *
 * Usage (on the server or any host with the mysql client + node_modules):
 *   STAGING_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/forgeerp_staging_rehearsal \
 *     node scripts/staging-rehearsal.mjs ~/backups/predeploy/<stamp>.sql.gz [--keep] [--use-empty]
 *
 * Safety: the target database name must contain staging/rehearsal/tmp/test/audit
 * and must not exist yet: the script creates it, and drops only a database it
 * created itself (never a pre-existing one, even on failure).
 * Credentials go to a 0600 defaults file, never argv or stdout.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGunzip } from 'node:zlib'
import { openAuditDb } from '../tests/audit-db.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const [dumpPath, ...flags] = process.argv.slice(2)
const KEEP = flags.includes('--keep')
// --use-empty: the database already exists and is EMPTY (e.g. created in
// CloudPanel, whose site DB users cannot CREATE DATABASE). The run then drops
// only the tables it loaded and leaves the empty database behind.
const USE_EMPTY = flags.includes('--use-empty')
const URL_ = process.env.STAGING_DATABASE_URL
if (!dumpPath || !URL_) { console.error('usage: STAGING_DATABASE_URL=mysql://… node scripts/staging-rehearsal.mjs <dump.sql[.gz]> [--keep]'); process.exit(2) }
if (!existsSync(dumpPath)) { console.error(`dump not found: ${dumpPath}`); process.exit(2) }
const u = new URL(URL_)
const DB = decodeURIComponent(u.pathname.replace(/^\//, ''))
if (!/^[A-Za-z0-9_]+$/.test(DB) || !/(staging|rehearsal|tmp|test|audit)/i.test(DB)) { console.error(`refusing: "${DB}" does not look like a disposable database name`); process.exit(2) }

const MYSQL = process.env.MYSQL_BIN ?? 'mysql'
const tmp = mkdtempSync(join(tmpdir(), 'rehearsal-'))
const cnf = join(tmp, 'client.cnf')
writeFileSync(cnf, `[client]\nuser=${decodeURIComponent(u.username)}\npassword=${decodeURIComponent(u.password)}\nhost=${u.hostname}\nport=${u.port || 3306}\n`, { mode: 0o600 })
const env = { ...process.env, DATABASE_URL: URL_ }
let failures = 0
const step = (s) => console.log(`\n== ${s}`)
function check(name, ok, detail = '') { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); return ok }
function sql(statement, db = '') {
  const r = spawnSync(MYSQL, [`--defaults-extra-file=${cnf}`, '-N', '-B', ...(db ? [db] : []), '-e', statement], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`mysql: ${r.stderr.trim().slice(-300)}`)
  return r.stdout.trim()
}
function prisma(args) {
  const r = spawnSync('npx', ['--no-install', 'prisma', ...args], { cwd: ROOT, env, encoding: 'utf8', shell: process.platform === 'win32' })
  return { code: r.status, out: `${r.stdout}${r.stderr}`.replace(/mysql:\/\/[^\s"']+/g, 'mysql://***') }
}

let db
let created = false // only a database this run created is ever dropped
let loadedIntoEmpty = false // --use-empty: only the tables this run loaded are dropped
try {
  step(`load ${dumpPath} into ${DB}`)
  const exists = sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${DB}'`) !== '0'
  if (exists && !USE_EMPTY) throw new Error(`${DB} already exists — give a database name that does not exist yet (or --use-empty for an empty pre-created one)`)
  if (exists) {
    const n = sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB}'`)
    if (n !== '0') throw new Error(`${DB} is not empty (${n} tables) — --use-empty needs an empty database`)
    loadedIntoEmpty = true
  } else {
    sql(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    created = true
  }
  await new Promise((resolve, reject) => {
    const child = spawn(MYSQL, [`--defaults-extra-file=${cnf}`, DB], { stdio: ['pipe', 'inherit', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`load failed: ${err.slice(-300)}`))))
    const src = createReadStream(dumpPath)
    ;(dumpPath.endsWith('.gz') ? src.pipe(createGunzip()) : src).pipe(child.stdin)
  })
  db = openAuditDb({ url: URL_ })
  const tables = (await db.all('SELECT table_name t FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type=\'BASE TABLE\'')).map((r) => r.t ?? r.TABLE_NAME)
  check('dump loaded', tables.length > 0, `${tables.length} tables`)

  step('pre-flight (read-only)')
  const ops = await db.all('SELECT id, name FROM Company WHERE isPlatform=0 ORDER BY createdAt')
  check('at least one operating (non-platform) company — owns the legacy rows after the tenant migration', ops.length >= 1, ops.map((c) => c.name).join(', '))
  if (ops.length > 1) console.log(`WARN  ${ops.length} operating companies: the tenant migration assigns every legacy row to the oldest ("${ops[0].name}"). Confirm that is correct before deploying.`)
  const dupInv = await db.all('SELECT partyId, supplierInvoiceNo, COUNT(*) n FROM PurchaseInvoice WHERE supplierInvoiceNo IS NOT NULL AND status <> \'CANCELLED\' GROUP BY partyId, supplierInvoiceNo HAVING n > 1')
  check('no duplicate active supplier invoice numbers', dupInv.length === 0, JSON.stringify(dupInv.slice(0, 3)))
  const before = {}
  for (const t of tables) before[t] = Number((await db.get(`SELECT COUNT(*) c FROM \`${t}\``)).c)
  const hasHistory = tables.includes('_prisma_migrations')
  const applied = hasHistory ? (await db.all('SELECT migration_name m FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')).map((r) => r.m) : []
  console.log(`      migration history: ${hasHistory ? applied.join(', ') || '(empty)' : 'none (db push era)'}`)

  if (!hasHistory) {
    step('baseline (dump predates migration history)')
    const d = prisma(['migrate', 'diff', '--from-url', URL_, '--to-schema-datamodel', 'prisma/migrations/20261106000000_init/schema.baseline.prisma', '--script'])
    const empty = d.code === 0 && !/CREATE|ALTER|DROP/i.test(d.out.replace(/-- This is an empty migration\.?/i, ''))
    if (!check('live schema equals the baseline datamodel', empty, empty ? '' : d.out.slice(0, 300))) throw new Error('schema was changed by hand — reconcile before deploying')
    check('baseline recorded', prisma(['migrate', 'resolve', '--applied', '20261106000000_init']).code === 0)
  }

  step('prisma migrate deploy')
  const t0 = Date.now()
  const dep = prisma(['migrate', 'deploy'])
  console.log(dep.out.split('\n').filter((l) => /Applying|applied|Error|error/i.test(l)).join('\n'))
  if (!check(`migrate deploy (${((Date.now() - t0) / 1000).toFixed(1)}s)`, dep.code === 0)) throw new Error('migration failed — the live deploy would have stopped here; restore not needed on staging')
  check('migrate status: up to date', /up to date/i.test(prisma(['migrate', 'status']).out))
  const drift = prisma(['migrate', 'diff', '--from-url', URL_, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'])
  check('no drift between the migrated database and prisma/schema.prisma', drift.code === 0, drift.code === 0 ? '' : drift.out.slice(0, 300))

  step('after-migration invariants')
  const lost = []
  for (const t of Object.keys(before)) {
    if (t === '_prisma_migrations') continue
    const n = Number((await db.get(`SELECT COUNT(*) c FROM \`${t}\``)).c)
    if (n !== before[t]) lost.push(`${t}: ${before[t]} -> ${n}`)
  }
  check('every pre-existing table keeps exactly its rows', lost.length === 0, lost.join('; '))
  const owned = await db.all("SELECT table_name t FROM information_schema.columns WHERE table_schema=DATABASE() AND column_name='companyId' AND table_name NOT IN ('OrgUser','AuditLog','_prisma_migrations')")
  const orphans = []
  for (const { t, TABLE_NAME } of owned) {
    const name = t ?? TABLE_NAME
    const n = Number((await db.get(`SELECT COUNT(*) c FROM \`${name}\` x LEFT JOIN Company c ON c.id = x.companyId WHERE c.id IS NULL OR c.isPlatform = 1`)).c)
    if (n) orphans.push(`${name}: ${n}`)
  }
  check('every business row belongs to an operating company', orphans.length === 0, orphans.join('; '))
  const counters = Number((await db.get("SELECT COUNT(*) c FROM Counter WHERE `key` NOT LIKE '%:%'")).c)
  check('every document counter is organisation-prefixed', counters === 0, `${counters} un-prefixed`)
  const gl = await db.get('SELECT ROUND(COALESCE(SUM(debit),0),2) dr, ROUND(COALESCE(SUM(credit),0),2) cr FROM AccountLedger')
  check('general ledger still balances (Dr = Cr)', Math.abs(Number(gl.dr) - Number(gl.cr)) < 0.011, `Dr=${gl.dr} Cr=${gl.cr}`)
  const neg = await db.all('SELECT itemId, warehouseId, ROUND(SUM(qtyIn - qtyOut), 4) q FROM StockLedger GROUP BY itemId, warehouseId HAVING q < -0.0001')
  check('no negative stock balance', neg.length === 0, JSON.stringify(neg.slice(0, 3)))
} catch (e) {
  check('rehearsal completed', false, e.message)
} finally {
  try { await db?.close() } catch { /* already closed */ }
  if (created && !KEEP) { try { sql(`DROP DATABASE IF EXISTS \`${DB}\``); console.log(`\n(dropped ${DB}; pass --keep to inspect it)`) } catch (e) { console.log(`could not drop ${DB}: ${e.message}`) } }
  if (loadedIntoEmpty && !KEEP) {
    try {
      const names = sql(`SELECT table_name FROM information_schema.tables WHERE table_schema='${DB}'`).split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
      if (names.length) sql(`SET FOREIGN_KEY_CHECKS=0; ${names.map((t) => `DROP TABLE \`${t}\``).join('; ')}; SET FOREIGN_KEY_CHECKS=1`, DB)
      const left = sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB}'`)
      check(`rehearsal tables removed from ${DB}`, left === '0', `${names.length} dropped, ${left} left (pass --keep to inspect instead)`)
    } catch (e) { check(`rehearsal tables removed from ${DB}`, false, e.message) }
  }
  rmSync(tmp, { recursive: true, force: true })
}
console.log(`\n=== staging rehearsal: ${failures === 0 ? 'PASSED' : `${failures} FAILED`} ===`)
process.exit(failures ? 1 : 0)
