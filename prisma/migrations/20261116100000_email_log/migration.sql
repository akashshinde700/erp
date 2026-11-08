-- Outgoing email log (invoice, reminder, test). Additive; cascades with Company.
-- SMTP credentials are NOT stored in the database — server environment only.
-- CreateTable
CREATE TABLE `EmailLog` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `toAddress` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(300) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `error` VARCHAR(300) NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `messageId` VARCHAR(300) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailLog_companyId_createdAt_idx`(`companyId`, `createdAt`),
    INDEX `EmailLog_companyId_kind_entityId_createdAt_idx`(`companyId`, `kind`, `entityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmailLog` ADD CONSTRAINT `EmailLog_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

