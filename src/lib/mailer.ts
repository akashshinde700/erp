/**
 * ForgeERP — outgoing email over SMTP (Nodemailer).
 *
 * Configuration comes ONLY from the server environment — never from the
 * database, never from a request, never echoed back by an API:
 *
 *   SMTP_HOST      smtp.example.com            (required — unset = email off)
 *   SMTP_PORT      587                         (465 implies TLS)
 *   SMTP_SECURE    true | false                (default: port === 465)
 *   SMTP_USER      apikey / mailbox user       (optional for open relays)
 *   SMTP_PASS      secret                      (optional)
 *   SMTP_FROM      "Shree Forge <erp@shreeforge.in>"  (required with SMTP_HOST)
 *
 * When SMTP is not configured every send fails with a clear 409 instead of
 * throwing deep inside a request, so the rest of the ERP keeps working.
 */
import nodemailer, { type Transporter } from 'nodemailer'
import { BusinessError } from './accounting'

export interface MailStatus {
  configured: boolean
  host: string | null
  port: number | null
  secure: boolean
  from: string | null
  authenticated: boolean
  /** Why email is off, when it is. */
  reason: string | null
}

interface MailConfig {
  host: string
  port: number
  secure: boolean
  user: string | null
  pass: string | null
  from: string
}

function readConfig(): { config: MailConfig | null; reason: string | null } {
  const host = process.env.SMTP_HOST?.trim()
  if (!host) return { config: null, reason: 'SMTP_HOST is not set on the server' }
  const from = process.env.SMTP_FROM?.trim()
  if (!from) return { config: null, reason: 'SMTP_FROM is not set on the server' }
  const port = Number(process.env.SMTP_PORT ?? 587)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return { config: null, reason: 'SMTP_PORT is not a valid port' }
  const secureEnv = process.env.SMTP_SECURE?.trim().toLowerCase()
  const secure = secureEnv ? secureEnv === 'true' || secureEnv === '1' : port === 465
  return {
    config: { host, port, secure, from, user: process.env.SMTP_USER?.trim() || null, pass: process.env.SMTP_PASS ?? null },
    reason: null,
  }
}

/** Safe to show in the UI: no user name, no password. */
export function mailStatus(): MailStatus {
  const { config, reason } = readConfig()
  return {
    configured: !!config,
    host: config?.host ?? null,
    port: config?.port ?? null,
    secure: config?.secure ?? false,
    from: config?.from ?? null,
    authenticated: !!config?.user,
    reason,
  }
}

let cached: { key: string; transporter: Transporter } | null = null

function transporter(config: MailConfig): Transporter {
  // Rebuild only when the environment changed (tests swap it; prod does not).
  const key = `${config.host}:${config.port}:${config.secure}:${config.user ?? ''}`
  if (cached?.key === key) return cached.transporter
  const t = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
    // Bounded so a dead relay cannot hang a request for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  cached = { key, transporter: t }
  return t
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/

/** One plain address, no display name, no header tricks. */
export function normaliseAddress(raw: string | null | undefined): string {
  const v = String(raw ?? '').trim()
  if (!v || v.length > 254 || /[\r\n]/.test(v) || !EMAIL_RE.test(v)) throw new BusinessError(`"${v.slice(0, 80)}" is not a valid email address`, 400)
  return v.toLowerCase()
}

/** Minimal HTML escaping for values interpolated into email bodies. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface OutgoingMail {
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string | null
}

/**
 * Send one message. Throws BusinessError(409) when SMTP is not configured and
 * BusinessError(502) when the relay refuses — the caller logs both outcomes.
 */
export async function deliver(mail: OutgoingMail): Promise<{ messageId: string | null }> {
  const { config, reason } = readConfig()
  if (!config) throw new BusinessError(`Email is not set up: ${reason}. Ask the administrator to configure SMTP.`, 409)
  try {
    const info = await transporter(config).sendMail({
      from: config.from,
      to: mail.to,
      subject: mail.subject.replace(/[\r\n]+/g, ' ').slice(0, 250),
      html: mail.html,
      text: mail.text,
      replyTo: mail.replyTo || undefined,
    })
    return { messageId: info.messageId ?? null }
  } catch (e) {
    // Relay errors can echo the username — keep only the first line, no auth details.
    const msg = e instanceof Error ? e.message.split('\n')[0].replace(/(user|login|auth)[^,;]*/gi, '$1 …') : 'unknown error'
    throw new BusinessError(`The mail server refused the message: ${msg.slice(0, 200)}`, 502)
  }
}
