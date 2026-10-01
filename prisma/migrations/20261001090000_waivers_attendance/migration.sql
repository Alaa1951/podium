-- Waiver declarations and attendance history (additive).
--
-- New tables only, plus one nullable column. No acceptance is created for
-- anybody: every athlete of a competition that attaches a waiver starts
-- pending until they sign it themselves.
--
-- The one data statement: warm-up readiness recorded before this migration
-- was for the wave the team is in now, so it is stamped with that wave
-- (readiness now belongs to one wave; a team moved elsewhere warms up again).

-- AlterTable
ALTER TABLE `Team` ADD COLUMN `warmupWaveId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `WaiverRelease` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `documentKey` VARCHAR(100) NOT NULL,
    `status` ENUM('active', 'retired') NOT NULL DEFAULT 'active',
    `activatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `activatedById` VARCHAR(191) NULL,
    `retiredAt` DATETIME(3) NULL,

    INDEX `WaiverRelease_seriesId_status_idx`(`seriesId`, `status`),
    UNIQUE INDEX `WaiverRelease_seriesId_version_key`(`seriesId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaiverEdition` (
    `id` VARCHAR(191) NOT NULL,
    `releaseId` VARCHAR(191) NOT NULL,
    `language` ENUM('en', 'ar') NOT NULL,
    `content` LONGTEXT NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `acknowledgement` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WaiverEdition_releaseId_language_key`(`releaseId`, `language`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WaiverAcceptance` (
    `id` VARCHAR(191) NOT NULL,
    `releaseId` VARCHAR(191) NOT NULL,
    `editionId` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `competitorId` VARCHAR(191) NOT NULL,
    `typedName` VARCHAR(200) NOT NULL,
    `acknowledgement` TEXT NOT NULL,
    `language` ENUM('en', 'ar') NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `category` ENUM('Womens', 'Mens', 'Mixed') NOT NULL,
    `division` ENUM('Rookie', 'Open', 'Pro') NOT NULL,
    `signatureMethod` VARCHAR(32) NOT NULL DEFAULT 'typed_name',
    `acceptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dedupeKey` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `WaiverAcceptance_dedupeKey_key`(`dedupeKey`),
    INDEX `WaiverAcceptance_seriesId_userId_idx`(`seriesId`, `userId`),
    INDEX `WaiverAcceptance_releaseId_idx`(`releaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AttendanceEvent` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `competitorId` VARCHAR(191) NULL,
    `waveId` VARCHAR(191) NULL,
    `kind` ENUM('entrance_in', 'entrance_out', 'warmup_in', 'warmup_out') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AttendanceEvent_seriesId_at_idx`(`seriesId`, `at`),
    INDEX `AttendanceEvent_teamId_at_idx`(`teamId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WaiverRelease` ADD CONSTRAINT `WaiverRelease_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaiverEdition` ADD CONSTRAINT `WaiverEdition_releaseId_fkey` FOREIGN KEY (`releaseId`) REFERENCES `WaiverRelease`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaiverAcceptance` ADD CONSTRAINT `WaiverAcceptance_releaseId_fkey` FOREIGN KEY (`releaseId`) REFERENCES `WaiverRelease`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaiverAcceptance` ADD CONSTRAINT `WaiverAcceptance_editionId_fkey` FOREIGN KEY (`editionId`) REFERENCES `WaiverEdition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceEvent` ADD CONSTRAINT `AttendanceEvent_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Readiness already given belongs to the wave the team stands in now.
UPDATE `Team` SET `warmupWaveId` = `waveId` WHERE `warmupReadyAt` IS NOT NULL;
