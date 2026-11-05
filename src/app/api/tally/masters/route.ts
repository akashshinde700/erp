import { NextResponse } from 'next/server'
import { handleError } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { assertFeature } from '@/lib/platform'
import { getCompany, mastersXml } from '@/lib/tally'

/**
 * GET /api/tally/masters?parties=0|1 (default 1)
 * "All Masters" import XML — units, ledger roles, party ledgers.
 * Import this FIRST so vouchers never hit "Ledger not found".
 */
export async function GET(req: Request) {
  try {
    await assertFeature('exportData')
    const withParties = new URL(req.url).searchParams.get('parties') !== '0'
    const company = await getCompany()
    if (!company) return NextResponse.json({ success: false, error: 'Company not set up' }, { status: 400 })
    const parties = withParties
      ? await db.party.findMany({ where: { active: true }, select: { name: true, types: true }, orderBy: { name: 'asc' } })
      : []
    const items = await db.item.findMany({ select: { uom: true } })
    const xml = mastersXml(company, parties, items)
    await logAudit('EXPORT', 'TallyMasters', undefined, `${parties.length} parties, ${items.length} items, withParties=${withParties}`)
    const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'company'
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="tally-masters-${slug}.xml"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
