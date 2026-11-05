/**
 * ForgeERP — Pure ERP engine (GST + numbering + formatting).
 * Shared by client UI (live preview) and server posting services.
 * Rules distilled from reference analysis (see docs/REVERSE_ENGINEERING_SUMMARY.md §3.3):
 *  - inclusive/exclusive taxes solved exactly: taxable = afterDisc / (1 + rate/100)
 *  - place-of-supply (PoS) vs company state code decides IGST vs CGST+SGST (codes, never names)
 *  - UT codes → CGST + UTGST (bucketed as SGST)
 *  - odd-paisa CGST/SGST halving via 1e-7 nudge so halves always re-sum to the tax
 *  - grand total rounded to whole rupee, difference captured in roundOff
 *  - offline GSTIN mod-36 checksum
 * No imports, no side effects — safe on client and server.
 */

export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export const EPS = 1e-9

// ---------- Indian GST state codes ----------

export interface StateInfo { code: string; name: string; ut: boolean }

export const INDIAN_STATES: StateInfo[] = [
  { code: '01', name: 'Jammu & Kashmir', ut: true },
  { code: '02', name: 'Himachal Pradesh', ut: false },
  { code: '03', name: 'Punjab', ut: false },
  { code: '04', name: 'Chandigarh', ut: true },
  { code: '05', name: 'Uttarakhand', ut: false },
  { code: '06', name: 'Haryana', ut: false },
  { code: '07', name: 'Delhi', ut: true },
  { code: '08', name: 'Rajasthan', ut: false },
  { code: '09', name: 'Uttar Pradesh', ut: false },
  { code: '10', name: 'Bihar', ut: false },
  { code: '11', name: 'Sikkim', ut: false },
  { code: '12', name: 'Arunachal Pradesh', ut: false },
  { code: '13', name: 'Nagaland', ut: false },
  { code: '14', name: 'Manipur', ut: false },
  { code: '15', name: 'Mizoram', ut: false },
  { code: '16', name: 'Tripura', ut: false },
  { code: '17', name: 'Meghalaya', ut: false },
  { code: '18', name: 'Assam', ut: false },
  { code: '19', name: 'West Bengal', ut: false },
  { code: '20', name: 'Jharkhand', ut: false },
  { code: '21', name: 'Odisha', ut: false },
  { code: '22', name: 'Chhattisgarh', ut: false },
  { code: '23', name: 'Madhya Pradesh', ut: false },
  { code: '24', name: 'Gujarat', ut: false },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu', ut: true },
  { code: '27', name: 'Maharashtra', ut: false },
  { code: '29', name: 'Karnataka', ut: false },
  { code: '30', name: 'Goa', ut: false },
  { code: '31', name: 'Lakshadweep', ut: true },
  { code: '32', name: 'Kerala', ut: false },
  { code: '33', name: 'Tamil Nadu', ut: false },
  { code: '34', name: 'Puducherry', ut: true },
  { code: '35', name: 'Andaman & Nicobar Islands', ut: true },
  { code: '36', name: 'Telangana', ut: false },
  { code: '37', name: 'Andhra Pradesh', ut: false },
  { code: '38', name: 'Ladakh', ut: true },
]

export const stateName = (code: string): string =>
  INDIAN_STATES.find((s) => s.code === code)?.name ?? code

export const isUT = (code: string): boolean =>
  INDIAN_STATES.find((s) => s.code === code)?.ut ?? false

// ---------- GSTIN (offline mod-36 checksum, gst-billing pattern) ----------

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/

export function gstinCheckDigit(first14: string): string {
  let sum = 0
  let factor = 2
  for (let i = 13; i >= 0; i--) {
    const v = GSTIN_CHARS.indexOf(first14[i].toUpperCase())
    if (v < 0) throw new Error(`Invalid GSTIN character: ${first14[i]}`)
    const digit = v * factor
    sum += Math.floor(digit / 36) + (digit % 36)
    factor = factor === 2 ? 1 : 2
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]
}

export function gstinChecksumValid(gstin: string): boolean {
  const g = (gstin || '').toUpperCase().trim()
  if (!GSTIN_RE.test(g) || g.length !== 15) return false
  try {
    return gstinCheckDigit(g.slice(0, 14)) === g[14]
  } catch {
    return false
  }
}

/** Build a checksum-valid GSTIN: stateCode (2) + base (12, ends with Z) + check digit. */
export function makeGstin(stateCode: string, base: string): string {
  const first14 = stateCode + base.toUpperCase()
  return first14 + gstinCheckDigit(first14)
}

export const stateFromGstin = (gstin: string): string => (gstin || '').slice(0, 2)

// ---------- Financial year (Apr–Mar, Indian) ----------

/** '2025-11-20' → '2526' (FY 2025-26). Month ≥ 4 belongs to next FY. */
export function fyCode(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const start = m >= 4 ? y : y - 1
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`
}

// ---------- Invoice tax engine ----------

export interface TaxLineInput {
  qty: number
  rate: number
  discPct?: number
  gstRate: number
}

export interface TaxLineResult {
  gross: number
  discAmt: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
}

export interface InvoiceTotals {
  lines: TaxLineResult[]
  taxable: number
  discount: number
  cgst: number
  sgst: number
  igst: number
  roundOff: number
  grandTotal: number
}

/**
 * The single source of truth for GST computation.
 * interState: true → IGST; false → CGST + SGST (UTGST bucketed as SGST).
 * taxInclusive: true → tax back-solved out of the gross amount.
 */
export function computeInvoiceTotals(
  lines: TaxLineInput[],
  opts: { taxInclusive: boolean; interState: boolean }
): InvoiceTotals {
  const out: TaxLineResult[] = []
  let taxable = 0
  let discount = 0
  let cgst = 0
  let sgst = 0
  let igst = 0

  for (const l of lines) {
    const gross = r2(l.qty * l.rate)
    const discAmt = r2(gross * ((l.discPct ?? 0) / 100))
    const afterDisc = r2(gross - discAmt)
    let lineTaxable: number
    if (opts.taxInclusive && l.gstRate > 0) {
      lineTaxable = r2(afterDisc / (1 + l.gstRate / 100))
    } else {
      lineTaxable = afterDisc
    }
    const tax = r2((lineTaxable * l.gstRate) / 100)
    let lc = 0
    let ls = 0
    let li = 0
    if (opts.interState) {
      li = tax
    } else {
      // odd-paisa halving: nudge then derive the second half so lc+ls === tax exactly
      lc = Math.round(lineTaxable * (l.gstRate / 200) * 100 + 1e-7) / 100
      ls = r2(tax - lc)
    }
    out.push({ gross, discAmt, taxable: lineTaxable, cgst: lc, sgst: ls, igst: li, total: r2(lineTaxable + lc + ls + li) })
    taxable = r2(taxable + lineTaxable)
    discount = r2(discount + discAmt)
    cgst = r2(cgst + lc)
    sgst = r2(sgst + ls)
    igst = r2(igst + li)
  }

  const raw = r2(taxable + cgst + sgst + igst)
  const grand = Math.round(raw) // whole-rupee rounding (Indian practice)
  const roundOff = r2(grand - raw)
  return { lines: out, taxable, discount, cgst, sgst, igst, roundOff, grandTotal: grand }
}

// ---------- Formatting ----------

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return TENS[t] + (o ? ' ' + ONES[o] : '')
}

/** Indian system: crore / lakh / thousand. 12345678 → 'One Crore Twenty Three Lakh ...' */
export function numberToWords(num: number): string {
  const n = Math.floor(Math.abs(num))
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 1e7)
  const lakh = Math.floor((n % 1e7) / 1e5)
  const thousand = Math.floor((n % 1e5) / 1e3)
  const hundred = Math.floor((n % 1e3) / 100)
  const rest = n % 100
  if (crore) parts.push(`${numberToWords(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (hundred) parts.push(`${ONES[hundred]} Hundred`)
  if (rest) parts.push(twoDigits(rest))
  return parts.join(' ')
}

export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount))
  const paise = Math.round((Math.abs(amount) - rupees) * 100)
  const prefix = amount < 0 ? 'Minus ' : ''
  let s = `${prefix}Rupees ${numberToWords(rupees)}`
  if (paise > 0) s += ` and ${twoDigits(paise)} Paise`
  return `${s} Only`
}

export const money = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)

export const qty = (n: number): string =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(n ?? 0)

export const dateStr = (d: Date | string): string => {
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ---------- Status colors (shared by all list views) ----------

export const STATUS_COLORS: Record<string, string> = {
  POSTED: 'default',
  CANCELLED: 'destructive',
  OPEN: 'secondary',
  IN_PROGRESS: 'default',
  COMPLETED: 'default',
  INVOICED: 'default',
  ISSUED: 'default',
  COMPLETED_CARD: 'default',
}

export const UOMS = ['PCS', 'KG', 'MTR', 'LTR', 'BOX'] as const
export const PAYMENT_MODES = ['CASH', 'BANK', 'UPI', 'CHEQUE'] as const
export const PARTY_TYPES = ['CUSTOMER', 'SUPPLIER', 'JOBWORKER'] as const
