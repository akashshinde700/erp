/**
 * Workflow tables added after backup v3 (procurement, quote-to-cash, QC,
 * lot/serial traceability, production receipts, payment schedules, advances,
 * refunds). Backup v4 snapshots carry every one of them under `data.workflow`,
 * keyed by Prisma model accessor; restore deletes them children-first and
 * inserts them parents-first.
 *
 * The order is derived from the foreign-key graph of prisma/schema.prisma
 * (tests/erp-audit.mjs round-trips a seeded database through backup → restore
 * on MySQL). Add any new model here or a force reseed / restore will fail
 * with P2003 — and a backup will silently drop its rows.
 */
export const WORKFLOW_MODELS_CHILDREN_FIRST = [
  // routing / capacity / OEE (children first: downtime and routing hang off
  // work centres and BOM revisions; tasks reference work centres)
  'shiftHoliday',
  'shift',
  'machineDowntime',
  'routingOperation',
  'shiftCalendar',
  // MRP snapshots (MrpLine cascades from MrpRun, but children still go first)
  'mrpLine',
  'mrpRun',
  // MapSoft-parity tables (books, stock adjustments, CRM, service calls)
  'serviceCall',
  'leadActivity',
  'lead',
  'stockAdjustmentLine',
  'stockAdjustment',
  'journalLine',
  'journalVoucher',
  'ledgerAccount',
  // RFQ comparison (children first; Rfq references PurchaseRequisition)
  'supplierQuoteLine',
  'rfqSupplier',
  'supplierQuote',
  'rfqLine',
  'rfq',
  'deliveryChallanLine',
  'itemVendor',
  'lotGenealogy',
  'lotMovement',
  'partyAdvance',
  'paymentSchedule',
  'productionReceipt',
  'purchaseRequisitionLine',
  'qualityMeasurement',
  'refundAllocation',
  'returnDocumentLine',
  'salesQuotationLine',
  'serialNumber',
  'deliveryChallan',
  'inventoryLot',
  'qualityInspection',
  'qualityParameter',
  'returnDocument',
  'salesOrderLine',
  'goodsReceiptLine',
  'qualityTemplate',
  'salesOrder',
  'goodsReceipt',
  'purchaseOrderLine',
  'salesQuotation',
  'purchaseOrder',
  'purchaseRequisition',
  // masters referenced by legacy tables too (SalesInvoice.salespersonId,
  // Payment.tdsSectionId): restored early, before the legacy invoices/payments
  'salesperson',
  'tdsSection',
  // work centres last: routing operations, tasks and calendars point at them
  'workCenter',
] as const

export type WorkflowModel = (typeof WORKFLOW_MODELS_CHILDREN_FIRST)[number]

/** Workflow masters that legacy rows point at: inserted right after parties/items, before invoices and payments. */
export const EARLY_RESTORE_MODELS = ['salesperson', 'tdsSection'] as const satisfies readonly WorkflowModel[]

export const WORKFLOW_MODELS_PARENTS_FIRST = [...WORKFLOW_MODELS_CHILDREN_FIRST].reverse().filter((m) => !(EARLY_RESTORE_MODELS as readonly string[]).includes(m))

/** Minimal delegate surface the backup/restore/seed code needs, model-agnostic. */
export interface TableDelegate {
  findMany(args?: unknown): Promise<unknown[]>
  deleteMany(args?: unknown): Promise<unknown>
  createMany(args: { data: unknown }): Promise<unknown>
  count(args?: unknown): Promise<number>
}

/** Index a Prisma client / transaction by model accessor name. */
export function delegate(client: unknown, model: WorkflowModel): TableDelegate {
  return (client as Record<string, TableDelegate>)[model]
}
