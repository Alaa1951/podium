-- ─────────────────────────────────────────────────────────────────────────────
-- The floor: stations, automatic zone timing, zone-based judging.
--
--   • A team stands on a STATION (1–9) in its wave, the same in every zone.
--     Teams already in waves are numbered by team number; a wave holding more
--     than nine keeps the rest unplaced until someone moves them.
--   • Zone timing is two settings on the competition (work / break minutes).
--   • Judging moves from per-wave grants to per-ZONE staff. The old per-wave
--     grants carry no zone or station, so they cannot be converted: staff are
--     reassigned per zone before the next event.
--   • A score is locked zone by zone. Scores already submitted keep their lock
--     on every zone.
-- ─────────────────────────────────────────────────────────────────────────────

-- Zone timing
ALTER TABLE `Series` ADD COLUMN `zoneBreakMinutes` INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN `zoneWorkMinutes` INTEGER NOT NULL DEFAULT 15;

-- Stations, numbered 1–9 within each wave by team number
ALTER TABLE `Team` ADD COLUMN `station` INTEGER NULL;

UPDATE `Team` AS t
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `waveId` ORDER BY `number`) AS rn
  FROM `Team`
  WHERE `waveId` IS NOT NULL AND `archivedAt` IS NULL
) AS ranked ON ranked.`id` = t.`id`
SET t.`station` = ranked.rn
WHERE ranked.rn <= 9;

CREATE UNIQUE INDEX `Team_waveId_station_key` ON `Team`(`waveId`, `station`);

-- Zone staff (replaces per-wave grants)
CREATE TABLE `ZoneStaff` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `zoneId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `position` ENUM('leader', 'judge', 'reserve') NOT NULL DEFAULT 'judge',
    `station` INTEGER NULL,
    `assignedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ZoneStaff_seriesId_idx`(`seriesId`),
    INDEX `ZoneStaff_userId_idx`(`userId`),
    UNIQUE INDEX `ZoneStaff_zoneId_userId_key`(`zoneId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ZoneStaff` ADD CONSTRAINT `ZoneStaff_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ZoneStaff` ADD CONSTRAINT `ZoneStaff_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `Zone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ZoneStaff` ADD CONSTRAINT `ZoneStaff_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ZoneStaff` ADD CONSTRAINT `ZoneStaff_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `WaveAccess` DROP FOREIGN KEY `WaveAccess_userId_fkey`;
ALTER TABLE `WaveAccess` DROP FOREIGN KEY `WaveAccess_waveId_fkey`;
DROP TABLE `WaveAccess`;

-- Per-zone score locks
CREATE TABLE `ZoneScore` (
    `id` VARCHAR(191) NOT NULL,
    `scoreId` VARCHAR(191) NOT NULL,
    `zoneId` VARCHAR(191) NOT NULL,
    `status` ENUM('draft', 'submitted') NOT NULL DEFAULT 'draft',
    `submittedAt` DATETIME(3) NULL,
    `submittedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ZoneScore_zoneId_idx`(`zoneId`),
    UNIQUE INDEX `ZoneScore_scoreId_zoneId_key`(`scoreId`, `zoneId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ZoneScore` ADD CONSTRAINT `ZoneScore_scoreId_fkey` FOREIGN KEY (`scoreId`) REFERENCES `Score`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ZoneScore` ADD CONSTRAINT `ZoneScore_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `Zone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ZoneScore` ADD CONSTRAINT `ZoneScore_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- A score submitted before zone locks existed stays locked on every zone.
INSERT INTO `ZoneScore` (`id`, `scoreId`, `zoneId`, `status`, `submittedAt`, `submittedById`, `updatedAt`)
SELECT UUID(), s.`id`, z.`id`, 'submitted', s.`submittedAt`, s.`submittedById`, CURRENT_TIMESTAMP(3)
FROM `Score` AS s
JOIN `Team` AS t ON t.`id` = s.`teamId`
JOIN `Zone` AS z ON z.`seriesId` = t.`seriesId`
WHERE s.`status` = 'submitted';
