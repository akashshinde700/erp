/**
 * ForgeERP — in-memory login throttle (per-IP+email sliding window).
 *
 * Scope, stated honestly: single-instance, best-effort brute-force damping.
 * It stops online password spraying against this deployment; a multi-instance
 * deployment would move the counter to shared storage. Failed attempts only
 * are counted; a successful sign-in clears the window for that key.
 */
const WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const MAX_FAILURES = 10

const buckets = new Map<string, number[]>()
let lastSweep = Date.now()

function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, ts] of buckets) {
    if (ts.every((t) => now - t > WINDOW_MS)) buckets.delete(k)
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'local'
}

/** True when the key is currently throttled (too many recent failures). */
export function isThrottled(key: string): boolean {
  const now = Date.now()
  sweep(now)
  const ts = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  return ts.length >= MAX_FAILURES
}

/** Record a failed attempt for the key. */
export function recordFailure(key: string): void {
  const now = Date.now()
  sweep(now)
  const ts = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  ts.push(now)
  buckets.set(key, ts)
}

/** Clear failures for the key (successful login). */
export function clearFailures(key: string): void {
  buckets.delete(key)
}

/** Standard 429 response message. */
export const THROTTLE_MESSAGE = `Too many failed sign-in attempts — try again in a few minutes`
