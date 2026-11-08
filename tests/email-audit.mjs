/**
 * Email notifications audit — real SMTP round trip against a local Mailpit
 * catcher (never a real mail server, never a real customer address).
 *
 *   docker run -d --name erp-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit \
 *     --smtp-auth-accept-any --smtp-auth-allow-insecure
 *   # server env: SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_SECURE=false
 *   #             SMTP_USER=audit SMTP_PASS=<anything> SMTP_FROM="Forge Audit <erp@audit.test>"
 *   AUDIT_BASE_URL=http://127.0.0.1:3012 AUDIT_DB_URL=mysql://…/forgeerp_audit \
 *   MAILPIT_URL=http://127.0.0.1:8025 SMTP_PASS_EXPECTED=<same> node tests/email-audit.mjs
 *
 * DESTRUCTIVE for the disposable database: starts with a ?force=1 reseed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openAuditDb } from './audit-db.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.AUDIT_BASE_URL ?? 'http://127.0.0.1:3000'
const DB_URL = process.env.AUDIT_DB_URL
if (!DB_URL || !/^mysql:\/\//.test(DB_URL)) throw new Error('AUDIT_DB_URL=mysql://... (disposable database) is required')
const DB_NAME = new URL(DB_URL).pathname.slice(1)
if (!/audit|test|mig|disposable|tmp/i.test(DB_NAME) && process.env.AUDIT_CONFIRM_DISPOSABLE !== DB_NAME) throw new Error(`Refusing to run: '${DB_NAME}' does not look disposable`)
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025'
const SECRET = process.env.SMTP_PASS_EXPECTED ?? ''
const KEY = readFileSync(process.env.AUDIT_PLATFORM_KEY ?? join(ROOT, 'db', 'platform-key.key'), 'utf8').trim()
const db = openAuditDb({ url: DB_URL })

const results = []
let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; results.push({ name, pass: !!ok, detail: String(detail ?? '').slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 170)}` : ''}`) }
let cookie = ''
async function api(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const sc = res.headers.get('set-cookie'); const m = sc?.match(/forge_session=([^;]+)/); if (m) cookie = `forge_session=${m[1]}`
  const raw = await res.text(); let json = null; try { json = JSON.parse(raw) } catch {}
  return { status: res.status, data: json?.data, error: json?.error, raw }
}
const post = (p, b, h) => api('POST', p, b, h)
const get = (p) => api('GET', p)
const N = '/api/notifications'

async function mailbox() {
  const r = await fetch(`${MAILPIT}/api/v1/messages?limit=200`)
  return (await r.json()).messages ?? []
}
async function messageBody(id) { return (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json() }
async function waitFor(pred, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) { const msgs = await mailbox(); const hit = msgs.find(pred); if (hit) return hit; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const to = (m) => (m.To ?? []).map((t) => t.Address.toLowerCase())

async function main() {
  const seed = await post('/api/seed?force=1', {}, { 'x-platform-key': KEY })
  check('setup: force reseed of disposable DB', seed.status === 200, seed.error)
  cookie = ''
  const login = await post('/api/auth/login', { email: 'owner@shreeforge.example.com', password: 'forge123' })
  check('setup: owner login', login.status === 200, login.error)
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' })

  // ---- status: configured, and no secret anywhere in the response
  const st = await get(N)
  check('status: SMTP reported as configured with host/port/from', st.status === 200 && st.data?.smtp?.configured === true && st.data.smtp.port === 1025 && /audit\.test/.test(st.data.smtp.from ?? ''), JSON.stringify(st.data?.smtp))
  check('status: the SMTP password never appears in the API response', !!SECRET && !st.raw.includes(SECRET) && !/pass/i.test(Object.keys(st.data?.smtp ?? {}).join(',')), 'checked raw body')

  // ---- test email
  const bad = await post(N, { action: 'test', to: 'not-an-email' })
  check('test: an invalid address is refused (400)', bad.status === 400 && /valid email/i.test(bad.error ?? ''), `${bad.status} ${bad.error}`)
  const inj = await post(N, { action: 'test', to: 'a@b.test\r\nBcc: victim@evil.test' })
  check('test: header injection in the address is refused', inj.status === 400, `${inj.status}`)
  const t = await post(N, { action: 'test', to: 'owner@audit.test' })
  check('test: test email accepted', t.status === 200 && t.data?.sent === true, `${t.status} ${t.error ?? ''}`)
  const tm = await waitFor((m) => to(m).includes('owner@audit.test') && /test email/i.test(m.Subject))
  check('test: the message arrives at the SMTP server', !!tm, tm?.Subject)
  check('test: sent from SMTP_FROM', !!tm && /erp@audit\.test/i.test(tm.From?.Address ?? ''), tm?.From?.Address)

  // ---- invoice email
  const inv = await db.get("SELECT si.id, si.invoiceNo, si.grandTotal, si.partyId FROM SalesInvoice si WHERE si.status='POSTED' ORDER BY si.date LIMIT 1")
  await db.run('UPDATE Party SET email=NULL, name=? WHERE id=?', ['Acme <script>alert(1)</script> & Co', inv.partyId])
  const noAddr = await post(N, { action: 'invoice', id: inv.id })
  check('invoice: no address on file and none typed → clear 400', noAddr.status === 400 && /no email address/i.test(noAddr.error ?? ''), `${noAddr.status} ${noAddr.error}`)
  await db.run('UPDATE Party SET email=? WHERE id=?', ['accounts@customer.test', inv.partyId])
  const ie = await post(N, { action: 'invoice', id: inv.id })
  check('invoice: emailed to the customer address on file', ie.status === 200 && ie.data?.to === 'accounts@customer.test', `${ie.status} ${ie.error ?? ''}`)
  const im = await waitFor((m) => to(m).includes('accounts@customer.test') && m.Subject.includes(inv.invoiceNo))
  check('invoice: arrives with the invoice number in the subject', !!im, im?.Subject)
  if (im) {
    const body = await messageBody(im.ID)
    check('invoice: body carries the invoice number and total', body.HTML?.includes(inv.invoiceNo) && /₹/.test(body.HTML ?? ''), '')
    check('invoice: customer-controlled text is HTML-escaped (no <script>)', !/<script>/i.test(body.HTML ?? '') && /&lt;script&gt;/.test(body.HTML ?? ''), '')
    check('invoice: a plain-text part is included', (body.Text ?? '').includes(inv.invoiceNo), '')
  }
  const typed = await post(N, { action: 'invoice', id: inv.id, to: 'Other@Customer.test' })
  check('invoice: a typed address overrides the one on file', typed.status === 200 && typed.data?.to === 'other@customer.test', `${typed.status} ${typed.error ?? ''}`)
  const missing = await post(N, { action: 'invoice', id: 'nope' })
  check('invoice: unknown invoice → 404', missing.status === 404, `${missing.status}`)
  const statusMap = await get(`${N}?entity=SalesInvoice&ids=${inv.id}`)
  check('invoice: last email status is reported per document', statusMap.data?.[inv.id]?.status === 'SENT', JSON.stringify(statusMap.data))

  // ---- payment reminders
  const aging = await get('/api/reports?type=aging&kind=sales')
  const overdueParty = (aging.data?.parties ?? []).find((p) => p.total - (p.notDue ?? 0) > 0.004)
  const cleanParty = (await db.get("SELECT id FROM Party WHERE types LIKE '%CUSTOMER%' AND id NOT IN (SELECT partyId FROM SalesInvoice WHERE status='POSTED' AND grandTotal - paidAmount > 0.004) LIMIT 1"))?.id
  if (overdueParty) {
    await db.run('UPDATE Party SET email=? WHERE id=?', ['ar@overdue.test', overdueParty.partyId])
    const r1 = await post(N, { action: 'reminder', partyId: overdueParty.partyId })
    check('reminder: sent to a customer with overdue invoices', r1.status === 200 && r1.data?.invoices >= 1, `${r1.status} ${r1.error ?? ''}`)
    const rm = await waitFor((m) => to(m).includes('ar@overdue.test') && /reminder/i.test(m.Subject))
    check('reminder: arrives, subject states the overdue amount', !!rm && /₹/.test(rm.Subject), rm?.Subject)
    const r2 = await post(N, { action: 'reminder', partyId: overdueParty.partyId })
    check('reminder: a second reminder the same day is refused (409)', r2.status === 409 && /already reminded/i.test(r2.error ?? ''), `${r2.status} ${r2.error}`)
    const r3 = await post(N, { action: 'reminder', partyId: overdueParty.partyId, force: true })
    check('reminder: force sends again deliberately', r3.status === 200, `${r3.status} ${r3.error ?? ''}`)
  } else check('reminder: the seed has a customer with overdue invoices', false, 'no overdue party')
  if (cleanParty) {
    const rc = await post(N, { action: 'reminder', partyId: cleanParty })
    check('reminder: a customer with nothing overdue is not reminded (409)', rc.status === 409 && /no overdue/i.test(rc.error ?? ''), `${rc.status} ${rc.error}`)
  }
  const all = await post(N, { action: 'reminders-all' })
  check('reminders-all: runs and reports sent + skipped (already reminded today is skipped)', all.status === 200 && Array.isArray(all.data?.sent) && Array.isArray(all.data?.skipped) && all.data.skipped.some((s) => /already reminded/i.test(s.reason)), JSON.stringify({ sent: all.data?.sent?.length, skipped: all.data?.skipped?.length }))

  // ---- log, audit, ownership
  const msgs = await mailbox()
  const sentRows = Number((await db.get("SELECT COUNT(*) n FROM EmailLog WHERE status='SENT'")).n)
  check('log: every message the SMTP server received has a SENT EmailLog row', sentRows === msgs.length, `log=${sentRows} mailbox=${msgs.length}`)
  const org = (await db.get("SELECT companyId FROM OrgUser WHERE email='owner@shreeforge.example.com'")).companyId
  const foreign = Number((await db.get('SELECT COUNT(*) n FROM EmailLog WHERE companyId<>?', [org])).n)
  check('log: every email row belongs to the sending organisation', foreign === 0, `foreign=${foreign}`)
  const audits = Number((await db.get("SELECT COUNT(*) n FROM AuditLog WHERE action='EMAIL'")).n)
  check('audit: each send is in the audit trail', audits >= 4, `audit rows=${audits}`)
  const ov = await get(N)
  check('overview: recent list shows the sends, newest first', (ov.data?.recent ?? []).length === sentRows && new Date(ov.data.recent[0].createdAt) >= new Date(ov.data.recent.at(-1).createdAt), `${ov.data?.recent?.length}`)

  // ---- access
  const saved = cookie; cookie = ''
  const anon = await post(N, { action: 'test', to: 'x@audit.test' })
  check('access: sending without a session is refused', anon.status === 401 || anon.status === 403, `${anon.status}`)
  cookie = saved

  const summary = { ranAt: new Date().toISOString(), baseUrl: BASE, total: results.length, passed: results.length - failures, failed: failures, results }
  writeFileSync(process.env.EMAIL_RESULTS ?? join(ROOT, 'tests', 'email-audit-results.json'), JSON.stringify(summary, null, 2))
  console.log(`\n=== ${summary.passed}/${summary.total} email checks passed, ${summary.failed} failed ===`)
  await db.close()
  if (failures) process.exitCode = 1
}
main().catch(async (e) => { console.error('EMAIL SUITE ERROR', e); await db.close(); process.exitCode = 2 })
