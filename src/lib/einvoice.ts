/**
 * ForgeERP — e-Invoice IRP JSON v1.1 generator (NIC schema, as used by
 * einvoice.gst.gov.in / the GST portal's "Generate e-Invoice" upload).
 *
 * Pattern learned from the erpnashilk audit (A4: "e-Invoice IRP bulk-upload
 * JSON v1.1 + pre-validation") — the repo is unlicensed, so this is our own
 * implementation of the published IRP specification:
 *   https://einvoice1.gst.gov.in/doc/einvoice-json-schema-v1.1/
 *
 * Facts honoured:
 *  - Only outward B2B supplies qualify; the buyer GSTIN is mandatory.
 *  - Amounts max 2 decimals, qty max 3 decimals, Pin is a 6-digit integer.
 *  - HSN/SAC mandatory per item (min 6 digits), UQC unit codes.
 *  - ValDtls must add up: TotInvVal = AssVal + CgstVal + SgstVal + IgstVal + RndOff.
 *  - TotItemVal = AssAmt + CgstAmt + SgstAmt + IgstAmt per line.
 *  - TotAmt = Qty × UnitPrice (before line discount), AssAmt is after it.
 *  - IRN must be requested within 30 days of the invoice date (Notification
 *    76/2023) — older invoices get a warning, not a block.
 *
 * Pre-validation splits issues into `errors` (portal will reject) and
 * `warnings` (legal but worth knowing). Hard errors block the download with
 * a 409 so nobody ships a broken file to the IRP.
 */

import { db } from './db'
import { r2 } from './erp'

// ---------- types ----------

export interface EInvoiceItem {
  SlNo: string
  PrdDesc: string
  HsnCd: string
  Qty: number
  Unit: string
  UnitPrice: number
  TotAmt: number
  AssAmt: number
  GstRt: number
  IgstAmt: number
  CgstAmt: number
  SgstAmt: number
  RoundingType: string
  TotItemVal: number
}

export interface EInvoiceJson {
  Version: string
  TranDtls: { TaxSch: string; SupTyp: string; RegRev: string }
  DocDtls: { Typ: string; No: string; Dt: string }
  SellerDtls: { Gstin: string; LglNm: string; TrdNm: string; Addr1: string; Loc: string; Pin: number; Stcd: string }
  BuyerDtls: { Gstin: string; LglNm: string; Pos: string; Addr1: string; Loc: string; Pin: number; Stcd: string }
  ItemList: EInvoiceItem[]
  ValDtls: { AssVal: number; CgstVal: number; SgstVal: number; IgstVal: number; RndOff: number; TotInvVal: number }
}

export interface EInvoiceValidation {
  errors: string[]
  warnings: string[]
}

/** UQC codes accepted by the IRP (Qty units). Anything else falls back to NOS. */
const UQC = new Set([
  'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN',
  'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR',
  'MTS', 'NOS', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQI', 'SQM', 'SQY',
  'TBS', 'TGM', 'THD', 'TNE', 'TON', 'TUB', 'UGS', 'UNT', 'YDS',
])

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/
const PIN_RE = /^[0-9]{6}$/

/** Common unit spellings normalised to the IRP's UQC codes before the set check. */
const UQC_SYNONYMS: Record<string, string> = {
  KG: 'KGS', KGS: 'KGS', KILO: 'KGS', KGRAM: 'KGS',
  PC: 'PCS', PIECE: 'PCS', PCS: 'PCS', EA: 'NOS', EACH: 'NOS', NOS: 'NOS', NUM: 'NOS',
  GM: 'GMS', GMS: 'GMS', GRAM: 'GMS',
  L: 'LTR', LTR: 'LTR', LITRE: 'LTR',
  ML: 'MLT', MLT: 'MLT',
  M: 'MTR', MTR: 'MTR', MTRS: 'MTR',
  SQF: 'SQF', SQFT: 'SQF',
  ROLL: 'ROL', ROL: 'ROL',
  DOZEN: 'DOZ',
  TON: 'TON', MT: 'TON',
}

function ddmmyyyy(d: Date): string {
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return ''
  return `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')}/${t.getUTCFullYear()}`
}

function isoYmd(d: Date): string {
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return ''
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/** ASCII-clean, length-capped description for the IRP (portal is strict). */
function irpText(s: unknown, max = 300): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/₹/g, 'Rs.')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

// ---------- row shapes (from Prisma includes) ----------

type IrpCompany = {
  name: string
  legalName: string | null
  gstin: string | null
  stateCode: string
  address: string | null
  city: string | null
  pincode: string | null
}

type IrpParty = {
  name: string
  code: string
  gstin: string | null
  stateCode: string
  address: string | null
  city: string | null
  pincode: string | null
}

export type IrpInvoiceRow = {
  id: string
  invoiceNo: string
  date: Date
  pos: string
  interState: boolean
  taxable: number
  cgst: number
  sgst: number
  igst: number
  roundOff: number
  grandTotal: number
  status: string
  party?: IrpParty | null
  items?: {
    detail: string | null
    hsn: string | null
    uom: string
    qty: number
    rate: number
    discAmt: number
    taxable: number
    gstRate: number
    cgst: number
    sgst: number
    igst: number
    item?: { code: string; name: string; hsn: string | null; uom: string; isService: boolean } | null
  }[]
}

// ---------- builder + pre-validation ----------

export interface BuiltEInvoice {
  json: EInvoiceJson
  errors: string[]
  warnings: string[]
}

export function buildEInvoice(inv: IrpInvoiceRow, company: IrpCompany): BuiltEInvoice {
  const errors: string[] = []
  const warnings: string[] = []

  if (inv.status === 'CANCELLED') errors.push('Invoice is cancelled — e-Invoice generation is blocked')

  const dt = ddmmyyyy(inv.date)
  if (!dt) errors.push('Invoice has an unusable date')
  else {
    const today = new Date()
    if (isoYmd(inv.date) > isoYmd(today)) errors.push('Invoice date is in the future — IRP rejects future-dated documents')
    else if (isoYmd(inv.date) < isoYmd(new Date(today.getTime() - 30 * 864e5))) {
      warnings.push('Invoice is older than 30 days — IRN must normally be requested within 30 days of the invoice date (Notification 76/2023)')
    }
  }

  // ----- seller -----
  const sellerGstin = (company.gstin ?? '').trim().toUpperCase()
  if (!sellerGstin) errors.push('Company GSTIN is missing — set it in Company profile (SellerDtls.Gstin is mandatory)')
  else if (!GSTIN_RE.test(sellerGstin)) errors.push(`Company GSTIN "${sellerGstin}" is not in the 15-character GSTIN format`)
  const sellerPin = (company.pincode ?? '').trim()
  if (!PIN_RE.test(sellerPin)) errors.push('Company pincode is missing or not 6 digits — SellerDtls.Pin is mandatory')

  // ----- buyer -----
  const party = inv.party
  const buyerGstin = (party?.gstin ?? '').trim().toUpperCase()
  if (!party) errors.push('Invoice has no party — cannot build BuyerDtls')
  else {
    if (!buyerGstin) errors.push(`${party.name} has no GSTIN — B2C/unregistered supplies are not eligible for e-Invoice (IRP is B2B-only)`)
    else if (!GSTIN_RE.test(buyerGstin)) errors.push(`Buyer GSTIN "${buyerGstin}" is not in the 15-character GSTIN format`)
    if (party.stateCode && !/^\d{2}$/.test(party.stateCode)) errors.push(`Buyer state code "${party.stateCode}" is invalid (expect 2 digits)`)
    if (!PIN_RE.test((party.pincode ?? '').trim())) errors.push(`${party.name} has no 6-digit pincode — add it on the party (BuyerDtls.Pin is mandatory)`)
    if (buyerGstin && sellerGstin && buyerGstin.slice(0, 2) !== sellerGstin.slice(0, 2) && !inv.interState) {
      warnings.push('Buyer is in a different state but the invoice is intra-state (CGST+SGST) — verify place of supply')
    }
    if (buyerGstin && sellerGstin && buyerGstin.slice(0, 2) === sellerGstin.slice(0, 2) && inv.interState) {
      warnings.push('Buyer GSTIN is from the same state but the invoice charges IGST — verify place of supply')
    }
  }
  if (inv.pos && !/^\d{2}$/.test(inv.pos)) errors.push(`Place of supply "${inv.pos}" is invalid (expect 2-digit state code)`)

  // ----- items -----
  const items = inv.items ?? []
  if (items.length === 0) errors.push('Invoice has no line items')
  const itemList: EInvoiceItem[] = []
  items.forEach((l, i) => {
    const name = irpText(l.item?.name ?? l.detail ?? `Line ${i + 1}`, 140) || `Line ${i + 1}`
    const hsn = (l.hsn ?? l.item?.hsn ?? '').toString().trim()
    if (!hsn) errors.push(`"${name}" has no HSN/SAC code — mandatory on every e-Invoice item`)
    else if (!/^\d{6}$|^\d{8}$/.test(hsn)) errors.push(`"${name}" HSN "${hsn}" must be 6 or 8 digits`)
    let unit = (l.uom || l.item?.uom || 'NOS').toString().toUpperCase().slice(0, 3)
    unit = UQC_SYNONYMS[unit] ?? unit
    if (!UQC.has(unit)) {
      warnings.push(`"${name}" unit "${unit}" is not an IRP UQC code — exported as NOS`)
      unit = 'NOS'
    }
    const qty = Math.round(l.qty * 1000) / 1000
    const unitPrice = r2(l.rate)
    const totAmt = r2(l.rate * l.qty)
    const assAmt = r2(l.taxable)
    const cgst = r2(l.cgst)
    const sgst = r2(l.sgst)
    const igst = r2(l.igst)
    itemList.push({
      SlNo: String(i + 1),
      PrdDesc: name,
      HsnCd: hsn,
      Qty: qty,
      Unit: unit,
      UnitPrice: unitPrice,
      TotAmt: totAmt,
      AssAmt: assAmt,
      GstRt: Math.round(l.gstRate * 100) / 100,
      IgstAmt: igst,
      CgstAmt: cgst,
      SgstAmt: sgst,
      RoundingType: '',
      TotItemVal: r2(assAmt + cgst + sgst + igst),
    })
    if (l.gstRate === 0) warnings.push(`"${name}" is zero-rated — accepted only for exempt/nil-rate supplies`)
  })

  // ----- totals -----
  const assVal = r2(inv.taxable)
  const valDtls = {
    AssVal: assVal,
    CgstVal: r2(inv.cgst),
    SgstVal: r2(inv.sgst),
    IgstVal: r2(inv.igst),
    RndOff: r2(inv.roundOff),
    TotInvVal: r2(inv.grandTotal),
  }
  const sumItems = r2(itemList.reduce((s, x) => s + x.AssAmt, 0))
  if (Math.abs(sumItems - assVal) >= 0.01) errors.push(`Line assessable values (Rs ${sumItems.toFixed(2)}) do not match the invoice total (Rs ${assVal.toFixed(2)})`)
  const sumTax = r2(itemList.reduce((s, x) => s + x.CgstAmt + x.SgstAmt + x.IgstAmt, 0))
  if (Math.abs(sumTax - r2(inv.cgst + inv.sgst + inv.igst)) >= 0.01) {
    errors.push('Line tax amounts do not match the invoice tax totals')
  }
  const computedTotal = r2(valDtls.AssVal + valDtls.CgstVal + valDtls.SgstVal + valDtls.IgstVal + valDtls.RndOff)
  if (Math.abs(computedTotal - valDtls.TotInvVal) >= 0.01) {
    errors.push(`ValDtls do not add up: components Rs ${computedTotal.toFixed(2)} vs TotInvVal Rs ${valDtls.TotInvVal.toFixed(2)}`)
  }
  if (Math.abs(valDtls.RndOff) >= 0.01) warnings.push(`Round-off Rs ${valDtls.RndOff.toFixed(2)} is included (TotInvVal stays exact)`)

  const legalName = irpText(company.legalName || company.name, 100) || 'Seller'
  const tradeName = irpText(company.name, 100) || legalName
  const buyerLegal = irpText(party?.name, 100) || 'Buyer'
  const buyerStcd = /^\d{2}$/.test(party?.stateCode ?? '') ? (party?.stateCode as string) : inv.pos
  const pos = /^\d{2}$/.test(inv.pos) ? inv.pos : buyerStcd

  const json: EInvoiceJson = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N' },
    DocDtls: { Typ: 'INV', No: irpText(inv.invoiceNo, 16), Dt: dt },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: legalName,
      TrdNm: tradeName,
      Addr1: irpText(company.address, 100),
      Loc: irpText(company.city, 50),
      Pin: PIN_RE.test(sellerPin) ? Number(sellerPin) : 0,
      Stcd: company.stateCode,
    },
    BuyerDtls: {
      Gstin: buyerGstin,
      LglNm: buyerLegal,
      Pos: pos,
      Addr1: irpText(party?.address, 100),
      Loc: irpText(party?.city, 50),
      Pin: PIN_RE.test((party?.pincode ?? '').trim()) ? Number((party?.pincode as string).trim()) : 0,
      Stcd: buyerStcd,
    },
    ItemList: itemList,
    ValDtls: valDtls,
  }

  return { json, errors, warnings }
}

// ---------- data loading + file name ----------

export async function loadSalesInvoiceForIrp(id: string): Promise<{ inv: IrpInvoiceRow; company: IrpCompany }> {
  const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!company) throw new Error('Company not set up')
  const inv = await db.salesInvoice.findUnique({
    where: { id },
    include: {
      party: { select: { code: true, name: true, gstin: true, stateCode: true, address: true, city: true, pincode: true } },
      items: { include: { item: { select: { code: true, name: true, hsn: true, uom: true, isService: true } } } },
    },
  })
  if (!inv) throw new Error('Sales invoice not found')
  return { inv: inv as unknown as IrpInvoiceRow, company: company as unknown as IrpCompany }
}

export async function loadSalesInvoicesForIrp(from?: string, to?: string): Promise<{ invs: IrpInvoiceRow[]; company: IrpCompany }> {
  const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!company) throw new Error('Company not set up')
  const where: { date?: { gte?: Date; lte?: Date } } = {}
  if (from || to) {
    where.date = {}
    if (from) where.date.gte = new Date(`${from}T00:00:00.000Z`)
    if (to) where.date.lte = new Date(`${to}T23:59:59.999Z`)
  }
  const invs = await db.salesInvoice.findMany({
    where,
    orderBy: { date: 'asc' },
    include: {
      party: { select: { code: true, name: true, gstin: true, stateCode: true, address: true, city: true, pincode: true } },
      items: { include: { item: { select: { code: true, name: true, hsn: true, uom: true, isService: true } } } },
    },
  })
  return { invs: invs as unknown as IrpInvoiceRow[], company: company as unknown as IrpCompany }
}

/** Safe download filename from an invoice number. */
export function eInvoiceFileName(invoiceNo: string): string {
  return `${invoiceNo.replace(/[\\/:*?"<>|]/g, '-')}_einvoice.json`
}
