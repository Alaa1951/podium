-- ─────────────────────────────────────────────────────────────────────────────
-- The configurable role system.
--
--   • Account types gain `staff` (BFT MENA Partial access) and `organiser`
--     (event staff: organisers, judges, volunteers, coaches).
--   • A person can hold several roles (UserAccessRole) instead of one
--     `User.accessRoleId`. Every existing assignment is carried across first,
--     so nobody loses — or gains — access on upgrade.
--   • Per-person Grant / Lock overrides live on the user.
-- ─────────────────────────────────────────────────────────────────────────────

-- Account types
ALTER TABLE `User` MODIFY `role` ENUM('admin', 'staff', 'studio', 'competitor', 'organiser') NOT NULL DEFAULT 'competitor';
ALTER TABLE `Notification` MODIFY `audienceRole` ENUM('admin', 'staff', 'studio', 'competitor', 'organiser') NULL;

-- Roles: who may hand them out, who they are for, display order
ALTER TABLE `AccessRole` ADD COLUMN `accountTypes` JSON NULL,
    ADD COLUMN `assignableBy` ENUM('bft', 'bft_studio') NOT NULL DEFAULT 'bft',
    ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;

-- Several roles per person
CREATE TABLE `UserAccessRole` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `accessRoleId` VARCHAR(191) NOT NULL,
    `assignedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserAccessRole_accessRoleId_idx`(`accessRoleId`),
    INDEX `UserAccessRole_assignedById_idx`(`assignedById`),
    UNIQUE INDEX `UserAccessRole_userId_accessRoleId_key`(`userId`, `accessRoleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserAccessRole` ADD CONSTRAINT `UserAccessRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserAccessRole` ADD CONSTRAINT `UserAccessRole_accessRoleId_fkey` FOREIGN KEY (`accessRoleId`) REFERENCES `AccessRole`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserAccessRole` ADD CONSTRAINT `UserAccessRole_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry every existing single-role assignment across before the column goes.
INSERT INTO `UserAccessRole` (`id`, `userId`, `accessRoleId`, `assignedById`, `createdAt`)
SELECT UUID(), `id`, `accessRoleId`, NULL, CURRENT_TIMESTAMP(3)
FROM `User`
WHERE `accessRoleId` IS NOT NULL;

-- Per-person overrides, and the old single-role column retired
ALTER TABLE `User` DROP FOREIGN KEY `User_accessRoleId_fkey`;
DROP INDEX `User_accessRoleId_fkey` ON `User`;
ALTER TABLE `User` DROP COLUMN `accessRoleId`,
    ADD COLUMN `permissionOverrides` JSON NULL,
    ADD COLUMN `permissionsUpdatedAt` DATETIME(3) NULL;
