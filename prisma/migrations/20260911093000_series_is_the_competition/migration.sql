-- A SERIES IS THE COMPETITION.
--
-- `Event` sat between Series and everything else, and nobody used the level:
-- every series had exactly one. Worse, it forced the word "round" into the
-- vocabulary, and a round already means something in this sport — a round of
-- kettlebell swings. So Event's columns move up onto Series and the table goes.
--
-- Written by hand rather than generated, because the generated version drops
-- Event before its values have been copied anywhere. Nothing is lost here: the
-- new columns are filled from each series' own event before they are locked.

-- ── 1. Series takes on the competition's own fields ─────────────────────────
ALTER TABLE `Series`
    ADD COLUMN `slug` VARCHAR(191) NULL,
    ADD COLUMN `competitionDate` DATETIME(3) NULL,
    ADD COLUMN `venue` VARCHAR(191) NOT NULL DEFAULT 'All studios',
    ADD COLUMN `status` ENUM('scheduled', 'live', 'final') NOT NULL DEFAULT 'scheduled',
    ADD COLUMN `firstWaveTime` VARCHAR(191) NOT NULL DEFAULT '09:00',
    ADD COLUMN `waveMinutes` INTEGER NOT NULL DEFAULT 20,
    ADD COLUMN `waveCapacity` INTEGER NOT NULL DEFAULT 9,
    ADD COLUMN `finisherCapSeconds` INTEGER NOT NULL DEFAULT 900,
    ADD COLUMN `boardOpensAt` DATETIME(3) NULL,
    ADD COLUMN `studiosMayEnterScores` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `studioScoreCorrections` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `registrationClosesAt` DATETIME(3) NULL,
    ADD COLUMN `scoreEntryClosesAt` DATETIME(3) NULL,
    ADD COLUMN `resultsPublicAt` DATETIME(3) NULL,
    ADD COLUMN `showTeamName` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `showCompetitorNames` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `showStudioColumn` BOOLEAN NOT NULL DEFAULT true;

-- ── 2. Copy each series' event up onto it ───────────────────────────────────
-- A series with several events keeps the earliest, which is the one every
-- screen already treated as "the" event.
UPDATE `Series` s
JOIN (
    SELECT e.* FROM `Event` e
    JOIN (SELECT `seriesId`, MIN(`eventDate`) AS d FROM `Event` GROUP BY `seriesId`) pick
      ON pick.`seriesId` = e.`seriesId` AND pick.d = e.`eventDate`
) e ON e.`seriesId` = s.`id`
SET s.`competitionDate`        = e.`eventDate`,
    s.`venue`                  = e.`venue`,
    s.`status`                 = e.`status`,
    s.`firstWaveTime`          = e.`firstWaveTime`,
    s.`waveMinutes`            = e.`waveMinutes`,
    s.`waveCapacity`           = e.`waveCapacity`,
    s.`finisherCapSeconds`     = e.`finisherCapSeconds`,
    s.`boardOpensAt`           = e.`boardOpensAt`,
    s.`studioScoreCorrections` = e.`studioScoreCorrections`,
    s.`registrationClosesAt`   = e.`registrationClosesAt`,
    s.`scoreEntryClosesAt`     = e.`scoreEntryClosesAt`,
    s.`resultsPublicAt`        = e.`resultsPublicAt`,
    s.`showTeamName`           = e.`showTeamName`,
    s.`showCompetitorNames`    = e.`showAthleteNames`,
    s.`showStudioColumn`       = e.`showStudioColumn`;

-- A series that never had an event (created but never set up) still needs a
-- date; today stands in until somebody sets one.
UPDATE `Series` SET `competitionDate` = NOW() WHERE `competitionDate` IS NULL;

-- ── 3. A readable, stable handle for the URL ────────────────────────────────
-- Lowercased, non-alphanumerics collapsed to a hyphen. The id is appended only
-- where that would collide, so the common case stays clean.
UPDATE `Series`
SET `slug` = TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(`name`), '[^a-z0-9]+', '-'));

UPDATE `Series` SET `slug` = CONCAT('series-', SUBSTRING(`id`, -6))
WHERE `slug` IS NULL OR `slug` = '';

UPDATE `Series` s
JOIN (SELECT `slug` FROM `Series` GROUP BY `slug` HAVING COUNT(*) > 1) dup
  ON dup.`slug` = s.`slug`
SET s.`slug` = CONCAT(s.`slug`, '-', SUBSTRING(s.`id`, -6));

ALTER TABLE `Series`
    MODIFY `slug` VARCHAR(191) NOT NULL,
    MODIFY `competitionDate` DATETIME(3) NOT NULL;

-- ── 4. Teams and waves hang off the series directly ─────────────────────────
ALTER TABLE `Team` ADD COLUMN `seriesId` VARCHAR(191) NULL;
ALTER TABLE `Wave` ADD COLUMN `seriesId` VARCHAR(191) NULL;

UPDATE `Team` t JOIN `Event` e ON e.`id` = t.`eventId` SET t.`seriesId` = e.`seriesId`;
UPDATE `Wave` w JOIN `Event` e ON e.`id` = w.`eventId` SET w.`seriesId` = e.`seriesId`;

-- Anything whose event has already gone is an orphan and cannot be placed.
DELETE FROM `Team` WHERE `seriesId` IS NULL;
DELETE FROM `Wave` WHERE `seriesId` IS NULL;

-- The foreign key goes first: MySQL keeps the last index on a key column to
-- enforce it, and refuses to drop that index while the key still exists.
ALTER TABLE `Team` DROP FOREIGN KEY `Team_eventId_fkey`;
ALTER TABLE `Wave` DROP FOREIGN KEY `Wave_eventId_fkey`;

DROP INDEX `Team_eventId_category_division_idx` ON `Team`;
DROP INDEX `Team_eventId_externalId_key` ON `Team`;
DROP INDEX `Team_eventId_number_key` ON `Team`;
DROP INDEX `Team_eventId_paymentStatus_idx` ON `Team`;
DROP INDEX `Wave_eventId_number_key` ON `Wave`;
DROP INDEX `Wave_eventId_status_idx` ON `Wave`;

ALTER TABLE `Team` DROP COLUMN `eventId`, MODIFY `seriesId` VARCHAR(191) NOT NULL;
ALTER TABLE `Wave` DROP COLUMN `eventId`, MODIFY `seriesId` VARCHAR(191) NOT NULL;

CREATE INDEX `Team_seriesId_category_division_idx` ON `Team`(`seriesId`, `category`, `division`);
CREATE INDEX `Team_seriesId_paymentStatus_idx` ON `Team`(`seriesId`, `paymentStatus`);
CREATE UNIQUE INDEX `Team_seriesId_number_key` ON `Team`(`seriesId`, `number`);
CREATE UNIQUE INDEX `Team_seriesId_externalId_key` ON `Team`(`seriesId`, `externalId`);
CREATE INDEX `Wave_seriesId_status_idx` ON `Wave`(`seriesId`, `status`);
CREATE UNIQUE INDEX `Wave_seriesId_number_key` ON `Wave`(`seriesId`, `number`);

ALTER TABLE `Team` ADD CONSTRAINT `Team_seriesId_fkey`
    FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Wave` ADD CONSTRAINT `Wave_seriesId_fkey`
    FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 5. Who is taking part ───────────────────────────────────────────────────
CREATE TABLE `SeriesStudio` (
    `seriesId` VARCHAR(191) NOT NULL,
    `studioId` VARCHAR(191) NOT NULL,
    `addedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SeriesStudio_studioId_idx`(`studioId`),
    PRIMARY KEY (`seriesId`, `studioId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SeriesStudio` ADD CONSTRAINT `SeriesStudio_seriesId_fkey`
    FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SeriesStudio` ADD CONSTRAINT `SeriesStudio_studioId_fkey`
    FOREIGN KEY (`studioId`) REFERENCES `Studio`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Every studio that already has a team in a competition is plainly taking part
-- in it, so the list starts out true rather than empty.
INSERT INTO `SeriesStudio` (`seriesId`, `studioId`)
SELECT DISTINCT t.`seriesId`, t.`studioId`
FROM `Team` t
WHERE t.`studioId` IS NOT NULL;

-- ── 6. The level nobody used ────────────────────────────────────────────────
ALTER TABLE `Event` DROP FOREIGN KEY `Event_seriesId_fkey`;
DROP TABLE `Event`;

CREATE UNIQUE INDEX `Series_slug_key` ON `Series`(`slug`);
CREATE INDEX `Series_status_idx` ON `Series`(`status`);
CREATE INDEX `Series_competitionDate_idx` ON `Series`(`competitionDate`);
