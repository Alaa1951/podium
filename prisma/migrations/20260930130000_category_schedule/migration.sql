-- AlterTable
ALTER TABLE `Team` ADD COLUMN `slotManualAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Wave` ADD COLUMN `blockCategory` ENUM('Womens', 'Mens', 'Mixed') NULL;

-- CreateTable
CREATE TABLE `CategorySchedule` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `category` ENUM('Womens', 'Mens', 'Mixed') NOT NULL,
    `position` INTEGER NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `breakMinutes` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CategorySchedule_seriesId_category_key`(`seriesId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CategorySchedule` ADD CONSTRAINT `CategorySchedule_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
