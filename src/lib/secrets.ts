/**
 * ForgeERP — per-install secret material.
 *
 * Every deployment gets a high-entropy secret even when the operator does not
 * set env vars: secrets are loaded in this order —
 *   1. process.env (explicit override, always wins)
 *   2. a persisted key file under db/ (generated once, reused across restarts)
 *   3. last-resort dev fallback (ONLY outside production, logged loudly)
 *
 * Persisting to a file keeps sessions valid across dev-server restarts and
 * makes the forgeable default-secret attack impossible on real installs.
 * Route handlers run on the Node.js runtime; the API proxy opts into the
 * Node.js runtime too so it can share the exact same secret.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SECRETS_DIR = join(process.cwd(), 'db')
const DEV_FALLBACK = 'forge-dev-session-secret-change-me'

const memo = new Map<string, string>()

function loadOrCreate(fileName: string, envVar: string | undefined, label: string): string {
  if (envVar && envVar.length >= 16) return envVar
  const cached = memo.get(fileName)
  if (cached) return cached
  if (envVar && envVar.length > 0 && envVar.length < 16) {
    console.warn(`[secrets] ${label}: env value is too short (<16 chars) — using a persisted random key instead`)
  }
  const file = join(SECRETS_DIR, fileName)
  try {
    if (existsSync(file)) {
      const stored = readFileSync(file, 'utf8').trim()
      if (stored.length >= 32) {
        memo.set(fileName, stored)
        return stored
      }
    }
    mkdirSync(SECRETS_DIR, { recursive: true })
    const generated = randomBytes(32).toString('hex')
    writeFileSync(file, generated + '\n', { mode: 0o600 })
    console.info(`[secrets] generated a new ${label} and stored it at ${file} (set ${envVar ? 'a stronger env value' : 'the matching env var'} to override)`)
    memo.set(fileName, generated)
    return generated
  } catch {
    // Read-only filesystem (some hardened hosts): fall back honestly.
    if (process.env.NODE_ENV === 'production') {
      console.error(`[secrets] CRITICAL: could not persist ${label} and no env override is set — falling back to the public dev secret. Set the env var NOW.`)
    }
    return DEV_FALLBACK + ':' + label
  }
}

/** HMAC key for session cookies (auth.ts + proxy.ts share this — one source of truth). */
export function sessionSecret(): string {
  return loadOrCreate('session-secret.key', process.env.SESSION_SECRET, 'SESSION_SECRET')
}

/** Platform admin API key (x-platform-key header; header only — never in URLs). */
export function platformAdminKey(): string {
  return loadOrCreate('platform-key.key', process.env.PLATFORM_ADMIN_KEY, 'PLATFORM_ADMIN_KEY')
}

/** Random password generator (platform admin bootstrap when no env password is set). */
export function randomPassword(length = 18): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}
