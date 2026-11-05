import { NextResponse } from 'next/server'
import { handleError, ok } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  getCompany,
  loadInvoiceVoucher,
  loadPaymentVoucher,
  tallyFileName,
  voucherToCsv,
  vouchersToXml,
  type TallyDocKind,
} from '@/lib/tally'

/**
 * GET /api/tally/voucher?doc=SALES|PURCHASE|PAYMENT&id=<id>
 *   &format=xml|json|csv (default xml) · &preview=1 → {voucher, warnings}
 */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams
    const doc = (sp.get('doc') ?? 'SALES').toUpperCase() as TallyDocKind
    const id = sp.get('id') ?? ''
    const format = (sp.get('format') ?? 'xml').toLowerCase()
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const voucher =
      doc === 'SALES'
        ? await loadInvoiceVoucher('SALES', id)
        : doc === 'PURCHASE'
          ? await loadInvoiceVoucher('PURCHASE', id)
          : await loadPaymentVoucher(id)

    if (sp.get('preview') === '1') {
      return ok({ voucher, warnings: voucher.warnings })
    }

    if (format === 'json') {
      await stampExport(doc, id)
      return ok({ voucher })
    }

    const company = await getCompany()
    const body = format === 'csv' ? voucherToCsv(voucher) : vouchersToXml([voucher], company?.tallyCompanyName ?? null)
    await stampExport(doc, id)
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': `${format === 'csv' ? 'text/csv' : 'application/xml'}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="${tallyFileName(voucher.voucherNumber, format === 'csv' ? 'csv' : 'xml')}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return handleError(e)
  }
}

/** POST /api/tally/voucher {doc, id, action: 'mark-sent' | 'unmark'} — Tally sent stamps. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { doc?: string; id?: string; action?: string }
    const doc = (body.doc ?? '').toUpperCase()
    const id = body.id ?? ''
    const action = body.action ?? ''
    if (!id || !['SALES', 'PURCHASE', 'PAYMENT'].includes(doc)) {
      return NextResponse.json({ success: false, error: 'doc and id are required' }, { status: 400 })
    }
    if (doc === 'PAYMENT') return ok({ stamp: null })
    const now = action === 'mark-sent' ? new Date() : null
    if (doc === 'SALES') {
      await db.salesInvoice.update({ where: { id }, data: { tallySentAt: now } })
    } else {
      await db.purchaseInvoice.update({ where: { id }, data: { tallySentAt: now } })
    }
    await logAudit(action === 'mark-sent' ? 'EXPORT' : 'UPDATE', `Tally:${doc}`, id, action)
    return ok({ stamp: now })
  } catch (e) {
    return handleError(e)
  }
}

async function stampExport(doc: string, id: string): Promise<void> {
  const now = new Date()
  if (doc === 'SALES') await db.salesInvoice.updateMany({ where: { id, tallySentAt: null }, data: { tallyExportedAt: now } })
  else if (doc === 'PURCHASE') await db.purchaseInvoice.updateMany({ where: { id, tallySentAt: null }, data: { tallyExportedAt: now } })
}
