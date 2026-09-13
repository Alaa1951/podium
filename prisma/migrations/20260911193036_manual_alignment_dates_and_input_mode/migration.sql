-- AlterTable
ALTER TABLE `Series` ADD COLUMN `championsAnnouncedAt` DATETIME(3) NULL,
    ADD COLUMN `registrationsFinalAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `ZoneInput` ADD COLUMN `inputMode` ENUM('number', 'minutes', 'seconds') NOT NULL DEFAULT 'number';
