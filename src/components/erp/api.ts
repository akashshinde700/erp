'use client'

/**
 * ForgeERP — API client.
 * One helper for the {success,data,error} envelope; typed entities for every
 * backend endpoint; tiny fetch hooks with loading/error state.
 * All paths are relative (same origin) — Caddy-friendly by construction.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

// ---------- envelope ----------

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new Error('Network error — is the server running?')
  }
  let json: Envelope<T>
  try {
    json = (await res.json()) as Envelope<T>
  } catch {
    throw new Error(`Request failed (${res.status})`)
  }
  if (!res.ok || !json.success) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json.data as T
}

export const apiGet = <T>(path: string): Promise<T> => api<T>(path)
export const apiPost = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) })
export const apiPut = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) })
export const apiDelete = <T>(path: string): Promise<T> => api<T>(path, { method: 'DELETE' })

/** Toast any thrown error (sonner). */
export function toastError(e: unknown): void {
  toast.error(e instanceof Error ? e.message : 'Something went wrong')
}

// ---------- masters ----------

export interface Company {
  id: string
  name: string
  legalName: string | null
  gstin: string | null
  stateCode: string
  address: string | null
  city: string | null
  pincode: string | null
  phone: string | null
  email: string | null
  bankName: string | null
  bankAcct: string | null
  bankIfsc: string | null
  upiId: string | null
  tallyCompanyName: string | null
  tallySalesLedger: string | null
  tallyPurchaseLedger: string | null
  tallyCgstLedger: string | null
  tallySgstLedger: string | null
  tallyIgstLedger: string | null
  tallyRoundOffLedger: string | null
  plan: { id: string; name: string; priceMonthly: number } | null
  saasStatus: string
  billingCycle: string
  paidUntil: string | null
  trialEndsAt: string | null
  access?: { state: string; blocked: boolean; message: string }
}

export interface Party {
  id: string
  code: string
  name: string
  types: string // CSV: CUSTOMER,SUPPLIER,JOBWORKER
  gstin: string | null
  stateCode: string
  address: string | null
  city: string | null
  pincode: string | null
  phone: string | null
  email: string | null
  openingBal: number
  active: boolean
}

export interface Item {
  id: string
  code: string
  name: string
  groupName: string
  hsn: string | null
  isService: boolean
  isStockItem: boolean
  uom: string
  gstRate: number
  saleRate: number
  costRate: number
  reorderLevel: number
  active: boolean
}

export interface Warehouse {
  id: string
  code: string
  name: string
  location: string | null
  active: boolean
}

export interface Process {
  id: string
  code: string
  name: string
  seq: number
  basis: string // WEIGHT | QTY
  rate: number
  lotCharge: number
  active: boolean
}

export interface PartyRateRow {
  processId: string
  code: string
  name: string
  basis: string
  defaultRate: number
  defaultLot: number
  rate: number
  lotCharge: number
  overridden: boolean
}

export interface PartyRateGrid {
  party: { id: string; code: string; name: string }
  rows: PartyRateRow[]
}

// ---------- invoices ----------

export interface InvoiceItem {
  id: string
  itemId: string
  detail: string | null
  hsn: string | null
  uom: string
  qty: number
  rate: number
  discPct: number
  discAmt: number
  taxable: number
  gstRate: number
  cgst: number
  sgst: number
  igst: number
  total: number
}

export interface PartyMini {
  code: string
  name: string
  gstin?: string | null
  stateCode?: string
}

export interface SalesInvoice {
  id: string
  invoiceNo: string
  date: string
  partyId: string
  poNo: string | null
  pos: string
  interState: boolean
  taxInclusive: boolean
  taxable: number
  discount: number
  cgst: number
  sgst: number
  igst: number
  roundOff: number
  grandTotal: number
  paidAmount: number
  status: string
  source: string
  remarks: string | null
  party?: PartyMini
  items?: InvoiceItem[]
}

export interface PurchaseInvoice {
  id: string
  invoiceNo: string
  date: string
  partyId: string
  poNo: string | null
  interState: boolean
  taxInclusive: boolean
  taxable: number
  discount: number
  cgst: number
  sgst: number
  igst: number
  roundOff: number
  grandTotal: number
  paidAmount: number
  status: string
  remarks: string | null
  party?: PartyMini
  items?: InvoiceItem[]
}

// ---------- payments ----------

export interface PaymentAllocation {
  id?: string
  invoiceType: string // SALES | PURCHASE
  invoiceNo: string
  amount: number
}

export interface Payment {
  id: string
  paymentNo: string
  date: string
  type: string // RECEIPT | PAYMENT
  partyId: string
  amount: number
  mode: string | null
  refNo: string | null
  notes: string | null
  status: string
  party?: { code: string; name: string }
  allocations?: PaymentAllocation[]
}

// ---------- jobwork ----------

export interface JobworkInwardItem {
  id: string
  itemId: string
  item: Item
  batchNo: string | null
  qty: number
  weight: number
  processedQty: number
  processedWeight: number
  remarks: string | null
}

export interface JobCardProcess {
  id: string
  jobCardId: string
  processId: string
  process: Process
  inwardItemId: string
  qty: number
  weight: number
  basis: string
  rate: number
  amount: number
  lotCharge: number
}

export interface JobCard {
  id: string
  cardNo: string
  inwardId: string
  date: string
  status: string // COMPLETED | CANCELLED
  totalAmount: number
  notes: string | null
  processes?: JobCardProcess[]
}

export interface JobworkCertificate {
  id: string
  certNo: string
  inwardId: string
  date: string
  totalQty: number
  totalWeight: number
  totalAmount: number
  status: string
  details: string | null
}

export interface JobworkInward {
  id: string
  inwardNo: string
  date: string
  partyId: string
  party: Party
  challanNo: string | null
  warehouseId: string | null
  notes: string | null
  status: string // OPEN | IN_PROGRESS | COMPLETED | INVOICED | CANCELLED
  items: JobworkInwardItem[]
  jobCards: JobCard[]
  certificates: JobworkCertificate[]
}

// ---------- reports ----------

export interface StockLedgerRow {
  id: string
  postingDate: string
  voucherType: string
  voucherNo: string
  itemId: string
  item: Item
  warehouseId: string | null
  warehouse: Warehouse | null
  qtyIn: number
  qtyOut: number
  rate: number
  balance: number
  value: number
  avgCost: number
  remarks: string | null
  isCancelled: boolean
}

export interface StockSummaryRow {
  item: {
    id: string
    code: string
    name: string
    uom: string
    reorderLevel: number
    hsn: string | null
  }
  inQty: number
  outQty: number
  closing: number
  avgCost: number
  closingValue: number
  lowStock: boolean
}

export interface Gstr1Bucket {
  rate: number
  count: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
}

export interface Gstr1Report {
  month: string
  invoiceCount: number
  b2bCount: number
  b2cCount: number
  b2b: Gstr1Bucket[]
  b2c: Gstr1Bucket[]
  b2bTotal: { count: number; taxable: number; cgst: number; sgst: number; igst: number }
  b2cTotal: { count: number; taxable: number; cgst: number; sgst: number; igst: number }
}

export interface TrialBalanceAccount {
  account: string
  accountName: string
  debit: number
  credit: number
  closing: number
}

export interface TrialBalance {
  accounts: TrialBalanceAccount[]
  totalDr: number
  totalCr: number
  balanced: boolean
}

export interface OutstandingRow {
  party: { id: string; code: string; name: string; stateCode?: string; openingBal?: number }
  amount: number
}

export interface Outstanding {
  customers: OutstandingRow[]
  suppliers: OutstandingRow[]
  totalReceivable: number
  totalPayable: number
}

export interface Pnl {
  from: string
  to: string
  sales: number
  jobworkIncome: number
  purchases: number
  roundOff: number
  revenue: number
  grossProfit: number
  netProfit: number
}

export interface PartyLedgerRow {
  id: string
  date: string
  account: string
  accountName: string
  partyId: string | null
  debit: number
  credit: number
  voucherType: string
  voucherNo: string
  balance: number
  isCancelled: boolean
}

export interface PartyLedger {
  party: Party
  openingBal: number
  rows: PartyLedgerRow[]
  closing: number
}

export interface JobworkPendingItem {
  item: { id: string; code: string; name: string; uom: string }
  batchNo: string | null
  receivedQty: number
  processedQty: number
  remainingQty: number
  receivedWeight: number
  processedWeight: number
  remainingWeight: number
  pendingProcesses: { id: string; code: string; name: string }[]
}

export interface JobworkPendingRow {
  inward: {
    id: string
    inwardNo: string
    date: string
    status: string
    party: { name: string; code: string }
  }
  items: JobworkPendingItem[]
  cardValue: number
}

export interface DashboardData {
  monthSales: number
  monthPurchase: number
  receivables: number
  payables: number
  stockValue: number
  openJobworkValue: number
  trend: { month: string; label: string; sales: number; purchase: number }[]
  recentInvoices: {
    id: string
    invoiceNo: string
    date: string
    party: string
    grandTotal: number
    paidAmount: number
    source: string
  }[]
  lowStock: { code: string; name: string; closing: number; reorderLevel: number; uom: string }[]
}

// ---------- hooks ----------

const emptySubscribe = () => () => {}

/** Hydration-safe "is client" flag (no setState-in-effect). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
}

/** Fetch + parse with loading/error state; `reload()` re-runs (stale-while-revalidate). `null` path skips. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ forPath: string | null; data: T | null; error: string | null }>({
    forPath: null,
    data: null,
    error: null,
  })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (path === null) return
    let alive = true
    api<T>(path)
      .then((d) => {
        if (alive) setState({ forPath: path, data: d, error: null })
      })
      .catch((e: unknown) => {
        if (alive)
          setState({ forPath: path, data: null, error: e instanceof Error ? e.message : 'Request failed' })
      })
    return () => {
      alive = false
    }
  }, [path, tick])

  const current = state.forPath === path ? state : null
  const data = current?.data ?? null
  const error = current?.error ?? null
  const loading = path !== null && current === null
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, error, reload }
}

/** All masters in parallel (parties/items/warehouses/processes). */
export function useMasters() {
  const parties = useApi<Party[]>('/api/masters/parties')
  const items = useApi<Item[]>('/api/masters/items')
  const warehouses = useApi<Warehouse[]>('/api/masters/warehouses')
  const processes = useApi<Process[]>('/api/masters/processes')
  return {
    parties: parties.data ?? [],
    items: items.data ?? [],
    warehouses: warehouses.data ?? [],
    processes: processes.data ?? [],
    loading: parties.loading || items.loading || warehouses.loading || processes.loading,
    reloadAll: () => {
      parties.reload()
      items.reload()
      warehouses.reload()
      processes.reload()
    },
  }
}

// ---------- tally / platform / audit ----------

export interface TallyVoucherPreview {
  voucher: {
    voucherType: string
    voucherNumber: string
    remoteId: string
    date: string
    party: string
    entries: { ledger: string; amount: number; isDebit: boolean; isParty: boolean }[]
    items: { stockItem: string; qty: number; rate: number; amount: number; uom: string }[]
    totals: { taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; grandTotal: number }
  }
  warnings: string[]
}

// ---------- e-invoice ----------

export interface EInvoicePreview {
  valid: boolean
  docNo: string
  errors: string[]
  warnings: string[]
  supTyp: string
  itemCount: number
  totInvVal: number
}

export interface EInvoiceBulkPreview {
  total: number
  eligible: number
  skipped: { docNo: string; errors: string[] }[]
  value: number
}

export interface TallyConnectorStatus {
  paired: boolean
  online: boolean
  pending: number
  lastSeenAt: number | null
  pairedAt: number | null
  connectorVersion: string | null
  recent: { docNo: string; ok: boolean; created: number; altered: number; errors: number; errorText: string }[]
}

export interface Plan {
  id: string
  name: string
  priceMonthly: number
  priceYearly: number
  maxItems: number
  maxWarehouses: number
  maxParties: number
  active: boolean
  features: string[]
  _count?: { companies: number }
}

export interface OrgRow {
  id: string
  name: string
  gstin: string | null
  city: string | null
  email: string | null
  isPlatform: boolean
  operating: boolean
  plan: { id: string; name: string; priceMonthly: number } | null
  customized: boolean
  limits: { items: number; warehouses: number; parties: number }
  usage: { parties: number; items: number; warehouses: number; salesInvoices: number }
  saasStatus: string
  billingCycle: string
  paidUntil: string | null
  trialEndsAt: string | null
  createdAt: string
}

export interface OrgsResponse {
  orgs: OrgRow[]
  stats: { total: number; active: number; suspended: number; mrr: number; parties: number; items: number; warehouses: number; salesInvoices: number }
}

// ---------- platform inquiries & blog ----------

/** Client-side mirror of PLAN_FEATURES in src/lib/platform.ts (keys must match). */
export const PLAN_FEATURE_CATALOG = [
  { key: 'exportData', label: 'Data export' },
  { key: 'advancedReports', label: 'Advanced reports' },
] as const

export const INQUIRY_STATUSES = ['new', 'contacted', 'converted', 'closed'] as const
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number]

export interface InquiryFollowUp {
  id: string
  inquiryId: string
  note: string
  createdAt: string
}

export interface InquiryRow {
  id: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  city: string | null
  message: string | null
  status: InquiryStatus | string
  createdAt: string
  followUps: InquiryFollowUp[]
}

export interface InquiriesResponse {
  inquiries: InquiryRow[]
  newCount: number
}

export interface BlogPost {
  id: string
  title: string
  slug: string
  excerpt: string | null
  body: string | null
  status: 'draft' | 'published' | string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface BlogResponse {
  posts: BlogPost[]
}

export interface AuditRow {
  id: string
  action: string
  entity: string
  entityId: string | null
  details: string | null
  createdAt: string
}

// ---------- platform api (key-authenticated) ----------

export async function platformApi<T>(path: string, init?: RequestInit, key?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> | undefined) }
  if (key) headers['x-platform-key'] = key
  return api<T>(path, { ...init, headers })
}

// ---------- misc helpers ----------

/** Trigger a browser download for a GET endpoint that returns an attachment. */
export function downloadUrl(path: string): void {
  const a = document.createElement('a')
  a.href = path
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** GST e-invoice portal — Bulk Upload page (where the IRP JSON is uploaded). */
export const EINVOICE_PORTAL_URL =
  'https://einvoice1.gst.gov.in/Home/Index?ReturnUrl=%2FInvoice%2FBulkUpload'

/**
 * Opens the GST e-invoice portal's Bulk Upload page in a new tab, together with
 * an e-Invoice JSON download. Popup-blocker-safe: the tab is opened
 * synchronously inside the click gesture (browsers block window.open after
 * awaits). `retry()` re-attempts in case the first open was blocked;
 * `cancel()` closes the tab when pre-validation fails and no JSON is produced.
 */
export function openEInvoicePortal(): { retry: () => void; cancel: () => void } {
  const tab = window.open(EINVOICE_PORTAL_URL, '_blank')
  return {
    retry: () => {
      if (!tab) void window.open(EINVOICE_PORTAL_URL, '_blank', 'noopener')
    },
    cancel: () => tab?.close(),
  }
}

/** Client-side CSV download (BOM + quote escaping). */
export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Parse an input value into a finite number (default 0). */
export const num = (v: string | number): number => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export const todayISO = (): string => new Date().toISOString().slice(0, 10)

export const currentMonth = (): string => new Date().toISOString().slice(0, 7)

/** Client-side party filter by type CSV. */
export const partyTypes = (p: Party): string[] => p.types.split(',').filter(Boolean)
