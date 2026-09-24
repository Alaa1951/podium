ALTER TABLE `Series` ADD COLUMN `waveIntervalMinutes` INTEGER NOT NULL DEFAULT 20;

CREATE TABLE `WaveChangeRequest` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `preference` ENUM('morning', 'midday', 'evening') NOT NULL,
    `note` VARCHAR(1000) NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `openTeamId` VARCHAR(191) NULL,
    `fromWaveNumber` INTEGER NOT NULL,
    `fromStartTime` VARCHAR(191) NOT NULL,
    `toWaveNumber` INTEGER NULL,
    `toStartTime` VARCHAR(191) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `rejectionReason` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,
    UNIQUE INDEX `WaveChangeRequest_openTeamId_key`(`openTeamId`),
    INDEX `WaveChangeRequest_seriesId_status_createdAt_idx`(`seriesId`, `status`, `createdAt`),
    INDEX `WaveChangeRequest_teamId_createdAt_idx`(`teamId`, `createdAt`),
    INDEX `WaveChangeRequest_requestedById_idx`(`requestedById`),
    INDEX `WaveChangeRequest_reviewedById_idx`(`reviewedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WaveChangeRequest` ADD CONSTRAINT `WaveChangeRequest_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WaveChangeRequest` ADD CONSTRAINT `WaveChangeRequest_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WaveChangeRequest` ADD CONSTRAINT `WaveChangeRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WaveChangeRequest` ADD CONSTRAINT `WaveChangeRequest_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
