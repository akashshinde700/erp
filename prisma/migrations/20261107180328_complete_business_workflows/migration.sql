-- AlterTable
ALTER TABLE `Party` ADD COLUMN `creditLimit` DOUBLE NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `SalesInvoice` ADD COLUMN `deliveryChallanId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SalesInvoiceItem` ADD COLUMN `deliveryChallanLineId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PurchaseInvoice` ADD COLUMN `goodsReceiptId` VARCHAR(191) NULL,
    ADD COLUMN `supplierInvoiceNo` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PurchaseInvoiceItem` ADD COLUMN `goodsReceiptLineId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `InventoryLot` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `lotNo` VARCHAR(191) NOT NULL,
    `manufactureDate` DATETIME(3) NULL,
    `expiryDate` DATETIME(3) NULL,
    `supplierLotNo` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'AVAILABLE',
    `sourceType` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InventoryLot_companyId_status_expiryDate_idx`(`companyId`, `status`, `expiryDate`),
    INDEX `InventoryLot_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    UNIQUE INDEX `InventoryLot_companyId_itemId_warehouseId_lotNo_key`(`companyId`, `itemId`, `warehouseId`, `lotNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SerialNumber` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NULL,
    `lotId` VARCHAR(191) NULL,
    `serialNo` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'AVAILABLE',
    `sourceType` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `issuedToType` VARCHAR(191) NULL,
    `issuedToId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SerialNumber_companyId_status_idx`(`companyId`, `status`),
    INDEX `SerialNumber_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    UNIQUE INDEX `SerialNumber_companyId_itemId_serialNo_key`(`companyId`, `itemId`, `serialNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LotMovement` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `lotId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `postingDate` DATETIME(3) NOT NULL,
    `movementType` VARCHAR(191) NOT NULL,
    `qtyIn` DOUBLE NOT NULL DEFAULT 0,
    `qtyOut` DOUBLE NOT NULL DEFAULT 0,
    `voucherType` VARCHAR(191) NOT NULL,
    `voucherNo` VARCHAR(191) NOT NULL,
    `referenceId` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `isCancelled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LotMovement_lotId_postingDate_idx`(`lotId`, `postingDate`),
    INDEX `LotMovement_companyId_itemId_warehouseId_idx`(`companyId`, `itemId`, `warehouseId`),
    INDEX `LotMovement_voucherType_voucherNo_idx`(`voucherType`, `voucherNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LotGenealogy` (
    `id` VARCHAR(191) NOT NULL,
    `parentLotId` VARCHAR(191) NOT NULL,
    `childLotId` VARCHAR(191) NOT NULL,
    `consumedQty` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LotGenealogy_childLotId_idx`(`childLotId`),
    UNIQUE INDEX `LotGenealogy_parentLotId_childLotId_key`(`parentLotId`, `childLotId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductionReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `receiptNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `workOrderId` VARCHAR(191) NOT NULL,
    `outputItemId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `batchNo` VARCHAR(191) NULL,
    `manufacturedAt` DATETIME(3) NULL,
    `expiryDate` DATETIME(3) NULL,
    `producedQty` DOUBLE NOT NULL,
    `acceptedQty` DOUBLE NOT NULL,
    `rejectedQty` DOUBLE NOT NULL DEFAULT 0,
    `reworkQty` DOUBLE NOT NULL DEFAULT 0,
    `scrapQty` DOUBLE NOT NULL DEFAULT 0,
    `qcStatus` VARCHAR(191) NOT NULL,
    `qcNotes` TEXT NULL,
    `expectedCost` DOUBLE NOT NULL DEFAULT 0,
    `actualCost` DOUBLE NOT NULL DEFAULT 0,
    `variance` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
    `postedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cancelledAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductionReceipt_companyId_status_date_idx`(`companyId`, `status`, `date`),
    INDEX `ProductionReceipt_workOrderId_idx`(`workOrderId`),
    INDEX `ProductionReceipt_outputItemId_batchNo_idx`(`outputItemId`, `batchNo`),
    UNIQUE INDEX `ProductionReceipt_companyId_receiptNo_key`(`companyId`, `receiptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseRequisition` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `reqNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `requiredBy` DATETIME(3) NULL,
    `department` VARCHAR(191) NULL,
    `purpose` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseRequisition_companyId_status_date_idx`(`companyId`, `status`, `date`),
    UNIQUE INDEX `PurchaseRequisition_companyId_reqNo_key`(`companyId`, `reqNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseRequisitionLine` (
    `id` VARCHAR(191) NOT NULL,
    `requisitionId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `qty` DOUBLE NOT NULL,
    `orderedQty` DOUBLE NOT NULL DEFAULT 0,
    `uom` VARCHAR(191) NOT NULL,
    `estimatedRate` DOUBLE NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,

    INDEX `PurchaseRequisitionLine_requisitionId_idx`(`requisitionId`),
    INDEX `PurchaseRequisitionLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrder` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `poNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `requisitionId` VARCHAR(191) NULL,
    `expectedDate` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `taxInclusive` BOOLEAN NOT NULL DEFAULT false,
    `overReceiptPct` DOUBLE NOT NULL DEFAULT 0,
    `subtotal` DOUBLE NOT NULL DEFAULT 0,
    `taxAmount` DOUBLE NOT NULL DEFAULT 0,
    `grandTotal` DOUBLE NOT NULL DEFAULT 0,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `terms` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseOrder_companyId_status_date_idx`(`companyId`, `status`, `date`),
    INDEX `PurchaseOrder_supplierId_idx`(`supplierId`),
    UNIQUE INDEX `PurchaseOrder_companyId_poNo_key`(`companyId`, `poNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrderLine` (
    `id` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `qty` DOUBLE NOT NULL,
    `receivedQty` DOUBLE NOT NULL DEFAULT 0,
    `acceptedQty` DOUBLE NOT NULL DEFAULT 0,
    `rejectedQty` DOUBLE NOT NULL DEFAULT 0,
    `billedQty` DOUBLE NOT NULL DEFAULT 0,
    `uom` VARCHAR(191) NOT NULL,
    `rate` DOUBLE NOT NULL,
    `gstRate` DOUBLE NOT NULL,
    `discountPct` DOUBLE NOT NULL DEFAULT 0,
    `amount` DOUBLE NOT NULL,
    `remarks` TEXT NULL,

    INDEX `PurchaseOrderLine_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `PurchaseOrderLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoodsReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `grnNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `supplierDocNo` VARCHAR(191) NULL,
    `supplierDocDate` DATETIME(3) NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_QC',
    `remarks` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `postedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GoodsReceipt_companyId_status_date_idx`(`companyId`, `status`, `date`),
    INDEX `GoodsReceipt_purchaseOrderId_idx`(`purchaseOrderId`),
    UNIQUE INDEX `GoodsReceipt_companyId_grnNo_key`(`companyId`, `grnNo`),
    UNIQUE INDEX `GoodsReceipt_companyId_supplierDocNo_key`(`companyId`, `supplierDocNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoodsReceiptLine` (
    `id` VARCHAR(191) NOT NULL,
    `goodsReceiptId` VARCHAR(191) NOT NULL,
    `purchaseOrderLineId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `receivedQty` DOUBLE NOT NULL,
    `acceptedQty` DOUBLE NOT NULL DEFAULT 0,
    `rejectedQty` DOUBLE NOT NULL DEFAULT 0,
    `billedQty` DOUBLE NOT NULL DEFAULT 0,
    `batchNo` VARCHAR(191) NULL,
    `manufactureDate` DATETIME(3) NULL,
    `expiryDate` DATETIME(3) NULL,
    `qcStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `rejectionReason` TEXT NULL,

    INDEX `GoodsReceiptLine_purchaseOrderLineId_idx`(`purchaseOrderLineId`),
    INDEX `GoodsReceiptLine_itemId_batchNo_idx`(`itemId`, `batchNo`),
    UNIQUE INDEX `GoodsReceiptLine_goodsReceiptId_purchaseOrderLineId_key`(`goodsReceiptId`, `purchaseOrderLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `inspectionType` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `QualityTemplate_companyId_inspectionType_itemId_active_idx`(`companyId`, `inspectionType`, `itemId`, `active`),
    UNIQUE INDEX `QualityTemplate_companyId_code_version_key`(`companyId`, `code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityParameter` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `dataType` VARCHAR(191) NOT NULL DEFAULT 'NUMBER',
    `unit` VARCHAR(191) NULL,
    `minValue` DOUBLE NULL,
    `maxValue` DOUBLE NULL,
    `expectedText` VARCHAR(191) NULL,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `seq` INTEGER NOT NULL DEFAULT 0,

    INDEX `QualityParameter_templateId_seq_idx`(`templateId`, `seq`),
    UNIQUE INDEX `QualityParameter_templateId_name_key`(`templateId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityInspection` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `inspectionNo` VARCHAR(191) NOT NULL,
    `inspectionType` VARCHAR(191) NOT NULL,
    `referenceType` VARCHAR(191) NOT NULL,
    `referenceId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NULL,
    `itemId` VARCHAR(191) NULL,
    `goodsReceiptId` VARCHAR(191) NULL,
    `goodsReceiptLineId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `inspectedBy` VARCHAR(191) NULL,
    `inspectedAt` DATETIME(3) NULL,
    `disposition` VARCHAR(191) NULL,
    `resultsJson` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `QualityInspection_companyId_referenceType_referenceId_idx`(`companyId`, `referenceType`, `referenceId`),
    UNIQUE INDEX `QualityInspection_companyId_inspectionNo_key`(`companyId`, `inspectionNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityMeasurement` (
    `id` VARCHAR(191) NOT NULL,
    `inspectionId` VARCHAR(191) NOT NULL,
    `parameterId` VARCHAR(191) NOT NULL,
    `numberValue` DOUBLE NULL,
    `textValue` TEXT NULL,
    `booleanValue` BOOLEAN NULL,
    `passed` BOOLEAN NOT NULL,
    `remarks` TEXT NULL,

    INDEX `QualityMeasurement_parameterId_idx`(`parameterId`),
    UNIQUE INDEX `QualityMeasurement_inspectionId_parameterId_key`(`inspectionId`, `parameterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemVendor` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `supplierSku` VARCHAR(191) NULL,
    `lastRate` DOUBLE NOT NULL DEFAULT 0,
    `leadTimeDays` INTEGER NOT NULL DEFAULT 0,
    `minOrderQty` DOUBLE NOT NULL DEFAULT 0,
    `preferred` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ItemVendor_supplierId_idx`(`supplierId`),
    UNIQUE INDEX `ItemVendor_companyId_itemId_supplierId_key`(`companyId`, `itemId`, `supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesQuotation` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `quotationNo` VARCHAR(191) NOT NULL,
    `revisionNo` INTEGER NOT NULL DEFAULT 1,
    `supersedesId` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `taxable` DOUBLE NOT NULL DEFAULT 0,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `grandTotal` DOUBLE NOT NULL DEFAULT 0,
    `terms` TEXT NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SalesQuotation_companyId_status_date_idx`(`companyId`, `status`, `date`),
    INDEX `SalesQuotation_partyId_idx`(`partyId`),
    UNIQUE INDEX `SalesQuotation_companyId_quotationNo_revisionNo_key`(`companyId`, `quotationNo`, `revisionNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesQuotationLine` (
    `id` VARCHAR(191) NOT NULL,
    `quotationId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `qty` DOUBLE NOT NULL,
    `uom` VARCHAR(191) NOT NULL,
    `rate` DOUBLE NOT NULL,
    `discountPct` DOUBLE NOT NULL DEFAULT 0,
    `gstRate` DOUBLE NOT NULL,
    `taxable` DOUBLE NOT NULL,
    `total` DOUBLE NOT NULL,
    `remarks` TEXT NULL,

    INDEX `SalesQuotationLine_quotationId_idx`(`quotationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOrder` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `deliveryDate` DATETIME(3) NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `quotationId` VARCHAR(191) NULL,
    `customerPoNo` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `taxable` DOUBLE NOT NULL DEFAULT 0,
    `taxAmount` DOUBLE NOT NULL DEFAULT 0,
    `grandTotal` DOUBLE NOT NULL DEFAULT 0,
    `creditApproved` BOOLEAN NOT NULL DEFAULT false,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SalesOrder_companyId_status_date_idx`(`companyId`, `status`, `date`),
    INDEX `SalesOrder_partyId_idx`(`partyId`),
    UNIQUE INDEX `SalesOrder_companyId_orderNo_key`(`companyId`, `orderNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOrderLine` (
    `id` VARCHAR(191) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `qty` DOUBLE NOT NULL,
    `reservedQty` DOUBLE NOT NULL DEFAULT 0,
    `dispatchedQty` DOUBLE NOT NULL DEFAULT 0,
    `invoicedQty` DOUBLE NOT NULL DEFAULT 0,
    `uom` VARCHAR(191) NOT NULL,
    `rate` DOUBLE NOT NULL,
    `gstRate` DOUBLE NOT NULL,
    `taxable` DOUBLE NOT NULL,
    `total` DOUBLE NOT NULL,
    `remarks` TEXT NULL,

    INDEX `SalesOrderLine_salesOrderId_idx`(`salesOrderId`),
    INDEX `SalesOrderLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryChallan` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `challanNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_QC',
    `vehicleNo` VARCHAR(191) NULL,
    `transporter` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeliveryChallan_companyId_status_date_idx`(`companyId`, `status`, `date`),
    INDEX `DeliveryChallan_salesOrderId_idx`(`salesOrderId`),
    UNIQUE INDEX `DeliveryChallan_companyId_challanNo_key`(`companyId`, `challanNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryChallanLine` (
    `id` VARCHAR(191) NOT NULL,
    `deliveryChallanId` VARCHAR(191) NOT NULL,
    `salesOrderLineId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `plannedQty` DOUBLE NOT NULL,
    `acceptedQty` DOUBLE NOT NULL DEFAULT 0,
    `rejectedQty` DOUBLE NOT NULL DEFAULT 0,
    `invoicedQty` DOUBLE NOT NULL DEFAULT 0,
    `qcStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `batchNo` VARCHAR(191) NULL,
    `qcNotes` TEXT NULL,

    INDEX `DeliveryChallanLine_salesOrderLineId_idx`(`salesOrderLineId`),
    UNIQUE INDEX `DeliveryChallanLine_deliveryChallanId_salesOrderLineId_key`(`deliveryChallanId`, `salesOrderLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnDocument` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `returnNo` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `returnType` VARCHAR(191) NOT NULL,
    `sourceInvoiceId` VARCHAR(191) NOT NULL,
    `sourceInvoiceNo` VARCHAR(191) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `qcStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `adjustmentType` VARCHAR(191) NOT NULL,
    `adjustmentNo` VARCHAR(191) NULL,
    `taxable` DOUBLE NOT NULL DEFAULT 0,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `grandTotal` DOUBLE NOT NULL DEFAULT 0,
    `reason` TEXT NOT NULL,
    `postedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReturnDocument_companyId_returnType_status_date_idx`(`companyId`, `returnType`, `status`, `date`),
    INDEX `ReturnDocument_sourceInvoiceId_idx`(`sourceInvoiceId`),
    UNIQUE INDEX `ReturnDocument_companyId_returnNo_key`(`companyId`, `returnNo`),
    UNIQUE INDEX `ReturnDocument_companyId_adjustmentNo_key`(`companyId`, `adjustmentNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnDocumentLine` (
    `id` VARCHAR(191) NOT NULL,
    `returnDocumentId` VARCHAR(191) NOT NULL,
    `sourceLineId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `requestedQty` DOUBLE NOT NULL,
    `acceptedQty` DOUBLE NOT NULL DEFAULT 0,
    `rejectedQty` DOUBLE NOT NULL DEFAULT 0,
    `rate` DOUBLE NOT NULL,
    `gstRate` DOUBLE NOT NULL,
    `taxable` DOUBLE NOT NULL,
    `cgst` DOUBLE NOT NULL DEFAULT 0,
    `sgst` DOUBLE NOT NULL DEFAULT 0,
    `igst` DOUBLE NOT NULL DEFAULT 0,
    `total` DOUBLE NOT NULL,
    `disposition` VARCHAR(191) NOT NULL,
    `batchNo` VARCHAR(191) NULL,
    `qcNotes` TEXT NULL,

    INDEX `ReturnDocumentLine_sourceLineId_idx`(`sourceLineId`),
    INDEX `ReturnDocumentLine_itemId_idx`(`itemId`),
    UNIQUE INDEX `ReturnDocumentLine_returnDocumentId_sourceLineId_key`(`returnDocumentId`, `sourceLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `milestone` VARCHAR(191) NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentSchedule_companyId_dueDate_status_idx`(`companyId`, `dueDate`, `status`),
    INDEX `PaymentSchedule_partyId_idx`(`partyId`),
    UNIQUE INDEX `PaymentSchedule_salesOrderId_milestone_key`(`salesOrderId`, `milestone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PartyAdvance` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `partyId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `advanceType` VARCHAR(191) NOT NULL,
    `originalAmount` DOUBLE NOT NULL,
    `appliedAmount` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PartyAdvance_companyId_partyId_status_idx`(`companyId`, `partyId`, `status`),
    UNIQUE INDEX `PartyAdvance_paymentId_key`(`paymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefundAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `returnDocumentId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RefundAllocation_companyId_returnDocumentId_idx`(`companyId`, `returnDocumentId`),
    UNIQUE INDEX `RefundAllocation_paymentId_key`(`paymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `PurchaseInvoice_partyId_supplierInvoiceNo_key` ON `PurchaseInvoice`(`partyId`, `supplierInvoiceNo`);

-- AddForeignKey
ALTER TABLE `InventoryLot` ADD CONSTRAINT `InventoryLot_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryLot` ADD CONSTRAINT `InventoryLot_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryLot` ADD CONSTRAINT `InventoryLot_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SerialNumber` ADD CONSTRAINT `SerialNumber_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `InventoryLot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotMovement` ADD CONSTRAINT `LotMovement_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotMovement` ADD CONSTRAINT `LotMovement_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `InventoryLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotMovement` ADD CONSTRAINT `LotMovement_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotMovement` ADD CONSTRAINT `LotMovement_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotGenealogy` ADD CONSTRAINT `LotGenealogy_parentLotId_fkey` FOREIGN KEY (`parentLotId`) REFERENCES `InventoryLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LotGenealogy` ADD CONSTRAINT `LotGenealogy_childLotId_fkey` FOREIGN KEY (`childLotId`) REFERENCES `InventoryLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionReceipt` ADD CONSTRAINT `ProductionReceipt_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionReceipt` ADD CONSTRAINT `ProductionReceipt_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionReceipt` ADD CONSTRAINT `ProductionReceipt_outputItemId_fkey` FOREIGN KEY (`outputItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionReceipt` ADD CONSTRAINT `ProductionReceipt_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequisition` ADD CONSTRAINT `PurchaseRequisition_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequisitionLine` ADD CONSTRAINT `PurchaseRequisitionLine_requisitionId_fkey` FOREIGN KEY (`requisitionId`) REFERENCES `PurchaseRequisition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequisitionLine` ADD CONSTRAINT `PurchaseRequisitionLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_requisitionId_fkey` FOREIGN KEY (`requisitionId`) REFERENCES `PurchaseRequisition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderLine` ADD CONSTRAINT `PurchaseOrderLine_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderLine` ADD CONSTRAINT `PurchaseOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceipt` ADD CONSTRAINT `GoodsReceipt_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceipt` ADD CONSTRAINT `GoodsReceipt_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceipt` ADD CONSTRAINT `GoodsReceipt_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptLine` ADD CONSTRAINT `GoodsReceiptLine_goodsReceiptId_fkey` FOREIGN KEY (`goodsReceiptId`) REFERENCES `GoodsReceipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptLine` ADD CONSTRAINT `GoodsReceiptLine_purchaseOrderLineId_fkey` FOREIGN KEY (`purchaseOrderLineId`) REFERENCES `PurchaseOrderLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptLine` ADD CONSTRAINT `GoodsReceiptLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityTemplate` ADD CONSTRAINT `QualityTemplate_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityTemplate` ADD CONSTRAINT `QualityTemplate_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityParameter` ADD CONSTRAINT `QualityParameter_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `QualityTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityInspection` ADD CONSTRAINT `QualityInspection_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityInspection` ADD CONSTRAINT `QualityInspection_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `QualityTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityInspection` ADD CONSTRAINT `QualityInspection_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityInspection` ADD CONSTRAINT `QualityInspection_goodsReceiptId_fkey` FOREIGN KEY (`goodsReceiptId`) REFERENCES `GoodsReceipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityInspection` ADD CONSTRAINT `QualityInspection_goodsReceiptLineId_fkey` FOREIGN KEY (`goodsReceiptLineId`) REFERENCES `GoodsReceiptLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityMeasurement` ADD CONSTRAINT `QualityMeasurement_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `QualityInspection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityMeasurement` ADD CONSTRAINT `QualityMeasurement_parameterId_fkey` FOREIGN KEY (`parameterId`) REFERENCES `QualityParameter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemVendor` ADD CONSTRAINT `ItemVendor_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemVendor` ADD CONSTRAINT `ItemVendor_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemVendor` ADD CONSTRAINT `ItemVendor_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Party`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotation` ADD CONSTRAINT `SalesQuotation_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotation` ADD CONSTRAINT `SalesQuotation_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotationLine` ADD CONSTRAINT `SalesQuotationLine_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `SalesQuotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotationLine` ADD CONSTRAINT `SalesQuotationLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `SalesQuotation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrderLine` ADD CONSTRAINT `SalesOrderLine_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrderLine` ADD CONSTRAINT `SalesOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallan` ADD CONSTRAINT `DeliveryChallan_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallan` ADD CONSTRAINT `DeliveryChallan_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallan` ADD CONSTRAINT `DeliveryChallan_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallanLine` ADD CONSTRAINT `DeliveryChallanLine_deliveryChallanId_fkey` FOREIGN KEY (`deliveryChallanId`) REFERENCES `DeliveryChallan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallanLine` ADD CONSTRAINT `DeliveryChallanLine_salesOrderLineId_fkey` FOREIGN KEY (`salesOrderLineId`) REFERENCES `SalesOrderLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallanLine` ADD CONSTRAINT `DeliveryChallanLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnDocument` ADD CONSTRAINT `ReturnDocument_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnDocument` ADD CONSTRAINT `ReturnDocument_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnDocument` ADD CONSTRAINT `ReturnDocument_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnDocumentLine` ADD CONSTRAINT `ReturnDocumentLine_returnDocumentId_fkey` FOREIGN KEY (`returnDocumentId`) REFERENCES `ReturnDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnDocumentLine` ADD CONSTRAINT `ReturnDocumentLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentSchedule` ADD CONSTRAINT `PaymentSchedule_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentSchedule` ADD CONSTRAINT `PaymentSchedule_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentSchedule` ADD CONSTRAINT `PaymentSchedule_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartyAdvance` ADD CONSTRAINT `PartyAdvance_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartyAdvance` ADD CONSTRAINT `PartyAdvance_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PartyAdvance` ADD CONSTRAINT `PartyAdvance_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefundAllocation` ADD CONSTRAINT `RefundAllocation_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefundAllocation` ADD CONSTRAINT `RefundAllocation_returnDocumentId_fkey` FOREIGN KEY (`returnDocumentId`) REFERENCES `ReturnDocument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefundAllocation` ADD CONSTRAINT `RefundAllocation_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

