import { NextResponse } from 'next/server'
import { handleError, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertFeature } from '@/lib/platform'
import { dateRangeError } from '@/lib/validation'
import { buildInvoiceVoucher, buildPaymentVoucher, getCompany, vouchersToXml, type TallyVoucher } from '@/lib/tally'

/**
 * GET /api/tally/bulk?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   &sales=1&purchase=1&payments=1 (all default on; 0 disables)
 * One combined Import-Data envelope with every non-cancelled voucher in range.
 */
export async function GET(req: Request) {
  try {
    const actor = await assertCompanyAccess()
    await assertFeature('exportData')
    const sp = new URL(req.url).searchParams
    const company = await getCompany()
    if (!company) return NextResponse.json({ success: false, error: 'Company not set up' }, { status: 400 })

    const from = sp.get('from')
    const to = sp.get('to')
    const rangeErr = dateRangeError(from, to)
    if (rangeErr) return fail(rangeErr)
    // Dates are stored at UTC midnight — UTC-bounded range (see reports.ts).
    const dateRange: { gte?: Date; lte?: Date } = {}
    if (from) dateRange.gte = new Date(`${from}T00:00:00.000Z`)
    if (to) dateRange.lte = new Date(`${to}T23:59:59.999Z`)

    const wantSales = sp.get('sales') !== '0'
    const wantPurchase = sp.get('purchase') !== '0'
    const wantPayments = sp.get('payments') !== '0'

    const vouchers: TallyVoucher[] = []

    if (wantSales) {
      const rows = await db.salesInvoice.findMany({
        where: { status: 'POSTED', ...(from || to ? { date: dateRange } : {}) },
        orderBy: [{ date: 'asc' }, { invoiceNo: 'asc' }],
        include: {
          party: { select: { code: true, name: true, gstin: true } },
          // isService MUST be selected: buildInvoiceVoucher routes service
          // lines to the sales ledger — without it jobwork invoices export as
          // fake inventory lines (qty × rate stock movement).
          items: { include: { item: { select: { code: true, name: true, hsn: true, uom: true, isService: true } } } },
        },
      })
      for (const inv of rows) vouchers.push(buildInvoiceVoucher(inv, company, 'SALES'))
    }

    if (wantPurchase) {
      const rows = await db.purchaseInvoice.findMany({
        where: { status: 'POSTED', ...(from || to ? { date: dateRange } : {}) },
        orderBy: [{ date: 'asc' }, { invoiceNo: 'asc' }],
        include: {
          party: { select: { code: true, name: true, gstin: true } },
          items: { include: { item: { select: { code: true, name: true, hsn: true, uom: true, isService: true } } } },
        },
      })
      for (const inv of rows) vouchers.push(buildInvoiceVoucher(inv, company, 'PURCHASE'))
    }

    if (wantPayments) {
      const rows = await db.payment.findMany({
        where: { status: 'POSTED', ...(from || to ? { date: dateRange } : {}) },
        orderBy: [{ date: 'asc' }, { paymentNo: 'asc' }],
        include: { party: { select: { code: true, name: true } } },
      })
      for (const p of rows) vouchers.push(buildPaymentVoucher(p, company))
    }

    if (vouchers.length === 0) {
      return NextResponse.json({ success: false, error: 'No documents in the selected range' }, { status: 404 })
    }

    const xml = vouchersToXml(vouchers, company.tallyCompanyName ?? null)
    await logAudit('EXPORT', 'TallyBulk', undefined, `${vouchers.length} vouchers (${from ?? 'begin'} → ${to ?? 'now'})`, actor?.email)
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="forge-tally-bulk-${stamp}.xml"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
