-- Manufacturing cost roll-up: overhead absorption.
--
-- All four columns are additive and defaulted, so nothing existing changes
-- value and no backfill is needed:
--   Company.overheadRatePct    0 = absorption off (the pre-change behaviour)
--   Bom.standardLabourCost     0 = BOM approved before routings existed
--   Bom.standardMinutes        0
--   ProductionTask.overheadCost 0 = operation completed before absorption
--   WorkOrder.overheadCost     0
--
-- Rehearse on a protected copy: totals that include these columns change (WIP
-- and receipt cost go up by the absorbed amount once a rate is set).

ALTER TABLE `Company`
  ADD COLUMN `overheadRatePct` DOUBLE NOT NULL DEFAULT 0;

ALTER TABLE `Bom`
  ADD COLUMN `standardLabourCost` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `standardMinutes` DOUBLE NOT NULL DEFAULT 0;

ALTER TABLE `ProductionTask`
  ADD COLUMN `overheadCost` DOUBLE NOT NULL DEFAULT 0;

ALTER TABLE `WorkOrder`
  ADD COLUMN `overheadCost` DOUBLE NOT NULL DEFAULT 0;
