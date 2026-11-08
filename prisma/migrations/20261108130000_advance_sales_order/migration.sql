-- Customer advances can be collected against a sales order: the unapplied part
-- counts toward that order's payment milestones (finance-adjustments.ts).
-- Additive: a NULLable column, its index and a SET NULL foreign key.
ALTER TABLE `PartyAdvance` ADD COLUMN `salesOrderId` VARCHAR(191) NULL;
CREATE INDEX `PartyAdvance_salesOrderId_idx` ON `PartyAdvance`(`salesOrderId`);
ALTER TABLE `PartyAdvance` ADD CONSTRAINT `PartyAdvance_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
