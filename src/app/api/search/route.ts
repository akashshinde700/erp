import { ok, handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { assertCompanyAccess } from '@/lib/platform'

/**
 * GET /api/search?q=<query> — global cross-module search for the command
 * palette. Top-5 matches per entity, only for queries of 2+ characters.
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
    if (q.length < 2) return ok({ parties: [], items: [], salesInvoices: [], purchaseInvoices: [], inwards: [], projects: [] })
    const contains = { contains: q }

    const [parties, items, salesInvoices, purchaseInvoices, inwards, projects] = await Promise.all([
      db.party.findMany({
        where: { OR: [{ name: contains }, { code: contains }] },
        select: { id: true, code: true, name: true, stateCode: true, types: true },
        take: 5,
      }),
      db.item.findMany({
        where: { OR: [{ name: contains }, { code: contains }, { hsn: contains }] },
        select: { id: true, code: true, name: true, uom: true, hsn: true },
        take: 5,
      }),
      db.salesInvoice.findMany({
        where: { OR: [{ invoiceNo: { contains: q } }, { party: { name: contains } }] },
        select: { id: true, invoiceNo: true, grandTotal: true, status: true, party: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 5,
      }),
      db.purchaseInvoice.findMany({
        where: { OR: [{ invoiceNo: { contains: q } }, { party: { name: contains } }] },
        select: { id: true, invoiceNo: true, grandTotal: true, status: true, party: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 5,
      }),
      db.jobworkInward.findMany({
        where: { OR: [{ inwardNo: { contains: q } }, { party: { name: contains } }, { challanNo: { contains: q } }] },
        select: { id: true, inwardNo: true, status: true, party: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 5,
      }),
      db.project.findMany({
        where: { OR: [{ projectNo: { contains: q } }, { name: contains }, { party: { name: contains } }] },
        select: { id: true, projectNo: true, name: true, status: true, party: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ])

    return ok({ parties, items, salesInvoices, purchaseInvoices, inwards, projects })
  } catch (e) {
    return handleError(e)
  }
}
