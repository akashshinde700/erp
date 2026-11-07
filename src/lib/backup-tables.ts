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
] as const

export type WorkflowModel = (typeof WORKFLOW_MODELS_CHILDREN_FIRST)[number]

export const WORKFLOW_MODELS_PARENTS_FIRST = [...WORKFLOW_MODELS_CHILDREN_FIRST].reverse()

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
