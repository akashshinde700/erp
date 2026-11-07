import { NextResponse } from 'next/server'
import { handleError, ok, fail } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertFeature } from '@/lib/platform'
import { buildEWayBill, eWayBillFileName, type EWayBillTransport } from '@/lib/ewaybill'

/** Builds NIC-compatible e-Way Bill bulk-upload JSON; it does not call or impersonate the NIC API. */
export async function GET(req: Request) {
  try {
    const actor = await assertCompanyAccess()
    await assertFeature('exportData')
    const sp = new URL(req.url).searchParams
    const id = sp.get('id') ?? ''
    if (!id) return fail('id is required')
    const distance = Number(sp.get('distance'))
    const mode = (sp.get('mode') ?? '1') as EWayBillTransport['mode']
    const built = await buildEWayBill(id, {
      distance,
      mode,
      transporterId: sp.get('transporterId') ?? undefined,
      transporterName: sp.get('transporterName') ?? undefined,
      vehicleNo: sp.get('vehicleNo') ?? undefined,
      vehicleType: sp.get('vehicleType') === 'O' ? 'O' : 'R',
    })
    if (sp.get('preview') === '1') {
      return ok({
        valid: built.errors.length === 0,
        docNo: built.inv.invoiceNo,
        errors: built.errors,
        warnings: built.warnings,
        itemCount: built.json.itemList.length,
        totalValue: built.json.totInvValue,
      })
    }
    if (built.errors.length) {
      return NextResponse.json({ success: false, error: `${built.inv.invoiceNo} failed e-Way Bill pre-validation`, errors: built.errors }, { status: 409 })
    }
    await logAudit('EXPORT', 'EWayBill', id, `${built.inv.invoiceNo} — e-Way Bill JSON (${built.json.transDistance} km, ${built.json.vehicleNo || built.json.transporterId})`, actor?.email)
    return new NextResponse(JSON.stringify(built.json, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${eWayBillFileName(built.inv.invoiceNo)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return handleError(error)
  }
}
