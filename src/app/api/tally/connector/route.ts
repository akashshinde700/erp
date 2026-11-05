import { fail, handleError, ok } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { loadInvoiceVoucher, loadPaymentVoucher, vouchersToXml, getCompany, type TallyDocKind } from '@/lib/tally'

/**
 * Tally connector (PoC — in-memory store on globalThis, state lost on restart).
 * Pattern from the erpnashilk audit: hashed single-use pairing codes, bearer
 * token returned once, one job per poll, results field-whitelisted.
 *
 *  POST {action:'new-code'}                 → {code, expiresAt}   (user UI)
 *  POST {action:'pair', code}               → {token}             (connector, once)
 *  POST {action:'queue', doc, id}           → {jobId}             (user UI)
 *  POST {action:'result', jobId, ok, ...}   + Bearer              (connector)
 *  GET  (Bearer, ?mode=pending)             → {job} | {empty}     (connector poll)
 *  GET  (no token)                          → status for the UI
 *  DELETE                                   → revoke connector
 */

const CODE_TTL_MS = 10 * 60 * 1000
const JOB_TTL_MS = 30 * 60 * 1000
const ONLINE_WINDOW_MS = 90 * 1000

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L

interface Job {
  id: string
  doc: TallyDocKind
  docId: string
  docNo: string
  xml: string
  queuedAt: number
  startedAt?: number
  doneAt?: number
  ok?: boolean
  created?: number
  altered?: number
  errors?: number
  errorText?: string
}

interface Store {
  codeHash: string | null
  codeExpiresAt: number
  tokenHash: string | null
  connectorVersion: string | null
  pairedAt: number | null
  lastSeenAt: number | null
  jobs: Job[]
}

declare global {
  var __forgeTallyConnector: Store | undefined
}

function store(): Store {
  globalThis.__forgeTallyConnector ??= {
    codeHash: null,
    codeExpiresAt: 0,
    tokenHash: null,
    connectorVersion: null,
    pairedAt: null,
    lastSeenAt: null,
    jobs: [],
  }
  return globalThis.__forgeTallyConnector
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function randomCode(): string {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += CODE_CHARS[b % CODE_CHARS.length]
  return `${s.slice(0, 5)}-${s.slice(5)}`
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `ftc_${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

async function bearerOk(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token || !store().tokenHash) return false
  return (await sha256(token)) === store().tokenHash
}

// ---------- handlers ----------

export async function GET(req: Request) {
  try {
    const mode = new URL(req.url).searchParams.get('mode')

    // Connector poll: one pending job at a time (bearer-token gated, no cookie).
    if (mode === 'pending') {
      if (!(await bearerOk(req))) return fail('Connector token invalid or revoked', 401)
      const s = store()
      s.lastSeenAt = Date.now()
      const now = Date.now()
      const job = s.jobs.find((j) => !j.doneAt && (j.startedAt ?? 0) < now - 60 * 1000) ?? s.jobs.find((j) => !j.doneAt && !j.startedAt)
      if (!job) return ok({ empty: true, nextPollSec: 30 })
      job.startedAt = now
      return ok({ job: { jobId: job.id, doc: job.doc, docNo: job.docNo, xml: job.xml } })
    }

    // UI status
    await assertCompanyAccess()
    const s = store()
    const now = Date.now()
    const paired = !!s.tokenHash
    const online = paired && (s.lastSeenAt ?? 0) > now - ONLINE_WINDOW_MS
    const pending = s.jobs.filter((j) => !j.doneAt).length
    const recent = s.jobs
      .filter((j) => j.doneAt)
      .slice(-10)
      .reverse()
      .map((j) => ({ docNo: j.docNo, ok: j.ok, created: j.created, altered: j.altered, errors: j.errors, errorText: j.errorText }))
    return ok({
      paired,
      online,
      pending,
      lastSeenAt: s.lastSeenAt,
      pairedAt: s.pairedAt,
      connectorVersion: s.connectorVersion,
      recent,
    })
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(req: Request) {
  try {
    // 'pair' and 'result' are connector-side actions (pairing code / bearer
    // token gated — no session); every user-side action requires an
    // operating-org session with mutation rights.
    const body = (await req.json()) as {
      action?: string
      code?: string
      version?: string
      jobId?: string
      ok?: boolean
      created?: number
      altered?: number
      errors?: number
      errorText?: string
      doc?: string
      id?: string
    }
    const action = body.action ?? ''

    if (action === 'new-code') {
      await assertMutationAccess()
      const s = store()
      const code = randomCode()
      s.codeHash = await sha256(code)
      s.codeExpiresAt = Date.now() + CODE_TTL_MS
      await logAudit('CREATE', 'TallyConnector', undefined, `pairing code issued (expires in 10 min)`)
      return ok({ code, expiresAt: new Date(s.codeExpiresAt).toISOString() })
    }

    if (action === 'pair') {
      const s = store()
      const code = (body.code ?? '').trim().toUpperCase()
      if (!code) return fail('Pairing code is required', 400)
      if (!s.codeHash || Date.now() > s.codeExpiresAt) {
        s.codeHash = null // single-use: consumed even if expired
        return fail('Pairing code expired — generate a new one', 400)
      }
      if ((await sha256(code)) !== s.codeHash) return fail('Pairing code invalid', 400)
      s.codeHash = null // single use
      const token = randomToken()
      s.tokenHash = await sha256(token)
      s.pairedAt = Date.now()
      s.lastSeenAt = Date.now()
      s.connectorVersion = body.version ?? null
      await logAudit('CREATE', 'TallyConnector', undefined, `connector paired (v${body.version ?? '?'})`)
      return ok({ token }) // shown once — never again
    }

    if (action === 'queue') {
      await assertMutationAccess()
      const doc = (body.doc ?? '').toUpperCase() as TallyDocKind
      const id = body.id ?? ''
      if (!id || !['SALES', 'PURCHASE', 'PAYMENT'].includes(doc)) return fail('doc and id are required', 400)
      const s = store()
      if (s.jobs.some((j) => j.doc === doc && j.docId === id && !j.doneAt)) return ok({ duplicate: true })
      const voucher =
        doc === 'SALES' ? await loadInvoiceVoucher('SALES', id) : doc === 'PURCHASE' ? await loadInvoiceVoucher('PURCHASE', id) : await loadPaymentVoucher(id)
      const company = await getCompany()
      const xml = vouchersToXml([voucher], company?.tallyCompanyName ?? null)
      const job: Job = {
        id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        doc,
        docId: id,
        docNo: voucher.voucherNumber,
        xml,
        queuedAt: Date.now(),
      }
      s.jobs.push(job)
      // retention trim
      s.jobs = s.jobs.filter((j) => j.queuedAt > Date.now() - JOB_TTL_MS)
      return ok({ jobId: job.id, docNo: job.docNo })
    }

    if (action === 'result') {
      if (!(await bearerOk(req))) return fail('Connector token invalid or revoked', 401)
      const s = store()
      s.lastSeenAt = Date.now()
      const job = s.jobs.find((j) => j.id === body.jobId)
      if (!job) return ok({ accepted: false })
      job.doneAt = Date.now()
      job.ok = !!body.ok
      job.created = Math.max(0, Math.min(9999, Math.trunc(body.created ?? 0)))
      job.altered = Math.max(0, Math.min(9999, Math.trunc(body.altered ?? 0)))
      job.errors = Math.max(0, Math.min(9999, Math.trunc(body.errors ?? 0)))
      job.errorText = String(body.errorText ?? '').slice(0, 300)
      await logAudit(body.ok ? 'EXPORT' : 'UPDATE', 'TallyConnector', job.docNo, body.ok ? `created ${job.created}, altered ${job.altered}` : job.errorText)
      return ok({ accepted: true })
    }

    return fail('Unknown action', 400)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE() {
  try {
    await assertMutationAccess()
    const s = store()
    s.tokenHash = null
    s.codeHash = null
    s.pairedAt = null
    s.lastSeenAt = null
    s.connectorVersion = null
    s.jobs = []
    await logAudit('DELETE', 'TallyConnector', undefined, 'connector revoked')
    return ok({ revoked: true })
  } catch (e) {
    return handleError(e)
  }
}
