import { NextResponse } from 'next/server'
import { handleError, ok } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertFeature } from '@/lib/platform'
import {
  buildEInvoice,
  eInvoiceFileName,
  loadSalesInvoiceForIrp,
  loadSalesInvoicesForIrp,
  type EInvoiceJson,
} from '@/lib/einvoice'

/**
 * e-Invoice IRP JSON v1.1 (GST portal upload):
 *   GET /api/e-invoice?id=<salesInvoiceId>          → single-invoice JSON file
 *   GET /api/e-invoice?id=<id>&preview=1            → {valid, errors, warnings, …}
 *   GET /api/e-invoice?from=YYYY-MM-DD&to=YYYY-MM-DD → bulk {Version,BulkInvList} file
 *       (&preview=1 → {total, eligible, skipped:[{docNo, errors}]} — hard errors are
 *       excluded from the file so the portal never sees a broken document)
 *
 * e-Invoice applies to outward (sales) supplies only.
 */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    await assertFeature('exportData')
    const sp = new URL(req.url).searchParams
    const id = sp.get('id') ?? ''
    const from = sp.get('from') ?? ''
    const to = sp.get('to') ?? ''
    const preview = sp.get('preview') === '1'

    if (id) {
      const { inv, company } = await loadSalesInvoiceForIrp(id)
      const built = buildEInvoice(inv, company)
      if (preview) {
        return ok({
          valid: built.errors.length === 0,
          docNo: inv.invoiceNo,
          errors: built.errors,
          warnings: built.warnings,
          supTyp: built.json.TranDtls.SupTyp,
          itemCount: built.json.ItemList.length,
          totInvVal: built.json.ValDtls.TotInvVal,
        })
      }
      if (built.errors.length > 0) {
        return NextResponse.json(
          { success: false, error: `${inv.invoiceNo} failed e-Invoice pre-validation`, errors: built.errors },
          { status: 409 },
        )
      }
      await logAudit('EXPORT', 'EInvoice', id, `${inv.invoiceNo} — IRP JSON v1.1 (₹${built.json.ValDtls.TotInvVal.toFixed(2)}, ${built.json.ItemList.length} items)`)
      return new NextResponse(JSON.stringify(built.json, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${eInvoiceFileName(inv.invoiceNo)}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    if (!from && !to) return NextResponse.json({ success: false, error: 'Provide id, or a from/to date range' }, { status: 400 })

    const { invs, company } = await loadSalesInvoicesForIrp(from || undefined, to || undefined)
    const built = invs.map((inv) => ({ inv, built: buildEInvoice(inv, company) }))
    const eligible = built.filter((b) => b.built.errors.length === 0)
    const skipped = built
      .filter((b) => b.built.errors.length > 0)
      .map((b) => ({ docNo: b.inv.invoiceNo, errors: b.built.errors }))

    if (preview) {
      return ok({
        total: built.length,
        eligible: eligible.length,
        skipped,
        value: eligible.reduce((s, b) => s + b.built.json.ValDtls.TotInvVal, 0),
      })
    }
    if (eligible.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No invoice in this range passed e-Invoice pre-validation', skipped },
        { status: 409 },
      )
    }

    const body = JSON.stringify(
      { Version: '1.1', BulkInvList: eligible.map((b) => b.built.json as EInvoiceJson) },
      null,
      2,
    )
    await logAudit('EXPORT', 'EInvoice', undefined, `Bulk IRP JSON ${from || '…'}→${to || '…'} — ${eligible.length} invoices (skipped ${skipped.length})`)
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="forge-einvoice_${from || 'all'}_${to || 'all'}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
