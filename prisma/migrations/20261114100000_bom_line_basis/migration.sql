-- BOM line basis: component quantities are either per output UNIT or per BATCH
-- of `batchQty` units. Additive and defaulted: every existing revision becomes
-- BATCH of 1, which is exactly how it was already being exploded and valued.
ALTER TABLE `Bom` ADD COLUMN `lineBasis` VARCHAR(191) NOT NULL DEFAULT 'BATCH',
    ADD COLUMN `batchQty` DOUBLE NOT NULL DEFAULT 1;
