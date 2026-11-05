import { NextRequest, NextResponse } from 'next/server'

/**
 * ForgeERP — API sign-in gate (Next.js 16 proxy).
 * Business routes require a VALID org session cookie:
 *  1. Presence — a signed-out browser never touches business data.
 *  2. Signature + expiry — verified here (WebCrypto HMAC, edge-safe) so a
 *     forged or stale cookie is rejected before any route runs.
 * Org membership (operating org) is enforced server-side per route
 * (lib/platform.ts assertCompanyAccess) where the DB is available.
 *
 * Public prefixes: auth (login/logout/bootstrap), platform admin
 * (x-platform-key gated separately), seed + company profile (first-boot
 * setup), backup (platform-key gated at the route).
 */

const PUBLIC_API = ['/api/auth', '/api/platform', '/api/seed', '/api/masters/company', '/api/backup']

// Keep in sync with SESSION_SECRET in src/lib/auth.ts (edge module — no node:crypto import possible).
const SECRET = process.env.SESSION_SECRET ?? 'forge-dev-session-secret-change-me'
const SESSION_COOKIE = 'forge_session'

const enc = new TextEncoder()
let keyPromise: Promise<CryptoKey> | null = null

function getKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return keyPromise
}

function toBase64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(data: string): Promise<string> {
  return toBase64url(await crypto.subtle.sign('HMAC', await getKey(), enc.encode(data)))
}

/** Verify the signed session token (base64url(payload).signature). */
async function tokenValid(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return false
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = await hmac(body)
  if (sig.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return false
  try {
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return typeof payload.exp === 'number' && payload.exp > Date.now()
  } catch {
    return false
  }
}

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  if (PUBLIC_API.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next()
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) {
    return NextResponse.json({ success: false, error: 'Sign in to your organization first' }, { status: 401 })
  }
  if (!(await tokenValid(token))) {
    return NextResponse.json({ success: false, error: 'Your session is invalid or expired — sign in again' }, { status: 401 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
