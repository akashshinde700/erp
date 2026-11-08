-- Overhead advisor: optional budget inputs + who/when/why for the absorption
-- rate on Company, and a factory-overhead flag on organisation ledgers.
-- Additive and defaulted; the absorption rate itself is NOT changed.
-- AlterTable
ALTER TABLE `Company` ADD COLUMN `overheadBudgetAnnual` DOUBLE NULL,
    ADD COLUMN `overheadRateReason` VARCHAR(300) NULL,
    ADD COLUMN `overheadRateSetAt` DATETIME(3) NULL,
    ADD COLUMN `overheadRateSetBy` VARCHAR(191) NULL,
    ADD COLUMN `primeCostBudgetAnnual` DOUBLE NULL;

-- AlterTable
ALTER TABLE `LedgerAccount` ADD COLUMN `isFactoryOverhead` BOOLEAN NOT NULL DEFAULT false;

