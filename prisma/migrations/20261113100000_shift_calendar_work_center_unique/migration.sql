-- ShiftCalendar is 1:1 with WorkCenter (schema: workCenterId @unique).
-- 20261111100000 created only the (companyId, workCenterId) index; add the
-- single-column unique index Prisma expects. Additive; fails loudly if a
-- work centre somehow has two calendars, which must then be resolved by hand.
CREATE UNIQUE INDEX `ShiftCalendar_workCenterId_key` ON `ShiftCalendar`(`workCenterId`);
