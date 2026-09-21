-- ─────────────────────────────────────────────────────────────────────────────
-- AI PORTRAITS.
--
-- One `PortraitJob` row is one paid call to an image API. The runner claims
-- rows with an UPDATE guarded by the current status — the same idiom that
-- starts a wave exactly once — so neither a second tick nor a second process
-- can pay for the same job twice.
--
-- `sourceB64` holds the uploaded photo and is cleared the moment the job ends,
-- either way. The finished portrait is a separate, permanent row, so clearing
-- the original never blanks a screen. A photograph of a face is kept for as
-- long as the thing that needed it, and not one step longer.
--
-- `PortraitSpendCounter` is the ceiling on what this can cost in a day. It is
-- here rather than in `rate-limit.ts` because that one lives in memory and
-- resets on every restart: fine for throttling a login, useless as a budget.
--
-- NOTHING IS SWITCHED ON BY THIS MIGRATION. The feature is gated by
-- `PORTRAITS_ENABLED`, which is absent in production: the tables exist, and
-- every route that would write to them refuses until somebody sets it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `PortraitJob` (
    `id` VARCHAR(191) NOT NULL,
    `targetKind` ENUM('competitor', 'team') NOT NULL,
    `competitorId` VARCHAR(191) NULL,
    `teamId` VARCHAR(191) NULL,
    `status` ENUM('queued', 'running', 'succeeded', 'failed') NOT NULL DEFAULT 'queued',
    `sourceB64` MEDIUMTEXT NULL,
    `sourceMime` VARCHAR(191) NULL,
    `consentAt` DATETIME(3) NULL,
    `consentIp` VARCHAR(191) NULL,
    `uploadedById` VARCHAR(191) NULL,
    `inputPortraitIdA` VARCHAR(191) NULL,
    `inputPortraitIdB` VARCHAR(191) NULL,
    `retryCount` INTEGER NOT NULL DEFAULT 0,
    `claimedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `failedReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PortraitJob_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `PortraitJob_competitorId_idx`(`competitorId`),
    INDEX `PortraitJob_teamId_idx`(`teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CompetitorPortrait` (
    `id` VARCHAR(191) NOT NULL,
    `competitorId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `imageB64` MEDIUMTEXT NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CompetitorPortrait_jobId_key`(`jobId`),
    INDEX `CompetitorPortrait_competitorId_createdAt_idx`(`competitorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TeamPortrait` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `imageB64` MEDIUMTEXT NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TeamPortrait_jobId_key`(`jobId`),
    INDEX `TeamPortrait_teamId_createdAt_idx`(`teamId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PortraitSpendCounter` (
    `day` VARCHAR(10) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Team` ADD COLUMN `groupPortraitPath` VARCHAR(191) NULL;

ALTER TABLE `PortraitJob` ADD CONSTRAINT `PortraitJob_competitorId_fkey`
  FOREIGN KEY (`competitorId`) REFERENCES `Competitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PortraitJob` ADD CONSTRAINT `PortraitJob_teamId_fkey`
  FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PortraitJob` ADD CONSTRAINT `PortraitJob_uploadedById_fkey`
  FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CompetitorPortrait` ADD CONSTRAINT `CompetitorPortrait_competitorId_fkey`
  FOREIGN KEY (`competitorId`) REFERENCES `Competitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CompetitorPortrait` ADD CONSTRAINT `CompetitorPortrait_jobId_fkey`
  FOREIGN KEY (`jobId`) REFERENCES `PortraitJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `TeamPortrait` ADD CONSTRAINT `TeamPortrait_teamId_fkey`
  FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TeamPortrait` ADD CONSTRAINT `TeamPortrait_jobId_fkey`
  FOREIGN KEY (`jobId`) REFERENCES `PortraitJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
