import { fail, handleError, ok } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertFeature, assertMutationAccess } from '@/lib/platform'
import { loadInvoiceVoucher, loadPaymentVoucher, vouchersToXml, getCompany, type TallyDocKind } from '@/lib/tally'
import { db } from '@/lib/db'
import { BusinessError } from '@/lib/accounting'
import { runAsTenant, tenantCompany } from '@/lib/tenant'

/**
 * Tally connector — pairing, token and job queue persisted per organisation
 * (TallyConnector / TallyConnectorJob), so a server restart or redeploy no
 * longer unpairs the connector or drops queued vouchers.
 *
 * One connector per ORGANISATION. UI actions use the session's organisation;
 * connector-side actions (no cookie) are resolved to their organisation by the
 * SHA-256 hash of the pairing code / bearer token, so one org's vouchers can
 * never reach another org's Tally, and one org cannot see or revoke another
 * org's connector. Only hashes are stored. Pattern from the erpnashilk audit:
 * hashed single-use pairing codes, bearer token returned once, one job per
 * poll, results field-whitelisted.
 *
 *  POST {action:'new-code'}                 → {code, expiresAt}   (user UI)
 *  POST {action:'pair', code}               → {token}             (connector, once)
 *  POST {action:'queue', doc, id}           → {jobId}             (user UI)
 *  POST {action:'result', jobId, ok, ...}   + Bearer              (connector)
 *  GET  (Bearer, ?mode=pending)             → {job} | {empty}     (connector poll)
 *  GET  (Bearer, ?mode=status)              → {paired, online, pending} (connector CLI)
 *  GET  (session)                           → status for the UI
 *  DELETE                                   → revoke connector
 */

const CODE_TTL_MS = 10 * 60 * 1000
const JOB_TTL_MS = 30 * 60 * 1000
const ONLINE_WINDOW_MS = 90 * 1000
/** A job handed out but never reported back is offered again after this. */
const REDELIVER_AFTER_MS = 60 * 1000

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L

type Connector = NonNullable<Awaited<ReturnType<typeof db.tallyConnector.findUnique>>>

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

/** The signed-in organisation's id (call after an assert*Access()). */
async function sessionCompanyId(): Promise<string> {
  const company = await tenantCompany(db)
  if (!company) throw new BusinessError('Operating company is not configured', 409)
  return company.id
}

/**
 * The connector whose token matches the bearer, or null. Looked up unscoped
 * (the connector has no session); everything after runs as that organisation.
 */
async function bearerConnector(req: Request): Promise<Connector | null> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const tokenHash = await sha256(token)
  return runAsTenant(null, () => db.tallyConnector.findUnique({ where: { tokenHash } }))
}

const asOrg = <T,>(companyId: string, fn: () => Promise<T>) => runAsTenant(companyId, fn)

// ---------- handlers ----------

export async function GET(req: Request) {
  try {
    const mode = new URL(req.url).searchParams.get('mode')

    // Connector poll: one pending job at a time (bearer-token gated, no cookie).
    if (mode === 'pending') {
      const c = await bearerConnector(req)
      if (!c) return fail('Connector token invalid or revoked', 401)
      return await asOrg(c.companyId, async () => {
        const now = new Date()
        await db.tallyConnector.update({ where: { id: c.id }, data: { lastSeenAt: now } })
        const stale = new Date(now.getTime() - REDELIVER_AFTER_MS)
        // Never started first, then ones handed out but never reported back.
        // Claimed with a conditional update so two polls cannot both take it.
        for (let attempt = 0; attempt < 3; attempt++) {
          const job =
            (await db.tallyConnectorJob.findFirst({ where: { companyId: c.companyId, doneAt: null, startedAt: null }, orderBy: { queuedAt: 'asc' } })) ??
            (await db.tallyConnectorJob.findFirst({ where: { companyId: c.companyId, doneAt: null, startedAt: { lt: stale } }, orderBy: { queuedAt: 'asc' } }))
          if (!job) return ok({ empty: true, nextPollSec: 30 })
          const claimed = await db.tallyConnectorJob.updateMany({
            where: { id: job.id, companyId: c.companyId, doneAt: null, startedAt: job.startedAt },
            data: { startedAt: now },
          })
          if (claimed.count === 1) return ok({ job: { jobId: job.id, doc: job.doc, docNo: job.docNo, xml: job.xml } })
        }
        return ok({ empty: true, nextPollSec: 5 })
      })
    }

    // Local CLI status uses the connector bearer; UI status uses the session.
    if (mode === 'status') {
      const c = await bearerConnector(req)
      if (!c) return fail('Connector token invalid or revoked', 401)
      const pending = await asOrg(c.companyId, () => db.tallyConnectorJob.count({ where: { companyId: c.companyId, doneAt: null } }))
      return ok({ paired: !!c.tokenHash, online: (c.lastSeenAt?.getTime() ?? 0) > Date.now() - ONLINE_WINDOW_MS, pending })
    }

    // UI status
    await assertCompanyAccess()
    const companyId = await sessionCompanyId()
    const c = await db.tallyConnector.findUnique({ where: { companyId } })
    const paired = !!c?.tokenHash
    const online = paired && (c?.lastSeenAt?.getTime() ?? 0) > Date.now() - ONLINE_WINDOW_MS
    const pending = await db.tallyConnectorJob.count({ where: { companyId, doneAt: null } })
    const recent = await db.tallyConnectorJob.findMany({
      where: { companyId, doneAt: { not: null } },
      orderBy: { doneAt: 'desc' },
      take: 10,
      select: { docNo: true, ok: true, created: true, altered: true, errors: true, errorText: true },
    })
    return ok({
      paired,
      online,
      pending,
      lastSeenAt: c?.lastSeenAt?.getTime() ?? null,
      pairedAt: c?.pairedAt?.getTime() ?? null,
      connectorVersion: c?.connectorVersion ?? null,
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
      const companyId = await sessionCompanyId()
      const code = randomCode()
      const codeHash = await sha256(code)
      const codeExpiresAt = new Date(Date.now() + CODE_TTL_MS)
      await db.tallyConnector.upsert({ where: { companyId }, create: { companyId, codeHash, codeExpiresAt }, update: { codeHash, codeExpiresAt } })
      await logAudit('CREATE', 'TallyConnector', undefined, `pairing code issued (expires in 10 min)`)
      return ok({ code, expiresAt: codeExpiresAt.toISOString() })
    }

    if (action === 'pair') {
      const code = (body.code ?? '').trim().toUpperCase()
      if (!code) return fail('Pairing code is required', 400)
      // The code identifies the organisation that issued it (unique hash).
      const codeHash = await sha256(code)
      const c = await runAsTenant(null, () => db.tallyConnector.findUnique({ where: { codeHash } }))
      if (!c) return fail('Pairing code invalid', 400)
      return await asOrg(c.companyId, async () => {
        // Single use: consume the code atomically (also when it has expired),
        // so two connectors racing on one code cannot both get a token.
        const consumed = await db.tallyConnector.updateMany({ where: { id: c.id, codeHash }, data: { codeHash: null, codeExpiresAt: null } })
        if (consumed.count !== 1) return fail('Pairing code invalid', 400)
        if (!c.codeExpiresAt || c.codeExpiresAt.getTime() < Date.now()) return fail('Pairing code expired — generate a new one', 400)
        const token = randomToken()
        const now = new Date()
        await db.tallyConnector.update({
          where: { id: c.id },
          data: { tokenHash: await sha256(token), pairedAt: now, lastSeenAt: now, connectorVersion: body.version?.slice(0, 40) ?? null },
        })
        await logAudit('CREATE', 'TallyConnector', undefined, `connector paired (v${body.version?.slice(0, 40) ?? '?'})`)
        return ok({ token }) // shown once — never again
      })
    }

    if (action === 'queue') {
      const actor = await assertMutationAccess()
      await assertFeature('exportData')
      const doc = (body.doc ?? '').toUpperCase() as TallyDocKind
      const id = body.id ?? ''
      if (!id || !['SALES', 'PURCHASE', 'PAYMENT'].includes(doc)) return fail('doc and id are required', 400)
      const companyId = await sessionCompanyId()
      const open = await db.tallyConnectorJob.findFirst({ where: { companyId, doc, docId: id, doneAt: null }, select: { id: true } })
      if (open) return ok({ duplicate: true })
      const voucher =
        doc === 'SALES' ? await loadInvoiceVoucher('SALES', id) : doc === 'PURCHASE' ? await loadInvoiceVoucher('PURCHASE', id) : await loadPaymentVoucher(id)
      const company = await getCompany()
      const xml = vouchersToXml([voucher], company?.tallyCompanyName ?? null)
      const job = await db.tallyConnectorJob.create({
        data: {
          id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          companyId,
          doc,
          docId: id,
          docNo: voucher.voucherNumber,
          xml,
        },
      })
      // retention trim
      await db.tallyConnectorJob.deleteMany({ where: { companyId, queuedAt: { lt: new Date(Date.now() - JOB_TTL_MS) } } })
      // Exporting voucher XML to an external Tally instance is an outbound
      // data movement — it must be attributable at QUEUE time (not only when
      // the connector reports the result).
      await logAudit('EXPORT', 'TallyConnector', job.docNo, `queued ${doc} ${job.docNo} for Tally`, actor?.email)
      return ok({ jobId: job.id, docNo: job.docNo })
    }

    if (action === 'result') {
      const c = await bearerConnector(req)
      if (!c) return fail('Connector token invalid or revoked', 401)
      return await asOrg(c.companyId, async () => {
        await db.tallyConnector.update({ where: { id: c.id }, data: { lastSeenAt: new Date() } })
        // Scoped to this connector's organisation: another org's job id is "not found".
        const job = await db.tallyConnectorJob.findFirst({ where: { id: String(body.jobId ?? ''), companyId: c.companyId } })
        if (!job) return ok({ accepted: false })
        const clamp = (n?: number) => Math.max(0, Math.min(9999, Math.trunc(Number(n ?? 0)) || 0))
        const done = await db.tallyConnectorJob.update({
          where: { id: job.id },
          data: {
            doneAt: new Date(),
            ok: !!body.ok,
            created: clamp(body.created),
            altered: clamp(body.altered),
            errors: clamp(body.errors),
            errorText: String(body.errorText ?? '').slice(0, 300),
          },
        })
        await logAudit(body.ok ? 'EXPORT' : 'UPDATE', 'TallyConnector', done.docNo, body.ok ? `created ${done.created}, altered ${done.altered}` : (done.errorText ?? ''))
        return ok({ accepted: true })
      })
    }

    return fail('Unknown action', 400)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE() {
  try {
    await assertMutationAccess()
    const companyId = await sessionCompanyId()
    await db.tallyConnector.updateMany({
      where: { companyId },
      data: { tokenHash: null, codeHash: null, codeExpiresAt: null, pairedAt: null, lastSeenAt: null, connectorVersion: null },
    })
    await db.tallyConnectorJob.deleteMany({ where: { companyId } })
    await logAudit('DELETE', 'TallyConnector', undefined, 'connector revoked')
    return ok({ revoked: true })
  } catch (e) {
    return handleError(e)
  }
}
