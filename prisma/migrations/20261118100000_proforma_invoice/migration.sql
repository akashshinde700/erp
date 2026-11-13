-- Proforma invoice (PI): priced, GST-computed offer before the sale. Posts nothing
-- (no stock, no GL). Additive: two new tables, nothing existing changes.
-- CreateTable
CREATE TABLE `ProformaInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `piNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `salesOrderId` VARCHAR(191) NULL,
    `placeOfSupply` VARCHAR(191) NOT NULL,
    `interState` BOOLEAN NOT NULL DEFAULT false,
    `taxable` DOUBLE NOT NULL DEFAULT 0,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `roundOff` DOUBLE NOT NULL DEFAULT 0,
    `grandTotal` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ISSUED',
    `convertedInvoiceId` VARCHAR(191) NULL,
    `terms` TEXT NULL,
    `cancelReason` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProformaInvoice_companyId_status_date_idx`(`companyId`, `status`, `date`),
    INDEX `ProformaInvoice_partyId_idx`(`partyId`),
    UNIQUE INDEX `ProformaInvoice_companyId_piNo_key`(`companyId`, `piNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProformaInvoiceLine` (
    `id` VARCHAR(191) NOT NULL,
    `proformaId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `hsn` VARCHAR(191) NULL,
    `uom` VARCHAR(191) NOT NULL,
    `qty` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `discPct` DOUBLE NOT NULL DEFAULT 0,
    `gstRate` DOUBLE NOT NULL,
    `taxable` DOUBLE NOT NULL,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `total` DOUBLE NOT NULL,

    INDEX `ProformaInvoiceLine_proformaId_idx`(`proformaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProformaInvoice` ADD CONSTRAINT `ProformaInvoice_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProformaInvoice` ADD CONSTRAINT `ProformaInvoice_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProformaInvoice` ADD CONSTRAINT `ProformaInvoice_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProformaInvoiceLine` ADD CONSTRAINT `ProformaInvoiceLine_proformaId_fkey` FOREIGN KEY (`proformaId`) REFERENCES `ProformaInvoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProformaInvoiceLine` ADD CONSTRAINT `ProformaInvoiceLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

