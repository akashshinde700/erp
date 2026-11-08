/**
 * ForgeERP — TallyPrime export engine (patterns re-implemented from the
 * erpnashilk audit; the repo is unlicensed so this is our own code).
 *
 * One voucher model feeds XML / JSON / CSV — an accounting fix lands in all
 * three shapes. Key Tally facts honoured here:
 *  - Invoice mode uses LEDGERENTRIES.LIST + ISINVOICE=Yes (the plain
 *    ALLLEDGERENTRIES list is silently ignored in invoice mode).
 *  - Debits are NEGATIVE amounts in Tally's import format.
 *  - REMOTEID makes re-import UPDATE instead of duplicate.
 *  - Tally recomputes AMOUNT = RATE × QTY on inventory lines, so the billed
 *    amount wins and qty is back-solved when they disagree.
 *  - The importer is not a general XML parser → ASCII-only text.
 *  - A voucher must balance; a round-off residual line absorbs the difference.
 */

import { db } from './db'
import { r2 } from './erp'
import { tenantCompany } from './tenant'
import { BusinessError } from './accounting'

// ---------- types ----------

export type TallyDocKind = 'SALES' | 'PURCHASE' | 'PAYMENT'

export interface TallyLedgerNames {
  sales: string
  purchase: string
  cgst: string
  sgst: string
  igst: string
  roundOff: string
  cash: string
  bank: string
}

export interface TallyEntry {
  ledger: string
  amount: number // positive; sign expressed via isDebit
  isDebit: boolean
  isParty: boolean
  billRef?: string
}

export interface TallyItemLine {
  stockItem: string
  qty: number
  rate: number
  amount: number
  uom: string
  hsn?: string | null
  description: string
  ledger: string // accounting allocation (sales/purchase ledger)
}

export interface TallyVoucher {
  docKind: TallyDocKind
  voucherType: 'Sales' | 'Purchase' | 'Receipt' | 'Payment'
  voucherNumber: string
  remoteId: string // FORGEERP-<KIND>-<dbId> — dedupe key
  date: string // YYYYMMDD
  party: string
  narration: string
  entries: TallyEntry[]
  items: TallyItemLine[]
  totals: { taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; grandTotal: number }
  warnings: string[]
}

// ---------- text hardening (Tally importer is not a general XML parser) ----------

export function tallyText(s: unknown): string {
  if (s === null || s === undefined) return ''
  let t = String(s)
  t = t
    .replace(/₹/g, 'Rs.')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\t/g, ' ')
  t = t.replace(/[^\x20-\x7E]/g, '') // ASCII only
  t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return t.trim()
}

const amt = (n: number): string => (Math.abs(n) < 0.005 ? '0.00' : r2(n).toFixed(2))
const qty3 = (n: number): string => (Math.round(n * 1000) / 1000).toFixed(3)

// ---------- ledger-name resolution (company field → default) ----------

const DEFAULTS: TallyLedgerNames = {
  sales: 'Sales',
  purchase: 'Purchase',
  cgst: 'Central Tax on Sales @ 9%',
  sgst: 'State Tax on Sales @ 9%',
  igst: 'Integrated Tax on Sales @ 18%',
  roundOff: 'Round Off',
  cash: 'Cash',
  bank: 'Bank',
}

type TallyCompany = Pick<
  import('@prisma/client').Prisma.CompanyGetPayload<object>,
  | 'name'
  | 'gstin'
  | 'stateCode'
  | 'tallyCompanyName'
  | 'tallySalesLedger'
  | 'tallyPurchaseLedger'
  | 'tallyCgstLedger'
  | 'tallySgstLedger'
  | 'tallyIgstLedger'
  | 'tallyRoundOffLedger'
>

export function ledgerNames(company: TallyCompany): TallyLedgerNames {
  return {
    sales: company.tallySalesLedger?.trim() || DEFAULTS.sales,
    purchase: company.tallyPurchaseLedger?.trim() || DEFAULTS.purchase,
    cgst: company.tallyCgstLedger?.trim() || DEFAULTS.cgst,
    sgst: company.tallySgstLedger?.trim() || DEFAULTS.sgst,
    igst: company.tallyIgstLedger?.trim() || DEFAULTS.igst,
    roundOff: company.tallyRoundOffLedger?.trim() || DEFAULTS.roundOff,
    cash: DEFAULTS.cash,
    bank: DEFAULTS.bank,
  }
}

// ---------- voucher builders ----------

interface InvoiceRow {
  id: string
  invoiceNo: string
  date: Date
  taxable: number
  cgst: number
  sgst: number
  igst: number
  roundOff: number
  grandTotal: number
  status: string
  poNo?: string | null
  remarks?: string | null
  party?: { code: string; name: string; gstin?: string | null } | null
  items?: {
    detail?: string | null
    hsn?: string | null
    uom: string
    qty: number
    rate: number
    taxable: number
    item?: { code: string; name: string; hsn?: string | null; uom: string; isService?: boolean } | null
  }[]
}

/** Build a Sales/Purchase voucher from an invoice row (+ item masters filled). */
export function buildInvoiceVoucher(inv: InvoiceRow, company: TallyCompany, kind: 'SALES' | 'PURCHASE'): TallyVoucher {
  const L = ledgerNames(company)
  const isSales = kind === 'SALES'
  const warnings: string[] = []
  if (inv.status === 'CANCELLED') throw new BusinessError(`${inv.invoiceNo} is cancelled — export blocked`, 409)
  const date = utcYmd(inv.date)
  if (!date) throw new BusinessError(`${inv.invoiceNo} has an unusable date`, 409)

  const partyName = inv.party?.name || inv.party?.code || (isSales ? 'Customer' : 'Supplier')
  if (!inv.party?.gstin) warnings.push('Party has no GSTIN — Tally ledger will be unregistered')

  const items: TallyItemLine[] = (inv.items ?? [])
    .filter((l) => !(l.item?.isService ?? false)) // service lines ride the sales ledger, not stock
    .map((l, i) => {
      const stockItem = l.item?.name || l.item?.code || `Line ${i + 1}`
      const uom = (l.uom || l.item?.uom || 'Nos').toUpperCase()
      const amount = r2(l.taxable)
      let qty = l.qty
      let rate = r2(l.rate)
      // Tally recomputes AMOUNT = RATE × QTY — the billed amount wins;
      // back-solve qty when the numbers disagree.
      if (rate > 0 && Math.abs(rate * qty - amount) >= 0.01) qty = amount / rate
      if (!l.hsn && !l.item?.hsn) warnings.push(`"${stockItem}" has no HSN code`)
      return {
        stockItem,
        qty,
        rate,
        amount,
        uom,
        hsn: l.hsn ?? l.item?.hsn ?? null,
        description: l.item ? `${l.item.code} — ${l.item.name}` : stockItem,
        ledger: isSales ? L.sales : L.purchase,
      }
    })

  // Service lines (e.g. jobwork processes) → one sales-ledger credit per line.
  const serviceLines = (inv.items ?? []).filter((l) => l.item?.isService ?? false)
  const serviceValue = serviceLines.reduce((s, l) => s + r2(l.taxable), 0)

  // ----- ledger entries -----
  const entries: TallyEntry[] = []
  // Party: sales → debit (customer owes); purchase → credit (we owe supplier).
  entries.push({ ledger: partyName, amount: r2(inv.grandTotal), isDebit: isSales, isParty: true, billRef: inv.invoiceNo })

  const credit = (ledger: string, amount: number) => {
    if (Math.abs(amount) >= 0.005) entries.push({ ledger, amount: r2(Math.abs(amount)), isDebit: !isSales, isParty: false })
  }
  credit(L.cgst, inv.cgst)
  credit(L.sgst, inv.sgst)
  credit(L.igst, inv.igst)

  const stockValue = items.reduce((s, l) => s + l.amount, 0)
  // Ledger-mode vs invoice-mode value routing:
  //  - no stock lines (service-only, e.g. jobwork) → the whole taxable value
  //    rides the sales/purchase ledger line;
  //  - mixed invoice → stock lines carry their value in inventory entries,
  //    service lines get one sales-ledger credit.
  if (items.length === 0) credit(isSales ? L.sales : L.purchase, inv.taxable)
  else if (serviceValue > 0.004) credit(isSales ? L.sales : L.purchase, serviceValue)

  // Round-off residual: the party side carries the grand total, so the voucher
  // must absorb any difference through a Round Off ledger line. In invoice
  // mode the taxable value rides the inventory lines, so it counts towards
  // the balancing side too.
  const credited = entries.filter((e) => e.isDebit !== isSales).reduce((s, e) => s + e.amount, 0)
  const residual = r2(inv.grandTotal - (credited + stockValue))
  if (Math.abs(residual) >= 0.01) {
    entries.push({ ledger: L.roundOff, amount: Math.abs(residual), isDebit: residual < 0 ? isSales : !isSales, isParty: false })
    warnings.push(`Round-off residual ₹ ${Math.abs(residual).toFixed(2)} added to balance the voucher`)
  }

  const narrationParts = [inv.invoiceNo]
  if (inv.poNo) narrationParts.push(`PO: ${inv.poNo}`)
  if (inv.items) narrationParts.push(`Items: ${inv.items.map((l) => l.item?.name ?? 'Item').slice(0, 6).join(', ')}${inv.items.length > 6 ? '…' : ''}`)
  if (serviceLines.length) narrationParts.push(`Services: ${serviceLines.map((l) => l.detail ?? l.item?.name ?? 'Service').slice(0, 4).join('; ')}`)
  if (inv.remarks) narrationParts.push(String(inv.remarks).slice(0, 180))
  if (!isSales) warnings.push('Purchase voucher: verify GST input ledgers under Duties & Taxes in Tally')

  return {
    docKind: kind,
    voucherType: isSales ? 'Sales' : 'Purchase',
    voucherNumber: inv.invoiceNo,
    remoteId: `FORGEERP-${kind === 'SALES' ? 'SINV' : 'PINV'}-${inv.id}`,
    date,
    party: partyName,
    narration: narrationParts.join(' | '),
    entries,
    items,
    totals: {
      taxable: r2(inv.taxable),
      cgst: r2(inv.cgst),
      sgst: r2(inv.sgst),
      igst: r2(inv.igst),
      roundOff: r2(inv.roundOff),
      grandTotal: r2(inv.grandTotal),
    },
    warnings,
  }
}

/** Build a Receipt/Payment voucher from a Payment row. */
export function buildPaymentVoucher(
  p: {
    id: string
    paymentNo: string
    date: Date
    type: string // RECEIPT | PAYMENT
    amount: number
    mode: string | null
    refNo?: string | null
    notes?: string | null
    status: string
    party?: { code: string; name: string } | null
  },
  company: TallyCompany
): TallyVoucher {
  const L = ledgerNames(company)
  if (p.status === 'CANCELLED') throw new BusinessError(`${p.paymentNo} is cancelled — export blocked`, 409)
  const date = utcYmd(p.date)
  if (!date) throw new BusinessError(`${p.paymentNo} has an unusable date`, 409)
  const isReceipt = p.type === 'RECEIPT'
  const moneyLedger = p.mode === 'CASH' ? L.cash : L.bank
  const partyName = p.party?.name || p.party?.code || 'Party'
  const entries: TallyEntry[] = isReceipt
    ? [
        { ledger: partyName, amount: r2(p.amount), isDebit: true, isParty: true, billRef: p.paymentNo },
        { ledger: moneyLedger, amount: r2(p.amount), isDebit: false, isParty: false },
      ]
    : [
        { ledger: partyName, amount: r2(p.amount), isDebit: false, isParty: true, billRef: p.paymentNo },
        { ledger: moneyLedger, amount: r2(p.amount), isDebit: true, isParty: false },
      ]
  const narrationParts = [p.paymentNo, isReceipt ? 'Receipt' : 'Payment']
  if (p.refNo) narrationParts.push(`Ref: ${p.refNo}`)
  if (p.notes) narrationParts.push(String(p.notes).slice(0, 180))
  return {
    docKind: 'PAYMENT',
    voucherType: isReceipt ? 'Receipt' : 'Payment',
    voucherNumber: p.paymentNo,
    remoteId: `FORGEERP-${p.type === 'RECEIPT' ? 'RCPT' : 'PYMT'}-${p.id}`,
    date,
    party: partyName,
    narration: narrationParts.join(' | '),
    entries,
    items: [],
    totals: { taxable: r2(p.amount), cgst: 0, sgst: 0, igst: 0, roundOff: 0, grandTotal: r2(p.amount) },
    warnings: p.mode !== 'CASH' ? ['Bank ledger name is a default — map it to your bank ledger in Tally'] : [],
  }
}

// ---------- XML rendering ----------

function ledgerEntryXml(e: TallyEntry): string {
  const signed = e.isDebit ? -Math.abs(e.amount) : Math.abs(e.amount)
  const bill = e.billRef
    ? `\n      <BILLALLOCATIONS.LIST><NAME>${tallyText(e.billRef)}</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>${amt(signed)}</AMOUNT></BILLALLOCATIONS.LIST>`
    : ''
  return [
    '    <LEDGERENTRIES.LIST>',
    `      <LEDGERNAME>${tallyText(e.ledger)}</LEDGERNAME>`,
    `      <ISDEEMEDPOSITIVE>${e.isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
    '      <LEDGERFROMITEM>No</LEDGERFROMITEM>',
    `      <ISPARTYLEDGER>${e.isParty ? 'Yes' : 'No'}</ISPARTYLEDGER>`,
    `      <AMOUNT>${amt(signed)}</AMOUNT>${bill}`,
    '    </LEDGERENTRIES.LIST>',
  ].join('\n')
}

function inventoryLineXml(l: TallyItemLine): string {
  return [
    '    <ALLINVENTORYENTRIES.LIST>',
    `      <STOCKITEMNAME>${tallyText(l.stockItem)}</STOCKITEMNAME>`,
    `      <RATE>${amt(l.rate)}/${tallyText(l.uom)}</RATE>`,
    `      <ACTUALQTY>${qty3(l.qty)} ${tallyText(l.uom)}</ACTUALQTY>`,
    `      <BILLEDQTY>${qty3(l.qty)} ${tallyText(l.uom)}</BILLEDQTY>`,
    `      <AMOUNT>${amt(l.amount)}</AMOUNT>`,
    '      <BASICUSERDESCRIPTION.LIST>',
    `        <BASICUSERDESCRIPTION>${tallyText(l.description)}</BASICUSERDESCRIPTION>`,
    '      </BASICUSERDESCRIPTION.LIST>',
    '      <ACCOUNTINGALLOCATIONS.LIST>',
    `        <LEDGERNAME>${tallyText(l.ledger)}</LEDGERNAME>`,
    `        <AMOUNT>${amt(l.amount)}</AMOUNT>`,
    '      </ACCOUNTINGALLOCATIONS.LIST>',
    '    </ALLINVENTORYENTRIES.LIST>',
  ].join('\n')
}

function voucherXml(v: TallyVoucher, tallyCompanyName?: string | null): string {
  const svc = tallyCompanyName?.trim()
    ? `\n        <STATICVARIABLES><SVCURRENTCOMPANY>${tallyText(tallyCompanyName)}</SVCURRENTCOMPANY></STATICVARIABLES>`
    : ''
  const invMode = v.items.length > 0
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    '  <HEADER>',
    '    <TALLYREQUEST>Import Data</TALLYREQUEST>',
    '  </HEADER>',
    '  <BODY>',
    '    <IMPORTDATA>',
    `      <REQUESTDESC>\n        <REPORTNAME>Vouchers</REPORTNAME>${svc}\n      </REQUESTDESC>`,
    '      <REQUESTDATA>',
    '        <TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `          <VOUCHER REMOTEID="${tallyText(v.remoteId)}" VCHTYPE="${v.voucherType}" ACTION="Create" OBJVIEW="${invMode ? 'Invoice Voucher View' : 'Accounting Voucher View'}">`,
    `            <DATE>${v.date}</DATE>`,
    `            <EFFECTIVEDATE>${v.date}</EFFECTIVEDATE>`,
    `            <VOUCHERTYPENAME>${v.voucherType}</VOUCHERTYPENAME>`,
    `            <VOUCHERNUMBER>${tallyText(v.voucherNumber)}</VOUCHERNUMBER>`,
    `            <REFERENCE>${tallyText(v.voucherNumber)}</REFERENCE>`,
    `            <REFERENCEDATE>${v.date}</REFERENCEDATE>`,
    `            <NARRATION>${tallyText(v.narration)}</NARRATION>`,
    `            <PARTYLEDGERNAME>${tallyText(v.party)}</PARTYLEDGERNAME>`,
    `            <PARTYNAME>${tallyText(v.party)}</PARTYNAME>`,
    `            <BASICBASEPARTYNAME>${tallyText(v.party)}</BASICBASEPARTYNAME>`,
    `            <PERSISTEDVIEW>${invMode ? 'Invoice Voucher View' : 'Accounting Voucher View'}</PERSISTEDVIEW>`,
    `            <ISINVOICE>${invMode ? 'Yes' : 'No'}</ISINVOICE>`,
    '            <ISDELETED>No</ISDELETED><ISOPTIONAL>No</ISOPTIONAL><ISCANCELLED>No</ISCANCELLED>',
    ...v.entries.map(ledgerEntryXml),
    ...v.items.map(inventoryLineXml),
    '          </VOUCHER>',
    '        </TALLYMESSAGE>',
    '      </REQUESTDATA>',
    '    </IMPORTDATA>',
    '  </BODY>',
    '</ENVELOPE>',
    '',
  ].join('\n')
}

/** One ENVELOPE carrying several vouchers (bulk export). */
export function vouchersToXml(vs: TallyVoucher[], tallyCompanyName?: string | null): string {
  const inner = vs.map((v) => voucherXml(v, tallyCompanyName))
  if (vs.length === 1) return inner[0]
  const svc = tallyCompanyName?.trim()
    ? `\n        <STATICVARIABLES><SVCURRENTCOMPANY>${tallyText(tallyCompanyName)}</SVCURRENTCOMPANY></STATICVARIABLES>`
    : ''
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    '  <HEADER>',
    '    <TALLYREQUEST>Import Data</TALLYREQUEST>',
    '  </HEADER>',
    '  <BODY>',
    '    <IMPORTDATA>',
    `      <REQUESTDESC>\n        <REPORTNAME>Vouchers</REPORTNAME>${svc}\n      </REQUESTDESC>`,
    '      <REQUESTDATA>',
    ...inner
      .map((x) => x.split('<REQUESTDATA>')[1]?.split('</REQUESTDATA>')[0] ?? '')
      .map((frag) => frag.trim())
      .map((frag) => `        ${frag.split('\n').join('\n        ')}`),
    '      </REQUESTDATA>',
    '    </IMPORTDATA>',
    '  </BODY>',
    '</ENVELOPE>',
    '',
  ].join('\n')
}

// ---------- JSON / CSV rendering ----------

export function voucherToCsv(v: TallyVoucher): string {
  const rows: (string | number)[][] = [
    ['Date', 'Voucher Type', 'Voucher No', 'Party', 'Stock Item', 'Description', 'HSN', 'Qty', 'UOM', 'Rate', 'Amount', 'Ledger', 'Debit', 'Credit'],
  ]
  for (const l of v.items) {
    rows.push([v.date, v.voucherType, v.voucherNumber, v.party, l.stockItem, l.description, l.hsn ?? '', qty3(l.qty), l.uom, amt(l.rate), amt(l.amount), l.ledger, '', ''])
  }
  for (const e of v.entries) {
    rows.push([v.date, v.voucherType, v.voucherNumber, v.party, '', '', '', '', '', '', amt(e.amount), e.ledger, e.isDebit ? amt(e.amount) : '', e.isDebit ? '' : amt(e.amount)])
  }
  rows.push(['', '', '', '', '', '', '', '', '', 'GRAND TOTAL', amt(v.totals.grandTotal), '', '', ''])
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
}

// ---------- masters XML (import first — kills "Ledger not found") ----------

const PARENT_MAP: Record<string, string> = {
  sales: 'Sales Accounts',
  purchase: 'Purchase Accounts',
  cgst: 'Duties & Taxes',
  sgst: 'Duties & Taxes',
  igst: 'Duties & Taxes',
  roundOff: 'Indirect Expenses',
}

export function mastersXml(
  company: TallyCompany,
  parties: { name: string; types: string }[],
  items: { uom: string }[]
): string {
  const L = ledgerNames(company)
  const messages: string[] = []

  // units (deduped, uppercased)
  const units = new Set<string>(['NOS'])
  for (const it of items) {
    const u = (it.uom || 'NOS').toUpperCase()
    if (u) units.add(u)
  }
  for (const u of units) {
    messages.push(
      [
        '        <TALLYMESSAGE xmlns:UDF="TallyUDF">',
        `          <UNIT NAME="${tallyText(u)}" ACTION="Create">`,
        `            <NAME>${tallyText(u)}</NAME>`,
        '            <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>',
        '            <DECIMALPLACES>3</DECIMALPLACES>',
        '          </UNIT>',
        '        </TALLYMESSAGE>',
      ].join('\n')
    )
  }

  // ledger roles (deduped case-insensitively)
  const seen = new Set<string>()
  const pushLedger = (name: string, parent: string) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    messages.push(
      [
        '        <TALLYMESSAGE xmlns:UDF="TallyUDF">',
        `          <LEDGER NAME="${tallyText(name)}" ACTION="Create">`,
        `            <NAME>${tallyText(name)}</NAME>`,
        `            <PARENT>${tallyText(parent)}</PARENT>`,
        '            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>',
        '            <OPENINGBALANCE>0</OPENINGBALANCE>',
        '          </LEDGER>',
        '        </TALLYMESSAGE>',
      ].join('\n')
    )
  }
  for (const [role, name] of Object.entries(L)) {
    if (role === 'cash' || role === 'bank') continue
    pushLedger(name, PARENT_MAP[role] ?? 'Indirect Expenses')
  }
  pushLedger(L.cash, 'Cash-in-Hand')

  // parties → Sundry Debtors / Sundry Creditors
  for (const p of parties) {
    const types = p.types.split(',')
    const parent = types.includes('SUPPLIER') && !types.includes('CUSTOMER') ? 'Sundry Creditors' : 'Sundry Debtors'
    pushLedger(p.name || 'Party', parent)
  }

  const svc = company.tallyCompanyName?.trim()
    ? `\n        <STATICVARIABLES><SVCURRENTCOMPANY>${tallyText(company.tallyCompanyName)}</SVCURRENTCOMPANY></STATICVARIABLES>`
    : ''
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ENVELOPE>',
    '  <HEADER>',
    '    <TALLYREQUEST>Import Data</TALLYREQUEST>',
    '  </HEADER>',
    '  <BODY>',
    '    <IMPORTDATA>',
    `      <REQUESTDESC>\n        <REPORTNAME>All Masters</REPORTNAME>${svc}\n      </REQUESTDESC>`,
    '      <REQUESTDATA>',
    ...messages,
    '      </REQUESTDATA>',
    '    </IMPORTDATA>',
    '  </BODY>',
    '</ENVELOPE>',
    '',
  ].join('\n')
}

// ---------- data loading ----------

function utcYmd(d: Date): string {
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return ''
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`
}

export async function getCompany(): Promise<TallyCompany | null> {
  // OPERATING org only (first NON-platform company). The platform company is
  // created FIRST on a blank DB (ensurePlatformAdmin), so ordering by
  // createdAt alone resolves the WRONG company — exports would use the
  // operator's row (no GSTIN, no tally ledger overrides).
  return tenantCompany(db)
}

export async function loadInvoiceVoucher(kind: 'SALES' | 'PURCHASE', id: string): Promise<TallyVoucher> {
  const company = await getCompany()
  if (!company) throw new BusinessError('Company not set up', 409)
  if (kind === 'SALES') {
    const inv = await db.salesInvoice.findUnique({
      where: { id },
      include: {
        party: { select: { code: true, name: true, gstin: true } },
        items: { include: { item: { select: { code: true, name: true, hsn: true, uom: true, isService: true } } } },
      },
    })
    if (!inv) throw new BusinessError('Invoice not found', 404)
    return buildInvoiceVoucher(inv, company, 'SALES')
  }
  const inv = await db.purchaseInvoice.findUnique({
    where: { id },
    include: {
      party: { select: { code: true, name: true, gstin: true } },
      items: { include: { item: { select: { code: true, name: true, hsn: true, uom: true, isService: true } } } },
    },
  })
  if (!inv) throw new BusinessError('Invoice not found', 404)
  return buildInvoiceVoucher(inv, company, 'PURCHASE')
}

export async function loadPaymentVoucher(id: string): Promise<TallyVoucher> {
  const company = await getCompany()
  if (!company) throw new BusinessError('Company not set up', 409)
  const p = await db.payment.findUnique({ where: { id }, include: { party: { select: { code: true, name: true } } } })
  if (!p) throw new BusinessError('Payment not found', 404)
  return buildPaymentVoucher(p, company)
}

/** Safe download filename from a voucher number. */
export function tallyFileName(voucherNo: string, ext: 'xml' | 'json' | 'csv'): string {
  return `${voucherNo.replace(/[\\/:*?"<>|]/g, '-')}_tally.${ext}`
}
