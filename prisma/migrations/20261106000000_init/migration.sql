-- CreateTable
CREATE TABLE `Counter` (
    `key` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Company` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NULL,
    `gstin` VARCHAR(191) NULL,
    `stateCode` VARCHAR(191) NOT NULL DEFAULT '27',
    `address` TEXT NULL,
    `city` VARCHAR(191) NULL,
    `pincode` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `bankName` VARCHAR(191) NULL,
    `bankAcct` VARCHAR(191) NULL,
    `bankIfsc` VARCHAR(191) NULL,
    `upiId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tallyCompanyName` VARCHAR(191) NULL,
    `tallySalesLedger` VARCHAR(191) NULL,
    `tallyPurchaseLedger` VARCHAR(191) NULL,
    `tallyCgstLedger` VARCHAR(191) NULL,
    `tallySgstLedger` VARCHAR(191) NULL,
    `tallyIgstLedger` VARCHAR(191) NULL,
    `tallyRoundOffLedger` VARCHAR(191) NULL,
    `isPlatform` BOOLEAN NOT NULL DEFAULT false,
    `planId` VARCHAR(191) NULL,
    `saasStatus` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `billingCycle` VARCHAR(191) NOT NULL DEFAULT 'MONTHLY',
    `paidUntil` DATETIME(3) NULL,
    `trialEndsAt` DATETIME(3) NULL,
    `maxItems` INTEGER NULL,
    `maxWarehouses` INTEGER NULL,
    `maxParties` INTEGER NULL,

    UNIQUE INDEX `Company_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrgUser` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'OWNER',
    `companyId` VARCHAR(191) NOT NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastLoginAt` DATETIME(3) NULL,

    UNIQUE INDEX `OrgUser_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Plan` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `priceMonthly` DOUBLE NOT NULL DEFAULT 0,
    `priceYearly` DOUBLE NOT NULL DEFAULT 0,
    `maxItems` INTEGER NOT NULL DEFAULT 0,
    `maxWarehouses` INTEGER NOT NULL DEFAULT 0,
    `maxParties` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `features` VARCHAR(500) NOT NULL DEFAULT 'exportData,advancedReports',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Plan_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformInquiry` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'new',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlatformInquiry_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformInquiryFollowUp` (
    `id` VARCHAR(191) NOT NULL,
    `inquiryId` VARCHAR(191) NOT NULL,
    `note` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformBlogPost` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `excerpt` TEXT NULL,
    `body` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlatformBlogPost_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `details` TEXT NULL,
    `actor` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_entity_idx`(`entity`),
    INDEX `AuditLog_actor_idx`(`actor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Party` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `types` VARCHAR(191) NOT NULL DEFAULT 'CUSTOMER',
    `gstin` VARCHAR(191) NULL,
    `stateCode` VARCHAR(191) NOT NULL DEFAULT '27',
    `address` TEXT NULL,
    `city` VARCHAR(191) NULL,
    `pincode` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `openingBal` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Party_code_key`(`code`),
    INDEX `Party_types_idx`(`types`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Item` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `groupName` VARCHAR(191) NOT NULL DEFAULT 'General',
    `hsn` VARCHAR(191) NULL,
    `isService` BOOLEAN NOT NULL DEFAULT false,
    `isStockItem` BOOLEAN NOT NULL DEFAULT true,
    `uom` VARCHAR(191) NOT NULL DEFAULT 'PCS',
    `gstRate` DOUBLE NOT NULL DEFAULT 18,
    `saleRate` DOUBLE NOT NULL DEFAULT 0,
    `costRate` DOUBLE NOT NULL DEFAULT 0,
    `reorderLevel` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Item_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Warehouse` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Warehouse_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Process` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 0,
    `basis` VARCHAR(191) NOT NULL DEFAULT 'WEIGHT',
    `rate` DOUBLE NOT NULL DEFAULT 0,
    `lotCharge` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Process_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartyProcessRate` (
    `id` VARCHAR(191) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `processId` VARCHAR(191) NOT NULL,
    `rate` DOUBLE NOT NULL DEFAULT 0,
    `lotCharge` DOUBLE NOT NULL DEFAULT 0,

    UNIQUE INDEX `PartyProcessRate_partyId_processId_key`(`partyId`, `processId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockLedger` (
    `id` VARCHAR(191) NOT NULL,
    `postingDate` DATETIME(3) NOT NULL,
    `voucherType` VARCHAR(191) NOT NULL,
    `voucherNo` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `qtyIn` DOUBLE NOT NULL DEFAULT 0,
    `qtyOut` DOUBLE NOT NULL DEFAULT 0,
    `rate` DOUBLE NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,
    `isCancelled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockLedger_itemId_warehouseId_postingDate_idx`(`itemId`, `warehouseId`, `postingDate`),
    INDEX `StockLedger_voucherNo_idx`(`voucherNo`),
    INDEX `StockLedger_postingDate_idx`(`postingDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountLedger` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `account` VARCHAR(191) NOT NULL,
    `accountName` VARCHAR(191) NOT NULL,
    `partyId` VARCHAR(191) NULL,
    `debit` DOUBLE NOT NULL DEFAULT 0,
    `credit` DOUBLE NOT NULL DEFAULT 0,
    `voucherType` VARCHAR(191) NOT NULL,
    `voucherNo` VARCHAR(191) NOT NULL,
    `remarks` TEXT NULL,
    `isCancelled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccountLedger_account_date_idx`(`account`, `date`),
    INDEX `AccountLedger_voucherNo_idx`(`voucherNo`),
    INDEX `AccountLedger_partyId_isCancelled_idx`(`partyId`, `isCancelled`),
    INDEX `AccountLedger_voucherType_partyId_idx`(`voucherType`, `partyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `poNo` VARCHAR(191) NULL,
    `pos` VARCHAR(191) NOT NULL DEFAULT '27',
    `interState` BOOLEAN NOT NULL DEFAULT false,
    `taxInclusive` BOOLEAN NOT NULL DEFAULT false,
    `taxable` DOUBLE NOT NULL DEFAULT 0,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `roundOff` DOUBLE NOT NULL DEFAULT 0,
    `grandTotal` DOUBLE NOT NULL DEFAULT 0,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
    `source` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tallyExportedAt` DATETIME(3) NULL,
    `tallySentAt` DATETIME(3) NULL,

    UNIQUE INDEX `SalesInvoice_invoiceNo_key`(`invoiceNo`),
    INDEX `SalesInvoice_partyId_idx`(`partyId`),
    INDEX `SalesInvoice_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesInvoiceItem` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `detail` TEXT NULL,
    `hsn` VARCHAR(191) NULL,
    `uom` VARCHAR(191) NOT NULL,
    `qty` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `discPct` DOUBLE NOT NULL DEFAULT 0,
    `discAmt` DOUBLE NOT NULL DEFAULT 0,
    `taxable` DOUBLE NOT NULL,
    `gstRate` DOUBLE NOT NULL,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `total` DOUBLE NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `poNo` VARCHAR(191) NULL,
    `interState` BOOLEAN NOT NULL DEFAULT false,
    `taxInclusive` BOOLEAN NOT NULL DEFAULT false,
    `taxable` DOUBLE NOT NULL DEFAULT 0,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `roundOff` DOUBLE NOT NULL DEFAULT 0,
    `grandTotal` DOUBLE NOT NULL DEFAULT 0,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `tallyExportedAt` DATETIME(3) NULL,
    `tallySentAt` DATETIME(3) NULL,

    UNIQUE INDEX `PurchaseInvoice_invoiceNo_key`(`invoiceNo`),
    INDEX `PurchaseInvoice_partyId_idx`(`partyId`),
    INDEX `PurchaseInvoice_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseInvoiceItem` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `detail` TEXT NULL,
    `hsn` VARCHAR(191) NULL,
    `uom` VARCHAR(191) NOT NULL,
    `qty` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `discPct` DOUBLE NOT NULL DEFAULT 0,
    `discAmt` DOUBLE NOT NULL DEFAULT 0,
    `taxable` DOUBLE NOT NULL,
    `gstRate` DOUBLE NOT NULL,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `total` DOUBLE NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobworkInward` (
    `id` VARCHAR(191) NOT NULL,
    `inwardNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `challanNo` VARCHAR(191) NULL,
    `warehouseId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `JobworkInward_inwardNo_key`(`inwardNo`),
    INDEX `JobworkInward_partyId_idx`(`partyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobworkInwardItem` (
    `id` VARCHAR(191) NOT NULL,
    `inwardId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `batchNo` VARCHAR(191) NULL,
    `qty` DOUBLE NOT NULL,
    `weight` DOUBLE NOT NULL,
    `processedQty` DOUBLE NOT NULL DEFAULT 0,
    `processedWeight` DOUBLE NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobCard` (
    `id` VARCHAR(191) NOT NULL,
    `cardNo` VARCHAR(191) NOT NULL,
    `inwardId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'COMPLETED',
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `JobCard_cardNo_key`(`cardNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobCardProcess` (
    `id` VARCHAR(191) NOT NULL,
    `jobCardId` VARCHAR(191) NOT NULL,
    `processId` VARCHAR(191) NOT NULL,
    `inwardItemId` VARCHAR(191) NOT NULL,
    `qty` DOUBLE NOT NULL,
    `weight` DOUBLE NOT NULL,
    `basis` VARCHAR(191) NOT NULL,
    `rate` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `lotCharge` DOUBLE NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JobworkCertificate` (
    `id` VARCHAR(191) NOT NULL,
    `certNo` VARCHAR(191) NOT NULL,
    `inwardId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `totalQty` DOUBLE NOT NULL DEFAULT 0,
    `totalWeight` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ISSUED',
    `details` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `JobworkCertificate_certNo_key`(`certNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Employee` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'WORKER',
    `skill` VARCHAR(191) NULL,
    `machineNo` VARCHAR(191) NULL,
    `shift` VARCHAR(191) NOT NULL DEFAULT 'GENERAL',
    `hourlyRate` DOUBLE NOT NULL DEFAULT 0,
    `phone` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Employee_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Project` (
    `id` VARCHAR(191) NOT NULL,
    `projectNo` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `manager` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `budget` DOUBLE NOT NULL DEFAULT 0,
    `estCost` DOUBLE NOT NULL DEFAULT 0,
    `documents` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `completedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Project_projectNo_key`(`projectNo`),
    INDEX `Project_partyId_idx`(`partyId`),
    INDEX `Project_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Bom` (
    `id` VARCHAR(191) NOT NULL,
    `bomNo` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `drawingRef` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `approvedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Bom_bomNo_key`(`bomNo`),
    INDEX `Bom_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BomItem` (
    `id` VARCHAR(191) NOT NULL,
    `bomId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `grade` VARCHAR(191) NULL,
    `thickness` DOUBLE NOT NULL DEFAULT 0,
    `length` DOUBLE NOT NULL DEFAULT 0,
    `width` DOUBLE NOT NULL DEFAULT 0,
    `qty` DOUBLE NOT NULL,
    `uom` VARCHAR(191) NOT NULL,
    `wastagePct` DOUBLE NOT NULL DEFAULT 0,
    `rate` DOUBLE NOT NULL DEFAULT 0,
    `estCost` DOUBLE NOT NULL DEFAULT 0,
    `drawingRef` VARCHAR(191) NULL,
    `remarks` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkOrder` (
    `id` VARCHAR(191) NOT NULL,
    `woNo` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `bomId` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `completedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WorkOrder_woNo_key`(`woNo`),
    INDEX `WorkOrder_projectId_idx`(`projectId`),
    INDEX `WorkOrder_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkOrderLine` (
    `id` VARCHAR(191) NOT NULL,
    `workOrderId` VARCHAR(191) NOT NULL,
    `bomItemId` VARCHAR(191) NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `plannedQty` DOUBLE NOT NULL,
    `uom` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductionTask` (
    `id` VARCHAR(191) NOT NULL,
    `taskNo` VARCHAR(191) NOT NULL,
    `workOrderId` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 0,
    `operation` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NULL,
    `machineNo` VARCHAR(191) NULL,
    `plannedQty` DOUBLE NOT NULL,
    `actualQty` DOUBLE NOT NULL DEFAULT 0,
    `rejectionQty` DOUBLE NOT NULL DEFAULT 0,
    `hours` DOUBLE NOT NULL DEFAULT 0,
    `labourRate` DOUBLE NOT NULL DEFAULT 0,
    `labourCost` DOUBLE NOT NULL DEFAULT 0,
    `materialItemId` VARCHAR(191) NULL,
    `materialQty` DOUBLE NOT NULL DEFAULT 0,
    `materialCost` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `dueDate` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductionTask_taskNo_key`(`taskNo`),
    INDEX `ProductionTask_workOrderId_idx`(`workOrderId`),
    INDEX `ProductionTask_status_idx`(`status`),
    INDEX `ProductionTask_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `paymentNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'CASH',
    `refNo` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Payment_paymentNo_key`(`paymentNo`),
    INDEX `Payment_partyId_idx`(`partyId`),
    INDEX `Payment_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `invoiceType` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NULL,
    `invoiceNo` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,

    INDEX `PaymentAllocation_paymentId_idx`(`paymentId`),
    INDEX `PaymentAllocation_invoiceNo_idx`(`invoiceNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Company` ADD CONSTRAINT `Company_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrgUser` ADD CONSTRAINT `OrgUser_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformInquiryFollowUp` ADD CONSTRAINT `PlatformInquiryFollowUp_inquiryId_fkey` FOREIGN KEY (`inquiryId`) REFERENCES `PlatformInquiry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartyProcessRate` ADD CONSTRAINT `PartyProcessRate_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartyProcessRate` ADD CONSTRAINT `PartyProcessRate_processId_fkey` FOREIGN KEY (`processId`) REFERENCES `Process`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockLedger` ADD CONSTRAINT `StockLedger_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockLedger` ADD CONSTRAINT `StockLedger_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesInvoice` ADD CONSTRAINT `SalesInvoice_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesInvoiceItem` ADD CONSTRAINT `SalesInvoiceItem_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `SalesInvoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesInvoiceItem` ADD CONSTRAINT `SalesInvoiceItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseInvoice` ADD CONSTRAINT `PurchaseInvoice_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseInvoiceItem` ADD CONSTRAINT `PurchaseInvoiceItem_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `PurchaseInvoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseInvoiceItem` ADD CONSTRAINT `PurchaseInvoiceItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobworkInward` ADD CONSTRAINT `JobworkInward_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobworkInwardItem` ADD CONSTRAINT `JobworkInwardItem_inwardId_fkey` FOREIGN KEY (`inwardId`) REFERENCES `JobworkInward`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobworkInwardItem` ADD CONSTRAINT `JobworkInwardItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobCard` ADD CONSTRAINT `JobCard_inwardId_fkey` FOREIGN KEY (`inwardId`) REFERENCES `JobworkInward`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobCardProcess` ADD CONSTRAINT `JobCardProcess_jobCardId_fkey` FOREIGN KEY (`jobCardId`) REFERENCES `JobCard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobCardProcess` ADD CONSTRAINT `JobCardProcess_processId_fkey` FOREIGN KEY (`processId`) REFERENCES `Process`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobCardProcess` ADD CONSTRAINT `JobCardProcess_inwardItemId_fkey` FOREIGN KEY (`inwardItemId`) REFERENCES `JobworkInwardItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobworkCertificate` ADD CONSTRAINT `JobworkCertificate_inwardId_fkey` FOREIGN KEY (`inwardId`) REFERENCES `JobworkInward`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bom` ADD CONSTRAINT `Bom_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BomItem` ADD CONSTRAINT `BomItem_bomId_fkey` FOREIGN KEY (`bomId`) REFERENCES `Bom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BomItem` ADD CONSTRAINT `BomItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_bomId_fkey` FOREIGN KEY (`bomId`) REFERENCES `Bom`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkOrderLine` ADD CONSTRAINT `WorkOrderLine_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkOrderLine` ADD CONSTRAINT `WorkOrderLine_bomItemId_fkey` FOREIGN KEY (`bomItemId`) REFERENCES `BomItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkOrderLine` ADD CONSTRAINT `WorkOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionTask` ADD CONSTRAINT `ProductionTask_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionTask` ADD CONSTRAINT `ProductionTask_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionTask` ADD CONSTRAINT `ProductionTask_materialItemId_fkey` FOREIGN KEY (`materialItemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentAllocation` ADD CONSTRAINT `PaymentAllocation_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

