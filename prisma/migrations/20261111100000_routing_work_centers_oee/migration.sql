-- Routing, work centres, shift calendars and downtime capture (the data behind
-- finite-capacity scheduling and OEE). Purely additive: five new tables plus
-- nullable/defaulted columns on ProductionTask.
--
-- Legacy tasks keep workCenterId = NULL and plannedMinutes = 0; they still
-- report throughput/yield, they just cannot contribute capacity load or state
-- a planned time. Downtime is captured from the moment this ships, so OEE
-- becomes meaningful only for shifts after the deploy.

-- AlterTable
ALTER TABLE `ProductionTask`
    ADD COLUMN `workCenterId` VARCHAR(191) NULL,
    ADD COLUMN `plannedMinutes` DOUBLE NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `WorkCenter` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL DEFAULT '',
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'MACHINE',
    `machineNo` VARCHAR(191) NULL,
    `parallelCapacity` INTEGER NOT NULL DEFAULT 1,
    `dailyHours` DOUBLE NOT NULL DEFAULT 8,
    `costPerHour` DOUBLE NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WorkCenter_companyId_code_key`(`companyId`, `code`),
    INDEX `WorkCenter_companyId_active_idx`(`companyId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShiftCalendar` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL DEFAULT '',
    `workCenterId` VARCHAR(191) NOT NULL,
    `workDays` VARCHAR(191) NOT NULL DEFAULT '1,2,3,4,5,6',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShiftCalendar_companyId_workCenterId_key`(`companyId`, `workCenterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shift` (
    `id` VARCHAR(191) NOT NULL,
    `calendarId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT 'GENERAL',
    `startMin` INTEGER NOT NULL DEFAULT 540,
    `durationMin` INTEGER NOT NULL DEFAULT 480,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `Shift_calendarId_startMin_idx`(`calendarId`, `startMin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShiftHoliday` (
    `id` VARCHAR(191) NOT NULL,
    `calendarId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `reason` VARCHAR(191) NULL,

    UNIQUE INDEX `ShiftHoliday_calendarId_date_key`(`calendarId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoutingOperation` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL DEFAULT '',
    `bomId` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 1,
    `operation` VARCHAR(191) NOT NULL,
    `workCenterId` VARCHAR(191) NOT NULL,
    `runMinutesPerUnit` DOUBLE NOT NULL DEFAULT 0,
    `setupMinutes` DOUBLE NOT NULL DEFAULT 0,
    `queueMinutes` DOUBLE NOT NULL DEFAULT 0,
    `moveMinutes` DOUBLE NOT NULL DEFAULT 0,
    `inspectionMinutes` DOUBLE NOT NULL DEFAULT 0,
    `parallel` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RoutingOperation_companyId_bomId_seq_key`(`companyId`, `bomId`, `seq`),
    INDEX `RoutingOperation_companyId_bomId_idx`(`companyId`, `bomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MachineDowntime` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL DEFAULT '',
    `workCenterId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `reason` VARCHAR(191) NOT NULL,
    `planned` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MachineDowntime_companyId_workCenterId_startedAt_idx`(`companyId`, `workCenterId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProductionTask` ADD CONSTRAINT `ProductionTask_workCenterId_fkey` FOREIGN KEY (`workCenterId`) REFERENCES `WorkCenter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkCenter` ADD CONSTRAINT `WorkCenter_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftCalendar` ADD CONSTRAINT `ShiftCalendar_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftCalendar` ADD CONSTRAINT `ShiftCalendar_workCenterId_fkey` FOREIGN KEY (`workCenterId`) REFERENCES `WorkCenter`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Shift` ADD CONSTRAINT `Shift_calendarId_fkey` FOREIGN KEY (`calendarId`) REFERENCES `ShiftCalendar`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShiftHoliday` ADD CONSTRAINT `ShiftHoliday_calendarId_fkey` FOREIGN KEY (`calendarId`) REFERENCES `ShiftCalendar`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoutingOperation` ADD CONSTRAINT `RoutingOperation_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoutingOperation` ADD CONSTRAINT `RoutingOperation_bomId_fkey` FOREIGN KEY (`bomId`) REFERENCES `Bom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoutingOperation` ADD CONSTRAINT `RoutingOperation_workCenterId_fkey` FOREIGN KEY (`workCenterId`) REFERENCES `WorkCenter`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MachineDowntime` ADD CONSTRAINT `MachineDowntime_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MachineDowntime` ADD CONSTRAINT `MachineDowntime_workCenterId_fkey` FOREIGN KEY (`workCenterId`) REFERENCES `WorkCenter`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
