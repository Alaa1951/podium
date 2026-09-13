-- AlterTable
ALTER TABLE `Series` ADD COLUMN `archivedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Team` ADD COLUMN `archivedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `archivedAt` DATETIME(3) NULL;
