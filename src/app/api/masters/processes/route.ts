import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'

export async function GET() {
  try {
    return ok(await db.process.findMany({ orderBy: { seq: 'asc' } }))
  } catch (e) {
    return handleError(e)
  }
}

const processSchema = z.object({
  code: z.string().min(1, 'Code is required').max(20),
  name: z.string().min(1, 'Name is required'),
  seq: z.number().int().min(0).default(0),
  basis: z.enum(['WEIGHT', 'QTY']),
  rate: z.number().min(0).default(0),
  lotCharge: z.number().min(0).default(0),
})

export async function POST(req: Request) {
  try {
    return ok(await db.process.create({ data: processSchema.parse(await req.json()) }))
  } catch (e) {
    return handleError(e)
  }
}
