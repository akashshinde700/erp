-- Tally connector state moves from process memory to the database, one row per
-- organisation. Additive: two new tables, nothing existing changes. Cascades
-- with Company so a force reseed / restore still deletes cleanly.
-- CreateTable
CREATE TABLE `TallyConnector` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NULL,
    `codeExpiresAt` DATETIME(3) NULL,
    `tokenHash` VARCHAR(191) NULL,
    `connectorVersion` VARCHAR(191) NULL,
    `pairedAt` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TallyConnector_companyId_key`(`companyId`),
    UNIQUE INDEX `TallyConnector_codeHash_key`(`codeHash`),
    UNIQUE INDEX `TallyConnector_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TallyConnectorJob` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `doc` VARCHAR(191) NOT NULL,
    `docId` VARCHAR(191) NOT NULL,
    `docNo` VARCHAR(191) NOT NULL,
    `xml` LONGTEXT NOT NULL,
    `queuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `doneAt` DATETIME(3) NULL,
    `ok` BOOLEAN NULL,
    `created` INTEGER NULL,
    `altered` INTEGER NULL,
    `errors` INTEGER NULL,
    `errorText` VARCHAR(300) NULL,

    INDEX `TallyConnectorJob_companyId_doneAt_idx`(`companyId`, `doneAt`),
    INDEX `TallyConnectorJob_companyId_queuedAt_idx`(`companyId`, `queuedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TallyConnector` ADD CONSTRAINT `TallyConnector_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TallyConnectorJob` ADD CONSTRAINT `TallyConnectorJob_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

