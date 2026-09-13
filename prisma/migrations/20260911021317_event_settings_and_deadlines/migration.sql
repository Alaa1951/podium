-- AlterTable
ALTER TABLE `Event` ADD COLUMN `registrationClosesAt` DATETIME(3) NULL,
    ADD COLUMN `resultsPublicAt` DATETIME(3) NULL,
    ADD COLUMN `scoreEntryClosesAt` DATETIME(3) NULL,
    ADD COLUMN `showAthleteNames` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `showStudioColumn` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `showTeamName` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `studioScoreCorrections` INTEGER NOT NULL DEFAULT 0;
