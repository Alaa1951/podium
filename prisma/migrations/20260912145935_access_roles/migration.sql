-- AlterTable
ALTER TABLE `User` ADD COLUMN `accessRoleId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `AccessRole` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `nameAr` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `permissions` JSON NOT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccessRole_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_accessRoleId_fkey` FOREIGN KEY (`accessRoleId`) REFERENCES `AccessRole`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
