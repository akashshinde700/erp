-- Finance reversal controls, concurrency-safe refunds, idempotency keys and
-- active-only supplier document uniqueness.
--
-- Hand-staged (reviewed 2026-11-08). The SQL Prisma generated for this change
-- dropped GoodsReceipt_companyId_fkey without re-adding it and tried to re-add an
-- existing PurchaseOrderLine FK, so it was NOT used. Order here:
--   1. additive columns / table (nullable or defaulted -> safe on existing rows)
--   2. deterministic backfill from existing rows
--   3. new indexes BEFORE dropping the old unique keys, so the company/party
--      foreign keys always keep a supporting index (no FK is dropped)
-- Every step is additive or replaces a unique key with a strictly narrower one
-- that is unique by construction (see stage 3 notes); no row data is deleted.

-- ---------------------------------------------------------------- stage 1
ALTER TABLE `ReturnDocument` ADD COLUMN `refundedAmount` DOUBLE NOT NULL DEFAULT 0;

ALTER TABLE `PaymentAllocation`
    ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'PAYMENT',
    ADD COLUMN `reversedAt` DATETIME(3) NULL,
    ADD COLUMN `reversalReason` TEXT NULL;

ALTER TABLE `PurchaseInvoice` ADD COLUMN `activeSupplierInvoiceNo` VARCHAR(191) NULL;

ALTER TABLE `GoodsReceipt` ADD COLUMN `supplierDocKey` VARCHAR(191) NULL;

CREATE TABLE `IdempotencyKey` (
    `id` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'IN_PROGRESS',
    `statusCode` INTEGER NULL,
    `responseBody` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IdempotencyKey_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- stage 2
-- Refund running total = sum of refunds whose payment is still POSTED.
UPDATE `ReturnDocument` d
   SET d.`refundedAmount` = COALESCE((
         SELECT ROUND(SUM(r.`amount`), 2)
           FROM `RefundAllocation` r
           JOIN `Payment` p ON p.`id` = r.`paymentId` AND p.`status` = 'POSTED'
          WHERE r.`returnDocumentId` = d.`id`), 0);

-- Allocations created after the payment by applying an advance. Before this
-- migration such rows were indistinguishable by column, but an allocation on a
-- payment that owns a PartyAdvance can only have been created at posting time
-- for the ALLOCATED part; applications were added later. Rows are left as
-- PAYMENT (no reversal offered for pre-migration applications) — documented in
-- docs/MIGRATION_RUNBOOK.md. Nothing to backfill for `kind`.

-- Active supplier invoice number = the number while the invoice is not cancelled.
UPDATE `PurchaseInvoice`
   SET `activeSupplierInvoiceNo` = `supplierInvoiceNo`
 WHERE `status` <> 'CANCELLED' AND `supplierInvoiceNo` IS NOT NULL;

-- Supplier challan key = "<supplierId>:<supplierDocNo>" while the GRN is active.
UPDATE `GoodsReceipt` g
  JOIN `PurchaseOrder` po ON po.`id` = g.`purchaseOrderId`
   SET g.`supplierDocKey` = CONCAT(po.`supplierId`, ':', g.`supplierDocNo`)
 WHERE g.`status` <> 'CANCELLED' AND g.`supplierDocNo` IS NOT NULL;

-- ---------------------------------------------------------------- stage 3
-- The old keys (companyId, supplierDocNo) and (partyId, supplierInvoiceNo) were
-- unique, so their active subsets backfilled above are unique too: these
-- CREATE UNIQUE INDEX statements cannot fail on existing data.
CREATE INDEX `GoodsReceipt_companyId_supplierDocNo_idx` ON `GoodsReceipt`(`companyId`, `supplierDocNo`);
CREATE UNIQUE INDEX `GoodsReceipt_companyId_supplierDocKey_key` ON `GoodsReceipt`(`companyId`, `supplierDocKey`);
DROP INDEX `GoodsReceipt_companyId_supplierDocNo_key` ON `GoodsReceipt`;

CREATE INDEX `PurchaseInvoice_partyId_supplierInvoiceNo_idx` ON `PurchaseInvoice`(`partyId`, `supplierInvoiceNo`);
CREATE UNIQUE INDEX `PurchaseInvoice_partyId_activeSupplierInvoiceNo_key` ON `PurchaseInvoice`(`partyId`, `activeSupplierInvoiceNo`);
DROP INDEX `PurchaseInvoice_partyId_supplierInvoiceNo_key` ON `PurchaseInvoice`;
