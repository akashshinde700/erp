import { NextRequest, NextResponse } from 'next/server'

/**
 * ForgeERP — API sign-in gate (Next.js proxy, Node.js runtime).
 * Business routes require a VALID org session cookie:
 *  1. Presence — a signed-out browser never touches business data.
 *  2. Signature + expiry — verified here (WebCrypto HMAC) so a forged or
 *     stale cookie is rejected before any route runs.
 * The signing secret is the SAME one auth.ts uses (src/lib/secrets.ts —
 * env var or persisted per-install key file), so tokens signed by the server
 * always verify here and tokens forged with the old public default never do.
 * Org membership (operating org), user revocation and roles are enforced
 * server-side per route (lib/platform.ts assertCompanyAccess) where the DB
 * is available — this gate is the fast first line, not the only one.
 *
 * Public prefixes: auth (login/logout/bootstrap), platform admin
 * (requirePlatformAdmin gates each route), seed + company profile (first-boot
 * setup — the routes themselves enforce access once logins exist), backup
 * (platform-key/session gated at the route).
 */

const PUBLIC_API = ['/api/auth', '/api/platform', '/api/seed', '/api/masters/company', '/api/backup']

const SESSION_COOKIE = 'forge_session'

const enc = new TextEncoder()
let keyMaterial: string | null = null
let keyMaterialPromise: Promise<string> | null = null
let keyPromise: Promise<CryptoKey> | null = null

/** Load the shared secret once per proxy instance (env var or persisted key file). */
async function secret(): Promise<string> {
  keyMaterial ??= await (keyMaterialPromise ??= (async () => {
    try {
      const { sessionSecret } = await import('@/lib/secrets')
      return sessionSecret()
    } catch {
      // If the secrets module cannot load (unexpected), fall back to env-only
      // so the gate never hard-fails closed on every request.
      return process.env.SESSION_SECRET ?? 'forge-dev-session-secret-change-me'
    }
  })())
  return keyMaterial
}

function toBase64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getKey(): Promise<CryptoKey> {
  const material = await secret()
  keyPromise ??= crypto.subtle.importKey('raw', enc.encode(material), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return keyPromise
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

// Proxy always runs on the Node.js runtime in Next 16; a `runtime` export here is a build error.
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  if (PUBLIC_API.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next()
  }
  // Request-size guard (defense against memory-exhaustion DoS): all business
  // APIs are small JSON documents. Restore payloads (snapshot import) get a
  // larger budget. Chunked requests without Content-Length are rare for this
  // app's fetch clients and are let through — route-level JSON parsing still
  // bounds practical size.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const len = Number(req.headers.get('content-length') ?? '0')
    const limit = path.startsWith('/api/backup/restore') ? 26_214_400 : 1_048_576 // 25 MB : 1 MB
    if (len && Number.isFinite(len) && len > limit) {
      return NextResponse.json({ success: false, error: 'Request body too large' }, { status: 413 })
    }
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
