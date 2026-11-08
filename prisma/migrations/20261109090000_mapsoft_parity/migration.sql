-- MapSoft parity: books lock, ledger accounts, journal vouchers, TDS, stock
-- adjustments with approval, salespersons, leads, service calls.
-- Additive only: new nullable / defaulted columns and new tables.

-- AlterTable
ALTER TABLE `Company` ADD COLUMN `booksLockedBy` VARCHAR(191) NULL,
    ADD COLUMN `booksLockedUntil` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Party` ADD COLUMN `creditDays` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Payment` ADD COLUMN `tdsAmount` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `tdsSectionId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SalesInvoice` ADD COLUMN `salespersonId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SalesOrder` ADD COLUMN `salespersonId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SalesQuotation` ADD COLUMN `salespersonId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `LedgerAccount` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `group` VARCHAR(191) NOT NULL,
    `nature` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LedgerAccount_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalVoucher` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `voucherNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `narration` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
    `total` DOUBLE NOT NULL DEFAULT 0,
    `cancelReason` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `cancelledBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `JournalVoucher_companyId_date_idx`(`companyId`, `date`),
    UNIQUE INDEX `JournalVoucher_companyId_voucherNo_key`(`companyId`, `voucherNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalLine` (
    `id` VARCHAR(191) NOT NULL,
    `journalId` VARCHAR(191) NOT NULL,
    `account` VARCHAR(191) NOT NULL,
    `accountName` VARCHAR(191) NOT NULL,
    `partyId` VARCHAR(191) NULL,
    `debit` DOUBLE NOT NULL DEFAULT 0,
    `credit` DOUBLE NOT NULL DEFAULT 0,
    `remarks` VARCHAR(191) NULL,

    INDEX `JournalLine_journalId_idx`(`journalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TdsSection` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `section` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `ratePct` DOUBLE NOT NULL,
    `thresholdSingle` DOUBLE NOT NULL DEFAULT 0,
    `thresholdAnnual` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TdsSection_companyId_section_key`(`companyId`, `section`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockAdjustment` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `adjNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `reasonCode` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `value` DOUBLE NOT NULL DEFAULT 0,
    `requestedBy` VARCHAR(191) NULL,
    `decidedBy` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `cancelReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockAdjustment_companyId_status_date_idx`(`companyId`, `status`, `date`),
    UNIQUE INDEX `StockAdjustment_companyId_adjNo_key`(`companyId`, `adjNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockAdjustmentLine` (
    `id` VARCHAR(191) NOT NULL,
    `adjustmentId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `qtyChange` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL DEFAULT 0,
    `value` DOUBLE NOT NULL DEFAULT 0,

    INDEX `StockAdjustmentLine_adjustmentId_idx`(`adjustmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Salesperson` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `monthlyTarget` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Salesperson_companyId_code_key`(`companyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lead` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `leadNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `contactName` VARCHAR(191) NOT NULL,
    `organisation` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `stateCode` VARCHAR(191) NULL,
    `gstin` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'OTHER',
    `status` VARCHAR(191) NOT NULL DEFAULT 'NEW',
    `requirement` TEXT NULL,
    `expectedValue` DOUBLE NOT NULL DEFAULT 0,
    `probability` INTEGER NOT NULL DEFAULT 10,
    `expectedCloseDate` DATETIME(3) NULL,
    `nextFollowUpAt` DATETIME(3) NULL,
    `salespersonId` VARCHAR(191) NULL,
    `partyId` VARCHAR(191) NULL,
    `lostReason` TEXT NULL,
    `closedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Lead_companyId_status_idx`(`companyId`, `status`),
    INDEX `Lead_companyId_nextFollowUpAt_idx`(`companyId`, `nextFollowUpAt`),
    UNIQUE INDEX `Lead_companyId_leadNo_key`(`companyId`, `leadNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadActivity` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `notes` TEXT NOT NULL,
    `dueAt` DATETIME(3) NULL,
    `doneAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LeadActivity_leadId_idx`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceCall` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `callNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `serialNo` VARCHAR(191) NULL,
    `complaint` TEXT NOT NULL,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'MEDIUM',
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `underWarranty` BOOLEAN NOT NULL DEFAULT false,
    `assignedToId` VARCHAR(191) NULL,
    `dueAt` DATETIME(3) NULL,
    `resolution` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `serviceCharge` DOUBLE NOT NULL DEFAULT 0,
    `salesInvoiceId` VARCHAR(191) NULL,
    `cancelReason` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ServiceCall_companyId_status_idx`(`companyId`, `status`),
    INDEX `ServiceCall_partyId_idx`(`partyId`),
    UNIQUE INDEX `ServiceCall_companyId_callNo_key`(`companyId`, `callNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SalesInvoice` ADD CONSTRAINT `SalesInvoice_salespersonId_fkey` FOREIGN KEY (`salespersonId`) REFERENCES `Salesperson`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotation` ADD CONSTRAINT `SalesQuotation_salespersonId_fkey` FOREIGN KEY (`salespersonId`) REFERENCES `Salesperson`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_salespersonId_fkey` FOREIGN KEY (`salespersonId`) REFERENCES `Salesperson`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_tdsSectionId_fkey` FOREIGN KEY (`tdsSectionId`) REFERENCES `TdsSection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LedgerAccount` ADD CONSTRAINT `LedgerAccount_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalVoucher` ADD CONSTRAINT `JournalVoucher_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalLine` ADD CONSTRAINT `JournalLine_journalId_fkey` FOREIGN KEY (`journalId`) REFERENCES `JournalVoucher`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TdsSection` ADD CONSTRAINT `TdsSection_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockAdjustment` ADD CONSTRAINT `StockAdjustment_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockAdjustment` ADD CONSTRAINT `StockAdjustment_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockAdjustmentLine` ADD CONSTRAINT `StockAdjustmentLine_adjustmentId_fkey` FOREIGN KEY (`adjustmentId`) REFERENCES `StockAdjustment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockAdjustmentLine` ADD CONSTRAINT `StockAdjustmentLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Salesperson` ADD CONSTRAINT `Salesperson_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_salespersonId_fkey` FOREIGN KEY (`salespersonId`) REFERENCES `Salesperson`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lead` ADD CONSTRAINT `Lead_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadActivity` ADD CONSTRAINT `LeadActivity_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceCall` ADD CONSTRAINT `ServiceCall_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceCall` ADD CONSTRAINT `ServiceCall_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceCall` ADD CONSTRAINT `ServiceCall_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceCall` ADD CONSTRAINT `ServiceCall_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

