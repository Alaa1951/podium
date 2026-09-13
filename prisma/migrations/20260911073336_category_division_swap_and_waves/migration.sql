-- DropIndex
DROP INDEX `LoadStandard_category_sex_key` ON `LoadStandard`;

-- AlterTable
ALTER TABLE `Event` DROP COLUMN `currentWave`,
    DROP COLUMN `waveEndsAt`,
    DROP COLUMN `waveRunning`;

-- AlterTable
ALTER TABLE `LoadStandard` DROP COLUMN `category`,
    ADD COLUMN `division` ENUM('Rookie', 'Open', 'Pro') NOT NULL;

-- AlterTable
ALTER TABLE `Team` ADD COLUMN `waveId` VARCHAR(191) NULL,
    MODIFY `category` ENUM('Womens', 'Mens', 'Mixed') NOT NULL,
    MODIFY `division` ENUM('Rookie', 'Open', 'Pro') NOT NULL;

-- CreateTable
CREATE TABLE `Wave` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `startTime` VARCHAR(191) NOT NULL DEFAULT '09:00',
    `durationMinutes` INTEGER NOT NULL DEFAULT 20,
    `capacity` INTEGER NOT NULL DEFAULT 9,
    `status` ENUM('pending', 'running', 'complete') NOT NULL DEFAULT 'pending',
    `startedAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Wave_eventId_status_idx`(`eventId`, `status`),
    UNIQUE INDEX `Wave_eventId_number_key`(`eventId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `LoadStandard_division_sex_key` ON `LoadStandard`(`division`, `sex`);

-- CreateIndex
CREATE INDEX `Team_waveId_idx` ON `Team`(`waveId`);

-- AddForeignKey
ALTER TABLE `Wave` ADD CONSTRAINT `Wave_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_waveId_fkey` FOREIGN KEY (`waveId`) REFERENCES `Wave`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
