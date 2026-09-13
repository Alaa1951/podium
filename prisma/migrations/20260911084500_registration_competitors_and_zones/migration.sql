-- DropForeignKey
ALTER TABLE `Athlete` DROP FOREIGN KEY `Athlete_studioId_fkey`;

-- DropForeignKey
ALTER TABLE `Athlete` DROP FOREIGN KEY `Athlete_teamId_fkey`;

-- DropForeignKey
ALTER TABLE `Athlete` DROP FOREIGN KEY `Athlete_userId_fkey`;

-- AlterTable
ALTER TABLE `Score` DROP COLUMN `z1Bench`,
    DROP COLUMN `z1Deadlift`,
    DROP COLUMN `z2Metres`,
    DROP COLUMN `z3Dumbbell`,
    DROP COLUMN `z3Kettlebell`,
    DROP COLUMN `z4Minutes`,
    DROP COLUMN `z4Seconds`;

-- AlterTable
ALTER TABLE `Team` ADD COLUMN `amountMinor` INTEGER NULL,
    ADD COLUMN `attendedAt` DATETIME(3) NULL,
    ADD COLUMN `billingNumber` VARCHAR(191) NULL,
    ADD COLUMN `confirmedById` VARCHAR(191) NULL,
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'QAR',
    ADD COLUMN `externalId` VARCHAR(191) NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `paymentNote` VARCHAR(191) NULL,
    ADD COLUMN `paymentStatus` ENUM('pending', 'paid', 'refunded') NOT NULL DEFAULT 'pending',
    ADD COLUMN `rawPayload` JSON NULL,
    ADD COLUMN `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `source` ENUM('ghl', 'manual', 'seed') NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE `User` MODIFY `role` ENUM('admin', 'studio', 'competitor') NOT NULL DEFAULT 'competitor';

-- DropTable
DROP TABLE `Athlete`;

-- CreateTable
CREATE TABLE `Zone` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Zone_seriesId_number_key`(`seriesId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ZoneInput` (
    `id` VARCHAR(191) NOT NULL,
    `zoneId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT '',
    `multiplyBy` INTEGER NOT NULL DEFAULT 1,
    `divideBy` INTEGER NOT NULL DEFAULT 1,
    `maxValue` INTEGER NULL,

    UNIQUE INDEX `ZoneInput_zoneId_position_key`(`zoneId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Competitor` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `dateOfBirth` DATETIME(3) NULL,
    `studioId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `normalizedName` VARCHAR(191) NOT NULL,

    INDEX `Competitor_normalizedName_idx`(`normalizedName`),
    INDEX `Competitor_email_idx`(`email`),
    INDEX `Competitor_userId_idx`(`userId`),
    INDEX `Competitor_studioId_idx`(`studioId`),
    UNIQUE INDEX `Competitor_teamId_position_key`(`teamId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ZoneEntry` (
    `id` VARCHAR(191) NOT NULL,
    `scoreId` VARCHAR(191) NOT NULL,
    `inputId` VARCHAR(191) NOT NULL,
    `value` INTEGER NULL,

    INDEX `ZoneEntry_inputId_idx`(`inputId`),
    UNIQUE INDEX `ZoneEntry_scoreId_inputId_key`(`scoreId`, `inputId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Team_eventId_paymentStatus_idx` ON `Team`(`eventId`, `paymentStatus`);

-- CreateIndex
CREATE UNIQUE INDEX `Team_eventId_externalId_key` ON `Team`(`eventId`, `externalId`);

-- AddForeignKey
ALTER TABLE `Zone` ADD CONSTRAINT `Zone_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ZoneInput` ADD CONSTRAINT `ZoneInput_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `Zone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Competitor` ADD CONSTRAINT `Competitor_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Competitor` ADD CONSTRAINT `Competitor_studioId_fkey` FOREIGN KEY (`studioId`) REFERENCES `Studio`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Competitor` ADD CONSTRAINT `Competitor_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ZoneEntry` ADD CONSTRAINT `ZoneEntry_scoreId_fkey` FOREIGN KEY (`scoreId`) REFERENCES `Score`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ZoneEntry` ADD CONSTRAINT `ZoneEntry_inputId_fkey` FOREIGN KEY (`inputId`) REFERENCES `ZoneInput`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
