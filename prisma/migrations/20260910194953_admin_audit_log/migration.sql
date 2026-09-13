-- CreateTable
CREATE TABLE `AdminAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `targetLabel` VARCHAR(191) NULL,
    `detail` TEXT NULL,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminAuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AdminAuditLog_targetType_targetId_idx`(`targetType`, `targetId`),
    INDEX `AdminAuditLog_action_idx`(`action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AdminAuditLog` ADD CONSTRAINT `AdminAuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
