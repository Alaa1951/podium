-- CreateTable
CREATE TABLE `WaveAccess` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `waveId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WaveAccess_userId_waveId_key`(`userId`, `waveId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WaveAccess` ADD CONSTRAINT `WaveAccess_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WaveAccess` ADD CONSTRAINT `WaveAccess_waveId_fkey` FOREIGN KEY (`waveId`) REFERENCES `Wave`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
