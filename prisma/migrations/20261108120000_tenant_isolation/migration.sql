-- Tenant isolation for the legacy (pre-workflow) business tables.
--
-- Staged and hand-written (reviewed 2026-11-08):
--   1. add a NULLable companyId to every organisation-owned root table
--   2. backfill it deterministically with the operating organisation = the
--      first non-platform company by createdAt (the only organisation a
--      deployment could serve before this migration)
--   3. make it NOT NULL DEFAULT '' (fails, and stops the deploy, if any row is left
--      without an organisation — e.g. rows exist but no company does). The ''
--      default only exists so typed creates need no companyId: the tenant
--      extension always sets it, and '' matches no Company, so the FK rejects
--      any row created without a tenant.
--   4. make business keys unique per organisation: the new composite unique
--      index is created before the old global one is dropped; the old key
--      was unique, so the composite is unique by construction
--   5. company foreign keys and reporting indexes
--   6. prefix legacy document counters with the organisation id so each
--      organisation keeps its own gapless series (numbering continues).
-- Child line tables (invoice items, order lines, allocations, ...) stay
-- scoped through their parent foreign key. AuditLog.companyId stays NULLable
-- for platform-level events.

SET @op := (SELECT `id` FROM `Company` WHERE `isPlatform` = 0 ORDER BY `createdAt` ASC, `id` ASC LIMIT 1);

-- AuditLog
ALTER TABLE `AuditLog` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `AuditLog` SET `companyId` = @op WHERE `companyId` IS NULL;
CREATE INDEX `AuditLog_companyId_createdAt_idx` ON `AuditLog`(`companyId`, `createdAt`);
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Party
ALTER TABLE `Party` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `Party` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `Party` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `Party_companyId_code_key` ON `Party`(`companyId`, `code`);
DROP INDEX `Party_code_key` ON `Party`;
ALTER TABLE `Party` ADD CONSTRAINT `Party_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Item
ALTER TABLE `Item` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `Item` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `Item` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `Item_companyId_code_key` ON `Item`(`companyId`, `code`);
DROP INDEX `Item_code_key` ON `Item`;
ALTER TABLE `Item` ADD CONSTRAINT `Item_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Warehouse
ALTER TABLE `Warehouse` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `Warehouse` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `Warehouse` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `Warehouse_companyId_code_key` ON `Warehouse`(`companyId`, `code`);
DROP INDEX `Warehouse_code_key` ON `Warehouse`;
ALTER TABLE `Warehouse` ADD CONSTRAINT `Warehouse_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Process
ALTER TABLE `Process` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `Process` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `Process` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `Process_companyId_code_key` ON `Process`(`companyId`, `code`);
DROP INDEX `Process_code_key` ON `Process`;
ALTER TABLE `Process` ADD CONSTRAINT `Process_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- PartyProcessRate
ALTER TABLE `PartyProcessRate` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `PartyProcessRate` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `PartyProcessRate` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE INDEX `PartyProcessRate_companyId_idx` ON `PartyProcessRate`(`companyId`);
ALTER TABLE `PartyProcessRate` ADD CONSTRAINT `PartyProcessRate_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- StockLedger
ALTER TABLE `StockLedger` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `StockLedger` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `StockLedger` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE INDEX `StockLedger_companyId_itemId_warehouseId_idx` ON `StockLedger`(`companyId`, `itemId`, `warehouseId`);
ALTER TABLE `StockLedger` ADD CONSTRAINT `StockLedger_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AccountLedger
ALTER TABLE `AccountLedger` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `AccountLedger` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `AccountLedger` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE INDEX `AccountLedger_companyId_account_date_idx` ON `AccountLedger`(`companyId`, `account`, `date`);
ALTER TABLE `AccountLedger` ADD CONSTRAINT `AccountLedger_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- SalesInvoice
ALTER TABLE `SalesInvoice` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `SalesInvoice` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `SalesInvoice` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `SalesInvoice_companyId_invoiceNo_key` ON `SalesInvoice`(`companyId`, `invoiceNo`);
DROP INDEX `SalesInvoice_invoiceNo_key` ON `SalesInvoice`;
ALTER TABLE `SalesInvoice` ADD CONSTRAINT `SalesInvoice_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- PurchaseInvoice
ALTER TABLE `PurchaseInvoice` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `PurchaseInvoice` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `PurchaseInvoice` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `PurchaseInvoice_companyId_invoiceNo_key` ON `PurchaseInvoice`(`companyId`, `invoiceNo`);
DROP INDEX `PurchaseInvoice_invoiceNo_key` ON `PurchaseInvoice`;
ALTER TABLE `PurchaseInvoice` ADD CONSTRAINT `PurchaseInvoice_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- JobworkInward
ALTER TABLE `JobworkInward` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `JobworkInward` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `JobworkInward` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `JobworkInward_companyId_inwardNo_key` ON `JobworkInward`(`companyId`, `inwardNo`);
DROP INDEX `JobworkInward_inwardNo_key` ON `JobworkInward`;
ALTER TABLE `JobworkInward` ADD CONSTRAINT `JobworkInward_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- JobCard
ALTER TABLE `JobCard` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `JobCard` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `JobCard` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `JobCard_companyId_cardNo_key` ON `JobCard`(`companyId`, `cardNo`);
DROP INDEX `JobCard_cardNo_key` ON `JobCard`;
ALTER TABLE `JobCard` ADD CONSTRAINT `JobCard_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- JobworkCertificate
ALTER TABLE `JobworkCertificate` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `JobworkCertificate` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `JobworkCertificate` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `JobworkCertificate_companyId_certNo_key` ON `JobworkCertificate`(`companyId`, `certNo`);
DROP INDEX `JobworkCertificate_certNo_key` ON `JobworkCertificate`;
ALTER TABLE `JobworkCertificate` ADD CONSTRAINT `JobworkCertificate_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Employee
ALTER TABLE `Employee` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `Employee` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `Employee` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `Employee_companyId_code_key` ON `Employee`(`companyId`, `code`);
DROP INDEX `Employee_code_key` ON `Employee`;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Project
ALTER TABLE `Project` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `Project` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `Project` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `Project_companyId_projectNo_key` ON `Project`(`companyId`, `projectNo`);
DROP INDEX `Project_projectNo_key` ON `Project`;
ALTER TABLE `Project` ADD CONSTRAINT `Project_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bom
ALTER TABLE `Bom` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `Bom` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `Bom` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `Bom_companyId_bomNo_key` ON `Bom`(`companyId`, `bomNo`);
DROP INDEX `Bom_bomNo_key` ON `Bom`;
ALTER TABLE `Bom` ADD CONSTRAINT `Bom_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- WorkOrder
ALTER TABLE `WorkOrder` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `WorkOrder` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `WorkOrder` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `WorkOrder_companyId_woNo_key` ON `WorkOrder`(`companyId`, `woNo`);
DROP INDEX `WorkOrder_woNo_key` ON `WorkOrder`;
ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ProductionTask
ALTER TABLE `ProductionTask` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `ProductionTask` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `ProductionTask` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `ProductionTask_companyId_taskNo_key` ON `ProductionTask`(`companyId`, `taskNo`);
DROP INDEX `ProductionTask_taskNo_key` ON `ProductionTask`;
ALTER TABLE `ProductionTask` ADD CONSTRAINT `ProductionTask_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payment
ALTER TABLE `Payment` ADD COLUMN `companyId` VARCHAR(191) NULL;
UPDATE `Payment` SET `companyId` = @op WHERE `companyId` IS NULL;
ALTER TABLE `Payment` MODIFY `companyId` VARCHAR(191) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX `Payment_companyId_paymentNo_key` ON `Payment`(`companyId`, `paymentNo`);
DROP INDEX `Payment_paymentNo_key` ON `Payment`;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Document counters: legacy keys ("INV-2627", "PRJ", ...) become "<organisation id>:<key>".
-- Keys that already carry an organisation prefix (workflow modules) are left alone.
UPDATE `Counter` SET `key` = CONCAT(@op, ':', `key`) WHERE `key` NOT LIKE '%:%' AND @op IS NOT NULL;
