import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from './db'
import { fail } from './api'

const KEEP_DAYS = 7

/**
 * Make a mutating POST safe to double-submit or retry.
 *
 * With an `Idempotency-Key` header the first request reserves the key (unique
 * primary key, so a concurrent duplicate loses the insert race), runs, and stores
 * its response. A repeat with the same key and body replays that response
 * (header `Idempotent-Replay: true`) instead of posting a second document; a
 * repeat while the first is still running gets 409; the same key with a
 * different body gets 422. Failed requests (status >= 400) release the key so a
 * corrected retry can run. Without the header the handler simply runs.
 */
export async function withIdempotency(req: Request, scope: string, run: (req: Request) => Promise<Response>): Promise<Response> {
  const key = req.headers.get('idempotency-key')?.trim()
  if (!key) return run(req)
  if (key.length > 120) return fail('Idempotency-Key is too long (max 120 characters)', 400)
  const id = `${scope}:${key}`
  // Read the body ONCE and hand the handler a fresh Request built from it.
  // req.clone() + a second read raced under concurrent requests (the proxy
  // buffers the body) and failed with "Body has already been read" → 500.
  const raw = await req.text()
  const fresh = () => new Request(req.url, { method: req.method, headers: req.headers, body: raw })
  const requestHash = createHash('sha256').update(raw).digest('hex')
  try {
    await db.idempotencyKey.create({ data: { id, scope, requestHash } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const prior = await db.idempotencyKey.findUnique({ where: { id } })
      if (prior && prior.requestHash !== requestHash) return fail('This Idempotency-Key was already used for a different request', 422)
      if (prior?.state === 'COMPLETED' && prior.responseBody !== null) {
        return new Response(prior.responseBody, { status: prior.statusCode ?? 200, headers: { 'Content-Type': 'application/json', 'Idempotent-Replay': 'true' } })
      }
      return fail('This request is already being processed — wait for it to finish', 409)
    }
    throw error
  }
  if (Math.random() < 0.02) {
    void db.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } }).catch(() => {})
  }
  let response: Response
  try {
    response = await run(fresh())
  } catch (error) {
    await db.idempotencyKey.delete({ where: { id } }).catch(() => {})
    throw error
  }
  if (response.status >= 400) {
    await db.idempotencyKey.delete({ where: { id } }).catch(() => {})
    return response
  }
  const body = await response.clone().text()
  await db.idempotencyKey.update({ where: { id }, data: { state: 'COMPLETED', statusCode: response.status, responseBody: body } }).catch(() => {})
  return response
}
