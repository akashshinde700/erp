-- BOM output identity + immutable revisions, work-order output quantity, and
-- the MRP run/line snapshot tables.
-- Additive only: new nullable / defaulted columns and new tables. Legacy Bom
-- rows keep itemId = NULL until an operator links them explicitly
-- (scripts/backfill-bom-output-items.mjs); MRP refuses to explode those and
-- reports them instead of guessing.

-- AlterTable
ALTER TABLE `Bom`
    ADD COLUMN `itemId` VARCHAR(191) NULL,
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `effectiveFrom` DATETIME(3) NULL,
    ADD COLUMN `effectiveTo` DATETIME(3) NULL,
    ADD COLUMN `supersedesId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `WorkOrder`
    ADD COLUMN `outputItemId` VARCHAR(191) NULL,
    ADD COLUMN `outputQty` DOUBLE NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX `Bom_supersedesId_key` ON `Bom`(`supersedesId`);

-- CreateIndex
CREATE UNIQUE INDEX `Bom_companyId_itemId_revision_key` ON `Bom`(`companyId`, `itemId`, `revision`);

-- CreateIndex
CREATE INDEX `Bom_companyId_itemId_status_idx` ON `Bom`(`companyId`, `itemId`, `status`);

-- AddForeignKey
ALTER TABLE `Bom` ADD CONSTRAINT `Bom_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bom` ADD CONSTRAINT `Bom_supersedesId_fkey` FOREIGN KEY (`supersedesId`) REFERENCES `Bom`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_outputItemId_fkey` FOREIGN KEY (`outputItemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `MrpRun` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `runNo` VARCHAR(191) NOT NULL,
    `asOf` DATETIME(3) NOT NULL,
    `horizonDays` INTEGER NOT NULL DEFAULT 30,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `salesOrderCount` INTEGER NOT NULL DEFAULT 0,
    `workOrderCount` INTEGER NOT NULL DEFAULT 0,
    `requirementCount` INTEGER NOT NULL DEFAULT 0,
    `suggestionCount` INTEGER NOT NULL DEFAULT 0,
    `shortageItems` INTEGER NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(191) NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MrpRun_companyId_runNo_key`(`companyId`, `runNo`),
    INDEX `MrpRun_companyId_status_asOf_idx`(`companyId`, `status`, `asOf`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MrpLine` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 0,
    `needBy` DATETIME(3) NOT NULL,
    `grossQty` DOUBLE NOT NULL DEFAULT 0,
    `onHandQty` DOUBLE NOT NULL DEFAULT 0,
    `incomingQty` DOUBLE NOT NULL DEFAULT 0,
    `woSupplyQty` DOUBLE NOT NULL DEFAULT 0,
    `netQty` DOUBLE NOT NULL DEFAULT 0,
    `suggestion` VARCHAR(191) NOT NULL DEFAULT 'NONE',
    `bomNo` VARCHAR(191) NULL,
    `pegging` TEXT NULL,
    `createdDocType` VARCHAR(191) NULL,
    `createdDocNo` VARCHAR(191) NULL,

    INDEX `MrpLine_runId_level_itemId_idx`(`runId`, `level`, `itemId`),
    INDEX `MrpLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MrpRun` ADD CONSTRAINT `MrpRun_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MrpLine` ADD CONSTRAINT `MrpLine_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `MrpRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MrpLine` ADD CONSTRAINT `MrpLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
