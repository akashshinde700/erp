import { ok, fail, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'

/** GET ?partyId=… → full rate grid for a party (process defaults included). */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const partyId = new URL(req.url).searchParams.get('partyId')
    if (!partyId) return fail('partyId is required')
    const [party, processes, rates] = await Promise.all([
      db.party.findUnique({ where: { id: partyId } }),
      db.process.findMany({ where: { active: true }, orderBy: { seq: 'asc' } }),
      db.partyProcessRate.findMany({ where: { partyId } }),
    ])
    if (!party) return fail('Party not found', 404)
    const rateMap = new Map(rates.map((r) => [r.processId, r]))
    return ok({
      party: { id: party.id, code: party.code, name: party.name },
      rows: processes.map((p) => {
        const pr = rateMap.get(p.id)
        return {
          processId: p.id,
          code: p.code,
          name: p.name,
          basis: p.basis,
          defaultRate: p.rate,
          defaultLot: p.lotCharge,
          rate: pr?.rate ?? p.rate,
          lotCharge: pr?.lotCharge ?? p.lotCharge,
          overridden: !!pr,
        }
      }),
    })
  } catch (e) {
    return handleError(e)
  }
}

const bulkSchema = z.object({
  partyId: z.string().min(1),
  rates: z
    .array(
      z.object({
        processId: z.string().min(1),
        rate: z.number().min(0).finite().max(1_000_000),
        lotCharge: z.number().min(0).finite().max(1_000_000),
      })
    )
    .max(200, 'Too many rate rows'),
})

/** PUT — full-list upsert: sets the party's rate grid exactly as submitted. */
export async function PUT(req: Request) {
  try {
    await assertMutationAccess()
    const body = bulkSchema.parse(await req.json())
    const party = await db.party.findUnique({ where: { id: body.partyId } })
    if (!party) return fail('Party not found', 404)
    await db.$transaction(async (tx) => {
      await tx.partyProcessRate.deleteMany({ where: { partyId: body.partyId } })
      if (body.rates.length) {
        await tx.partyProcessRate.createMany({
          data: body.rates.map((r) => ({ ...r, partyId: body.partyId })),
        })
      }
    })
    return ok({ partyId: body.partyId, count: body.rates.length })
  } catch (e) {
    return handleError(e)
  }
}
