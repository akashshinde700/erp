-- Make-to-stock manufacturing: a standard BOM and a work order may exist
-- without a project. Relaxes NOT NULL only; every existing row keeps its
-- project and the foreign keys (Bom cascade, WorkOrder restrict) are unchanged.
-- AlterTable
ALTER TABLE `Bom` MODIFY `projectId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `WorkOrder` MODIFY `projectId` VARCHAR(191) NULL;

