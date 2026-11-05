import { NextResponse } from 'next/server'
import { handleError, ok } from '@/lib/api'
import { db } from '@/lib/db'
import { z } from 'zod'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertMutationAccess, assertFeature } from '@/lib/platform'
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
 * Pure download/preview — NO writes. Export stamps are set by the explicit
 * POST action (GET stays safe for link navigation / sameSite=lax).
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    await assertFeature('exportData')
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
      return new NextResponse(JSON.stringify(voucher, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${tallyFileName(voucher.voucherNumber, 'json')}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const company = await getCompany()
    const body = format === 'csv' ? voucherToCsv(voucher) : vouchersToXml([voucher], company?.tallyCompanyName ?? null)
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

const actionSchema = z.object({
  doc: z.enum(['SALES', 'PURCHASE', 'PAYMENT']),
  id: z.string().min(1),
  action: z.enum(['mark-sent', 'unmark', 'mark-exported']),
})

/** POST /api/tally/voucher {doc, id, action} — explicit Tally stamp actions. */
export async function POST(req: Request) {
  try {
    await assertMutationAccess()
    await assertFeature('exportData')
    const body = actionSchema.parse(await req.json())
    const { doc, id, action } = body
    if (doc === 'PAYMENT') return ok({ stamp: null })

    const now = new Date()
    if (action === 'mark-sent') {
      if (doc === 'SALES') await db.salesInvoice.update({ where: { id }, data: { tallySentAt: now } })
      else await db.purchaseInvoice.update({ where: { id }, data: { tallySentAt: now } })
    } else if (action === 'unmark') {
      if (doc === 'SALES') await db.salesInvoice.update({ where: { id }, data: { tallySentAt: null } })
      else await db.purchaseInvoice.update({ where: { id }, data: { tallySentAt: null } })
    } else {
      // mark-exported: only when not already sent to Tally
      if (doc === 'SALES') await db.salesInvoice.updateMany({ where: { id, tallySentAt: null }, data: { tallyExportedAt: now } })
      else await db.purchaseInvoice.updateMany({ where: { id, tallySentAt: null }, data: { tallyExportedAt: now } })
    }
    await logAudit(action === 'mark-sent' ? 'EXPORT' : 'UPDATE', `Tally:${doc}`, id, action)
    return ok({ stamp: action === 'unmark' ? null : now })
  } catch (e) {
    return handleError(e)
  }
}
