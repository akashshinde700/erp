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

/** API error carrying the HTTP status — lets callers distinguish auth loss
 *  (401) from transient failures (409 races, 5xx, network). */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Identical mutations already in flight share one request. A double/triple
 * click fires several submits in the same tick, before React re-renders the
 * button as disabled; without this each became its own POST (duplicate
 * documents, or 409 toasts where a unique key caught them). A later, separate
 * submit after the first finished is a new request as usual.
 */
const inFlight = new Map<string, Promise<unknown>>()

export function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'GET') return send<T>(path, init)
  const key = `${method} ${path} ${typeof init?.body === 'string' ? init.body : ''}`
  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T>
  const request = send<T>(path, init).finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError('Network error — is the server running?', 0)
  }
  let json: Envelope<T>
  try {
    json = (await res.json()) as Envelope<T>
  } catch {
    throw new ApiError(`Request failed (${res.status})`, res.status)
  }
  if (!res.ok || !json.success) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status)
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
  creditLimit: number
  creditDays: number
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
  tallySentAt?: string | null
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
  tallySentAt?: string | null
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

// ---------- manufacturing (Project → BOM → Work Order → Tasks) ----------

export interface Employee {
  id: string
  code: string
  name: string
  role: string // WORKER | SUPERVISOR | MANAGER
  skill: string | null
  machineNo: string | null
  shift: string // GENERAL | DAY | NIGHT
  hourlyRate: number
  phone: string | null
  active: boolean
  createdAt: string
  _count?: { tasks: number }
}

export interface ProjectStats {
  bomCount: number
  woCount: number
  taskTotal: number
  taskDone: number
  progressPct: number
  actualCost: number
  labourCost: number
  materialCost: number
}

export interface Project {
  id: string
  projectNo: string
  name: string
  partyId: string
  party: { id: string; code: string; name: string; city: string | null }
  manager: string | null
  location: string | null
  startDate: string
  endDate: string | null
  budget: number
  estCost: number
  documents: string | null
  status: string // PENDING | RUNNING | COMPLETED | CANCELLED
  completedAt: string | null
  notes: string | null
  createdAt: string
  stats: ProjectStats
}

export interface BomItemRow {
  id: string
  itemId: string
  item: { id?: string; code: string; name: string; uom: string; costRate?: number }
  grade: string | null
  thickness: number
  length: number
  width: number
  qty: number
  uom: string
  wastagePct: number
  rate: number
  estCost: number
  drawingRef: string | null
  remarks: string | null
  /** MRP stock check */
  avail: number
  grossQty: number
  shortage: number
}

export interface BomRevisionRef {
  id: string
  bomNo: string
  revision: number
}

export interface Bom {
  id: string
  bomNo: string
  projectId: string
  project: { id: string; projectNo: string; name: string; status: string }
  /** Output item — what this BOM makes. MRP explodes demand through it. */
  itemId: string | null
  item: { id: string; code: string; name: string; uom: string } | null
  /** Engineering revision of the output item; one APPROVED revision is live. */
  revision: number
  effectiveFrom: string | null
  effectiveTo: string | null
  supersedesId: string | null
  supersedes: BomRevisionRef | null
  supersededBy: BomRevisionRef | null
  productName: string
  drawingRef: string | null
  status: string // DRAFT | APPROVED | SUPERSEDED | CANCELLED
  approvedAt: string | null
  notes: string | null
  createdAt: string
  items: BomItemRow[]
  totalEstCost: number
  _count?: { workOrders: number }
}

export interface BomWhereUsedRow {
  bomId: string
  bomNo: string
  revision: number
  status: string
  effectiveFrom: string | null
  /** Gross quantity of this item consumed per BOM run (qty + wastage). */
  qtyPer: number
  uom: string
  lines: number
  /** Work orders already generated from this revision (impact review). */
  workOrders: number
  outputItem: { id: string; code: string; name: string } | null
  project: { projectNo: string; name: string }
}

export interface BomWhereUsed {
  item: { id: string; code: string; name: string; uom: string }
  usedIn: BomWhereUsedRow[]
}

export interface WorkOrderLineRow {
  id: string
  itemId: string
  item: { code: string; name: string; uom: string }
  description: string | null
  plannedQty: number
  uom: string
}

export interface ProductionTask {
  id: string
  taskNo: string
  workOrderId: string
  seq: number
  operation: string
  employeeId: string | null
  employee?: { id: string; code: string; name: string; machineNo?: string | null; shift?: string } | null
  machineNo: string | null
  workCenterId: string | null
  workCenter?: { id: string; code: string; name: string } | null
  /** Planned duration from the routing snapshot (minutes). */
  plannedMinutes: number
  plannedQty: number
  actualQty: number
  rejectionQty: number
  hours: number
  labourRate: number
  labourCost: number
  materialItemId: string | null
  materialItem?: { id: string; code: string; name: string; uom: string } | null
  materialQty: number
  materialCost: number
  status: string // PENDING | ASSIGNED | IN_PROGRESS | COMPLETED | CANCELLED
  dueDate: string | null
  startedAt: string | null
  completedAt: string | null
  notes: string | null
  createdAt: string
}

export interface WorkOrder {
  id: string
  woNo: string
  projectId: string
  project: { id: string; projectNo: string; name: string; status: string }
  bomId: string | null
  bom?: { id: string; bomNo: string; productName: string; revision?: number; itemId?: string | null } | null
  /** What this order produces; defaulted from the BOM's output item. */
  outputItemId?: string | null
  outputItem?: { id: string; code: string; name: string; uom: string } | null
  outputQty?: number
  date: string
  startDate: string | null
  endDate: string | null
  priority: string // LOW | NORMAL | HIGH | URGENT
  status: string // OPEN | IN_PROGRESS | COMPLETED | CANCELLED
  completedAt: string | null
  notes: string | null
  createdAt: string
  lines: WorkOrderLineRow[]
  tasks: ProductionTask[]
  stats: { taskTotal: number; taskDone: number; progressPct: number; labourCost: number; materialCost: number }
}

export interface ProjectDetail extends Omit<Project, 'stats'> {
  boms: (Bom & { items: BomItemRow[] })[]
  workOrders: WorkOrder[]
  stats: ProjectStats & {
    estCost: number
    budget: number
    margin: number
    pendingTasks: number
  }
}

export interface PendingTaskRow extends ProductionTask {
  employee: { id: string; code: string; name: string; shift: string } | null
  workOrder: {
    id: string
    woNo: string
    priority: string
    status: string
    endDate: string | null
    project: { id: string; projectNo: string; name: string; status: string }
  }
  overdue: boolean
  woOverdue: boolean
}

export interface PendingReport {
  rows: PendingTaskRow[]
  summary: { total: number; overdue: number; unassigned: number; inProgress: number }
}

export interface ManufacturingStats {
  projects: { total: number; pending: number; running: number; completed: number }
  workOrders: { open: number; inProgress: number; completed: number }
  tasks: { pending: number; assigned: number; inProgress: number }
}

export interface MaterialPlanRow {
  item: { id: string; code: string; name: string; uom: string; reorderLevel: number }
  requiredQty: number
  issuedQty: number
  remainingQty: number
  availableQty: number
  shortageQty: number
  incomingQty: number
  projectedShortageQty: number
  purchaseOrders: { poNo: string; expectedDate: string | null; qty: number }[]
  workOrders: { id: string; woNo: string; projectNo: string; projectName: string; dueDate: string | null; requiredQty: number }[]
}

export interface MaterialPlanReport {
  rows: MaterialPlanRow[]
  summary: { activeWorkOrders: number; materialItems: number; shortageItems: number; totalShortageQty: number; customerMaterialQty: number }
  ownershipRule: string
}

// ---------- MRP (multi-level, versioned BOM) ----------

export type MrpSuggestion = 'BUY' | 'MAKE' | 'NONE'
export type MrpRunStatus = 'DRAFT' | 'APPROVED' | 'CLOSED'

export interface MrpRunSummary {
  id: string
  runNo: string
  asOf: string
  horizonDays: number
  status: MrpRunStatus
  salesOrderCount: number
  workOrderCount: number
  requirementCount: number
  suggestionCount: number
  shortageItems: number
  createdBy: string | null
  approvedBy: string | null
  approvedAt: string | null
  notes: string | null
  createdAt: string
  _count?: { lines: number }
}

export interface MrpLineRow {
  id: string
  runId: string
  itemId: string
  item: { id: string; code: string; name: string; uom: string; isStockItem: boolean }
  level: number
  needBy: string
  grossQty: number
  onHandQty: number
  incomingQty: number
  woSupplyQty: number
  netQty: number
  suggestion: MrpSuggestion
  bomNo: string | null
  /** Newline-separated demand pegging (sales order / work order references). */
  pegging: string | null
  createdDocType: string | null
  createdDocNo: string | null
}

export interface MrpRunDetail extends MrpRunSummary {
  lines: MrpLineRow[]
  /** Warnings captured while planning (missing BOM, cycle, horizon cuts). */
  warnings: string[]
  allowDocuments: boolean
}

export interface MrpDocumentResult {
  run: MrpRunSummary
  requisition: { id: string; reqNo: string; grandTotal?: number } | null
  workOrders: { id: string; woNo: string }[]
}

// ---------- routing / work centres / capacity / OEE ----------

export interface ShiftRow {
  id: string
  name: string
  startMin: number
  durationMin: number
  active: boolean
}

export interface WorkCenter {
  id: string
  code: string
  name: string
  type: 'MACHINE' | 'CELL' | 'MANUAL'
  machineNo: string | null
  parallelCapacity: number
  dailyHours: number
  costPerHour: number
  active: boolean
  notes: string | null
  downNow?: boolean
  plannedMinutesPerDay?: number
  calendar?: { id: string; workDays: string; shifts: ShiftRow[]; holidays: { id: string; date: string; reason: string | null }[] } | null
  _count?: { operations: number; tasks: number; downtimes: number }
}

export interface WorkCenterCalendar {
  workCenter: { id: string; code: string; name: string; dailyHours: number; parallelCapacity: number }
  workDays: string
  shifts: ShiftRow[]
  holidays: { id: string; date: string; reason: string | null }[]
  hasCalendar: boolean
}

export interface RoutingOperationRow {
  id: string
  seq: number
  operation: string
  workCenterId: string
  workCenter: { id: string; code: string; name: string; type: string; costPerHour: number }
  runMinutesPerUnit: number
  setupMinutes: number
  queueMinutes: number
  moveMinutes: number
  inspectionMinutes: number
  parallel: boolean
  notes: string | null
}

export interface RoutingDetail {
  bom: { id: string; bomNo: string; revision: number; status: string; itemId: string | null; productName: string }
  operations: RoutingOperationRow[]
}

export interface DowntimeRow {
  id: string
  workCenterId: string
  workCenter: { id: string; code: string; name: string }
  startedAt: string
  endedAt: string | null
  reason: string
  planned: boolean
  notes: string | null
  minutes: number
  open: boolean
}

export interface SchedulePlacement {
  taskId: string
  taskNo: string
  woNo: string
  projectNo: string
  operation: string
  seq: number
  workCenterId: string
  workCenter: string
  minutes: number
  start: string
  end: string
}

export interface SchedulePlan {
  from: string
  horizonDays: number
  placements: SchedulePlacement[]
  unschedulable: { taskNo: string; woNo: string; reason: string }[]
  lateWorkOrders: { woNo: string; projectNo: string; due: string; plannedFinish: string; lateDays: number }[]
  load: { workCenterId: string; workCenter: string; tasks: number; plannedMinutes: number; capacityMinutes: number; utilisationPct: number }[]
  workCentersWithoutCalendar: string[]
}

export interface OeeRow {
  workCenterId: string
  workCenter: string
  day: string
  plannedMinutes: number
  downtimeMinutes: number
  runMinutes: number
  availabilityPct: number
  performancePct: number
  qualityPct: number
  oeePct: number
  idealMinutes: number
  goodQty: number
  rejectQty: number
  tasks: number
  downtimeByReason: Record<string, number>
  notes: string[]
}

export interface OeeReport {
  from: string
  to: string
  days: number
  rows: OeeRow[]
  byWorkCenter: OeeRow[]
  byDay: OeeRow[]
  summary: {
    plannedMinutes: number
    downtimeMinutes: number
    runMinutes: number
    availabilityPct: number
    performancePct: number
    qualityPct: number
    oeePct: number
    workCenters: number
    days: number
  }
  excluded: { tasksWithoutIdealTime: number; tasksWithoutWorkCenter: number; openDowntime: number }
  notes: string[]
}

export const DOWNTIME_REASONS = [
  'BREAKDOWN',
  'CHANGEOVER',
  'NO_MATERIAL',
  'NO_OPERATOR',
  'POWER',
  'MAINTENANCE',
  'QUALITY',
  'OTHER',
] as const

export const WORK_CENTER_TYPES = ['MACHINE', 'CELL', 'MANUAL'] as const

export const MANUFACTURING_OPERATIONS: { key: string; label: string }[] = [
  { key: 'CUTTING', label: 'Material Cutting' },
  { key: 'CNC_LASER', label: 'CNC / Laser Cutting' },
  { key: 'BENDING', label: 'Bending' },
  { key: 'DRILLING', label: 'Drilling' },
  { key: 'WELDING', label: 'Welding' },
  { key: 'GRINDING', label: 'Grinding' },
  { key: 'ASSEMBLY', label: 'Assembly' },
  { key: 'PAINTING', label: 'Painting / Powder Coating' },
  { key: 'FINISHING', label: 'Final Finishing' },
  { key: 'OTHER', label: 'Other' },
]

export const operationLabel = (key: string): string =>
  MANUFACTURING_OPERATIONS.find((o) => o.key === key)?.label ?? key

export const WO_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

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
  /** Per-warehouse closing split (non-zero only). */
  warehouses?: { code: string; closing: number }[]
}

export interface InventoryPlanningRow extends StockSummaryRow {
  lastMovementAt: string | null
  lastVoucherType: string | null
  lastVoucherNo: string | null
  inactiveDays: number | null
  ageingClass: 'ACTIVE' | 'SLOW' | 'DEAD' | 'NO_MOVEMENT'
  suggestedOrderQty: number
}

export interface InventoryPlanningReport {
  asOf: string
  rows: InventoryPlanningRow[]
  summary: { itemCount: number; reorderItems: number; deadItems: number; slowItems: number; stockValue: number }
}

export interface WorkflowActionCenterReport {
  generatedAt: string
  summary: { critical: number; high: number; overdueTasks: number; unassignedTasks: number; reorderItems: number; jobworkActions: number; receivables: number; payables: number }
  tasks: { id: string; taskNo: string; operation: string; status: string; priority: string; reason: string; dueDate: string | null; employee: { id: string; code: string; name: string } | null; woNo: string; projectNo: string; projectName: string }[]
  stock: { item: { id: string; code: string; name: string; uom: string; reorderLevel: number; hsn: string | null }; closing: number; suggestedOrderQty: number; priority: string }[]
  jobwork: { id: string; inwardNo: string; party: string; status: string; action: string; priority: string; receivedQty: number; processedQty: number; remainingQty: number; cardValue: number; certificateNo: string | null }[]
  receivables: OutstandingRow[]
  payables: OutstandingRow[]
}

export interface ProductionEfficiencyMetric {
  taskTotal: number
  taskDone: number
  plannedQty: number
  actualQty: number
  rejectionQty: number
  hours: number
  labourCost: number
  materialCost: number
  yieldPct: number
  attainmentPct: number
  outputPerHour: number
  totalCost: number
}

export interface ProductionEfficiencyReport {
  operations: (ProductionEfficiencyMetric & { operation: string })[]
  machines: (ProductionEfficiencyMetric & { machineNo: string })[]
  operators: (ProductionEfficiencyMetric & { employee: { id: string; code: string; name: string } })[]
  summary: ProductionEfficiencyMetric
  openTasks: { id: string; taskNo: string; operation: string; status: string; machineNo: string | null; employee: { id: string; code: string; name: string } | null; woNo: string; projectNo: string; projectName: string; dueDate: string | null }[]
  note: string
}

export interface ProductionCostVarianceReport {
  rows: {
    project: { id: string; projectNo: string; name: string; status: string; party: { id: string; code: string; name: string } }
    budget: number
    expectedCost: number
    labourCost: number
    materialCost: number
    actualCost: number
    costVariance: number
    variancePct: number | null
    projectedMargin: number
    projectedMarginPct: number | null
    productionHours: number
    rejectionQty: number
    rejectionPct: number
    taskTotal: number
    taskDone: number
    workOrders: { id: string; woNo: string; status: string; bomNo: string | null; productName: string | null; expectedCost: number; labourCost: number; materialCost: number; actualCost: number; variance: number; taskTotal: number; taskDone: number }[]
  }[]
  summary: { projectCount: number; runningProjects: number; totalBudget: number; expectedCost: number; labourCost: number; materialCost: number; actualCost: number; costVariance: number; projectedMargin: number }
  note: string
}

export interface CustomerPerformanceReport {
  rows: {
    customer: { id: string; code: string; name: string; city: string | null; gstin: string | null; active: boolean }
    invoiceCount: number
    cancelledCount: number
    salesValue: number
    receivedValue: number
    invoiceOutstanding: number
    collectionPct: number
    avgInvoiceValue: number
    jobworkValue: number
    jobworkSharePct: number
    lastSaleAt: string | null
    topItems: { item: { id: string; code: string; name: string; uom: string }; qty: number; taxableValue: number; avgRate: number }[]
  }[]
  summary: { customerCount: number; activeCustomers: number; customersServed: number; totalSales: number; totalReceived: number; invoiceOutstanding: number; jobworkSales: number }
  note: string
}

export interface SupplierPerformanceReport {
  rows: {
    supplier: { id: string; code: string; name: string; city: string | null; gstin: string | null; active: boolean }
    invoiceCount: number
    cancelledCount: number
    purchaseValue: number
    paidValue: number
    outstanding: number
    paymentPct: number
    avgInvoiceValue: number
    lastPurchaseAt: string | null
    topItems: { item: { id: string; code: string; name: string; uom: string }; qty: number; taxableValue: number; avgRate: number }[]
  }[]
  summary: { supplierCount: number; activeSuppliers: number; suppliersUsed: number; totalPurchases: number; totalPaid: number; totalOutstanding: number }
  unavailableUntilProcurementWorkflow: string[]
}

export interface CashBankBook {
  from: string
  to: string
  accounts: { account: string; accountName: string; opening: number; receipts: number; payments: number; closing: number }[]
  rows: {
    id: string
    date: string
    account: string
    accountName: string
    voucherType: string
    voucherNo: string
    party: { id: string; code: string; name: string } | null
    debit: number
    credit: number
    movement: number
    balance: number
    remarks: string | null
  }[]
  totalOpening: number
  totalReceipts: number
  totalPayments: number
  totalClosing: number
}

export interface HsnSummaryRow { hsn: string; description: string; uom: string; gstRate: number; qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }
export interface HsnSummaryReport { month: string; outward: HsnSummaryRow[]; inward: HsnSummaryRow[]; missingHsnLines: number; outwardTaxable: number; inwardTaxable: number }

export interface Gstr3bReport {
  month: string
  salesInvoiceCount: number
  purchaseInvoiceCount: number
  outward: { taxable: number; cgst: number; sgst: number; igst: number; grandTotal: number }
  eligibleItcFromBooks: { taxable: number; cgst: number; sgst: number; igst: number; grandTotal: number }
  netTaxBeforeCrossUtilisation: { cgst: number; sgst: number; igst: number; total: number }
  excessItcBeforeCrossUtilisation: { cgst: number; sgst: number; igst: number; total: number }
  limitations: string[]
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
  runningProjects: number
  pendingTasks: number
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

// ---------- org login (SaaS) ----------

/** Session payload returned by /api/auth/{login,session,bootstrap}. */
export interface SessionInfo {
  user: { id: string; name: string; email: string; role: string }
  company: { id: string; name: string; gstin: string | null; city: string | null; email: string | null }
  operating: boolean
  operatingOrg: { id: string; name: string } | null
  plan: string | null
  access: { state: string; blocked: boolean; message: string }
  paidUntil: string | null
  trialEndsAt: string | null
}

export interface AuthStatus {
  companyExists: boolean
  companyName: string | null
  usersExist: boolean
  demoHint: boolean
  /** True when the SUPER_ADMIN login exists (no email/password ever exposed). */
  platformConfigured: boolean
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

export interface EWayBillPreview {
  valid: boolean
  docNo: string
  errors: string[]
  warnings: string[]
  itemCount: number
  totalValue: number
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
  ownerEmail: string | null
  userCount: number
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
