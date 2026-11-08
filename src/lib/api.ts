import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { BusinessError } from './accounting'

export function ok(data: unknown, status = 200) {
  return NextResponse.json({ success: true, data })
}

export function fail(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status })
}

export function handleError(e: unknown) {
  if (e instanceof BusinessError) return fail(e.message, e.status)
  // req.json() on a malformed body throws SyntaxError — that is the client's fault.
  if (e instanceof SyntaxError) return fail('Request body is not valid JSON', 400)
  if (e instanceof ZodError) {
    return fail(e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 400)
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return fail('A record with this code/number already exists', 409)
    if (e.code === 'P2025') return fail('Record not found', 404)
  }
  // Log the real cause server-side; the client gets a generic message (no file
  // paths or Prisma internals leak into responses).
  console.error('[api]', e)
  return fail('Something went wrong on the server — try again (details are in the server log)', 500)
}
