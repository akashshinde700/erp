/**
 * ForgeERP — organization login (SaaS auth).
 *
 * Scope, stated honestly:
 *  - Org users log in with email + password (scrypt-hashed, salt:hash hex).
 *  - Session = httpOnly signed cookie (HMAC-SHA256), 7-day expiry, carrying a
 *    per-user tokenVersion so password resets / admin revocations kill live
 *    sessions instantly (verified against the DB by resolveSession).
 *  - The ERP workspace serves the FIRST company (operating org); logins for
 *    other orgs are real but land on an org portal, not the books — data
 *    separation beyond that is the multi-tenant roadmap (no companyId on
 *    business tables yet, so we never pretend to scope it).
 *  - The signing secret comes from src/lib/secrets.ts (env var or a persisted
 *    per-install key file) — never the public dev fallback on a real install.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { sessionSecret } from './secrets'

export const SESSION_COOKIE = 'forge_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface SessionPayload {
  uid: string
  cid: string
  exp: number
  tv?: number // tokenVersion — bumped to revoke every live session for the user
}

// ---------- passwords (scrypt) ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  try {
    const expected = Buffer.from(hash, 'hex')
    const actual = scryptSync(password, salt, 64)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/** Constant-work dummy verification — used when the email is unknown so login
 *  timing cannot enumerate registered accounts. */
export function burnPasswordCheck(): void {
  scryptSync('timing-equalizer', 'deadbeef'.repeat(4), 64)
}

// ---------- signed session token ----------

function sign(data: string): string {
  return createHmac('sha256', sessionSecret()).update(data).digest('base64url')
}

export function createSessionToken(userId: string, companyId: string, tokenVersion = 0): string {
  const payload: SessionPayload = { uid: userId, cid: companyId, exp: Date.now() + SESSION_TTL_MS, tv: tokenVersion }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function readSessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload
    if (!payload?.uid || !payload?.cid || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

// ---------- cookie helpers (route handlers) ----------

export function setSessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
    secure: process.env.NODE_ENV === 'production',
  })
  return res
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}

/** Read the current session from the request cookie store (route handlers only). */
export async function currentSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  return readSessionToken(store.get(SESSION_COOKIE)?.value)
}

/**
 * Signature + DB verification: the user must still exist with the same
 * tokenVersion. Used where authenticity matters (auth/session, org gating).
 * Returns null when the session is revoked or the user was deleted.
 */
export async function resolveSession(): Promise<SessionPayload | null> {
  const payload = await currentSession()
  if (!payload) return null
  try {
    const { db } = await import('./db')
    const user = await db.orgUser.findUnique({
      where: { id: payload.uid },
      select: { tokenVersion: true },
    })
    if (!user) return null
    if ((payload.tv ?? 0) !== user.tokenVersion) return null
    return payload
  } catch {
    return null
  }
}
