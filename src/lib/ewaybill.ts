import { buildEInvoice, loadSalesInvoiceForIrp } from './einvoice'
import { r2 } from './erp'

export interface EWayBillTransport {
  distance: number
  mode: '1' | '2' | '3' | '4'
  transporterId?: string
  transporterName?: string
  vehicleNo?: string
  vehicleType?: 'R' | 'O'
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const VEHICLE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/

function portalDate(value: Date): string {
  const date = new Date(value)
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`
}

export async function buildEWayBill(invoiceId: string, transport: EWayBillTransport) {
  const { inv, company } = await loadSalesInvoiceForIrp(invoiceId)
  const irp = buildEInvoice(inv, company)
  const errors = [...irp.errors]
  const warnings = [...irp.warnings]
  const vehicleNo = (transport.vehicleNo ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  const transporterId = (transport.transporterId ?? '').trim().toUpperCase()

  if (inv.status !== 'POSTED') errors.push('Only posted sales invoices can be exported for e-Way Bill')
  if (!Number.isInteger(transport.distance) || transport.distance < 1 || transport.distance > 4000) {
    errors.push('Transport distance must be a whole number from 1 to 4000 km')
  }
  if (!['1', '2', '3', '4'].includes(transport.mode)) errors.push('Transport mode must be Road, Rail, Air or Ship')
  if (transporterId && !GSTIN_RE.test(transporterId)) errors.push('Transporter ID must be a valid GSTIN')
  if (transport.mode === '1' && !transporterId && !vehicleNo) errors.push('Road transport requires either transporter GSTIN or vehicle number')
  if (vehicleNo && !VEHICLE_RE.test(vehicleNo)) errors.push('Vehicle number format is invalid')
  if (inv.grandTotal < 50000) warnings.push('Invoice value is below Rs 50,000; verify whether an e-Way Bill is legally required')

  const itemList = (inv.items ?? []).map((line) => ({
    productName: line.item?.name ?? line.detail ?? 'Item',
    productDesc: line.detail ?? line.item?.name ?? 'Item',
    hsnCode: Number(line.hsn ?? line.item?.hsn ?? 0),
    quantity: Math.round(line.qty * 1000) / 1000,
    qtyUnit: line.uom,
    taxableAmount: r2(line.taxable),
    sgstRate: inv.interState ? 0 : line.gstRate / 2,
    cgstRate: inv.interState ? 0 : line.gstRate / 2,
    igstRate: inv.interState ? line.gstRate : 0,
    cessRate: 0,
  }))

  const json = {
    supplyType: 'O',
    subSupplyType: '1',
    subSupplyDesc: 'Supply',
    docType: 'INV',
    docNo: inv.invoiceNo,
    docDate: portalDate(inv.date),
    fromGstin: irp.json.SellerDtls.Gstin,
    fromTrdName: irp.json.SellerDtls.TrdNm,
    fromAddr1: irp.json.SellerDtls.Addr1,
    fromPlace: irp.json.SellerDtls.Loc,
    fromPincode: irp.json.SellerDtls.Pin,
    actFromStateCode: Number(irp.json.SellerDtls.Stcd),
    fromStateCode: Number(irp.json.SellerDtls.Stcd),
    toGstin: irp.json.BuyerDtls.Gstin,
    toTrdName: irp.json.BuyerDtls.LglNm,
    toAddr1: irp.json.BuyerDtls.Addr1,
    toPlace: irp.json.BuyerDtls.Loc,
    toPincode: irp.json.BuyerDtls.Pin,
    actToStateCode: Number(irp.json.BuyerDtls.Stcd),
    toStateCode: Number(irp.json.BuyerDtls.Stcd),
    transactionType: 1,
    totalValue: r2(inv.taxable),
    cgstValue: r2(inv.cgst),
    sgstValue: r2(inv.sgst),
    igstValue: r2(inv.igst),
    cessValue: 0,
    totInvValue: r2(inv.grandTotal),
    transMode: transport.mode,
    transDistance: String(transport.distance),
    transporterId,
    transporterName: transport.transporterName?.trim() ?? '',
    vehicleNo,
    vehicleType: transport.vehicleType ?? 'R',
    itemList,
  }

  return { inv, json, errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}

export function eWayBillFileName(invoiceNo: string): string {
  return `${invoiceNo.replace(/[\\/:*?"<>|]/g, '-')}_ewaybill.json`
}
