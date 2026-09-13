-- CreateTable
CREATE TABLE `Sponsor` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `alt` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `imageB64` MEDIUMTEXT NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Sponsor_seriesId_position_key`(`seriesId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Sponsor` ADD CONSTRAINT `Sponsor_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
