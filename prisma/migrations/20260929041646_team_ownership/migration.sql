-- AlterTable
ALTER TABLE `Team` ADD COLUMN `membershipVersion` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `ownership` ENUM('registrant', 'joint', 'unknown') NOT NULL DEFAULT 'unknown',
    ADD COLUMN `registrantEmail` VARCHAR(191) NULL,
    ADD COLUMN `registrantUserId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `MembershipOperation` (
    `id` VARCHAR(191) NOT NULL,
    `operationId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `kind` ENUM('replace', 'fill', 'leave', 'combine', 'split') NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `inputHash` VARCHAR(64) NOT NULL,
    `resultCode` VARCHAR(64) NOT NULL,
    `resultPayload` JSON NULL,
    `versionAfter` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MembershipOperation_operationId_key`(`operationId`),
    INDEX `MembershipOperation_teamId_idx`(`teamId`),
    INDEX `MembershipOperation_actorId_idx`(`actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Team_registrantUserId_idx` ON `Team`(`registrantUserId`);

-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_registrantUserId_fkey` FOREIGN KEY (`registrantUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
