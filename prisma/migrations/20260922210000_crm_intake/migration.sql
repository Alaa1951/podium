-- ─────────────────────────────────────────────────────────────────────────────
-- CRM INTAKE — the registrations that are not teams yet.
--
-- Thirty-two of the eighty-seven registrations in the CRM have no Category and
-- no Division. Both are REQUIRED on `Team`, and fifty-three files read them:
-- they decide the bracket, the results, and — through `LoadStandard`, keyed on
-- [division, sex] — the weights a pair is handed on the floor.
--
-- SO WHY NOT MAKE THEM NULLABLE. Because "unknown" would then be a value every
-- one of those fifty-three places has to think about, and the ones that did
-- not think about it would not fail: they would group an unknown division into
-- a bracket, or look up a load standard and find nothing, and the pair would
-- discover it at a rig. A required column is what stops that, and it is worth
-- keeping required.
--
-- So an unfinished registration lives in its own table: visible on the
-- registrations screen, listed with what it is missing and how to reach the
-- people, counted — and structurally unable to reach a bracket. The sync
-- promotes it to a real `Team` the moment the fields arrive, and drops the row.
--
-- IT MIRRORS THE CRM. The poll rewrites what it finds and deletes what it no
-- longer finds, so this table can never drift into a private list of its own.
-- That is also why there is no `resolvedAt`: a row that became a team is gone,
-- and the team is the record.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `CrmIntake` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `partnerName` VARCHAR(191) NULL,
    `teamName` VARCHAR(191) NULL,
    `stageName` VARCHAR(191) NULL,
    `missing` VARCHAR(191) NOT NULL,
    `rawPayload` JSON NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CrmIntake_seriesId_externalId_key`(`seriesId`, `externalId`),
    INDEX `CrmIntake_seriesId_missing_idx`(`seriesId`, `missing`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CrmIntake` ADD CONSTRAINT `CrmIntake_seriesId_fkey`
    FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- The counter that goes with it: a poll now reports what it HELD as well as
-- what it wrote, so "31 skipped" stops reading like 31 records thrown away.
ALTER TABLE `CrmSyncState` ADD COLUMN `lastWaiting` INTEGER NOT NULL DEFAULT 0;
