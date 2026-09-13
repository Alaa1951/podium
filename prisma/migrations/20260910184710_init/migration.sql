-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `role` ENUM('admin', 'studio', 'member') NOT NULL DEFAULT 'member',
    `status` ENUM('invited', 'active', 'disabled') NOT NULL DEFAULT 'invited',
    `passwordHash` VARCHAR(191) NULL,
    `emailVerified` DATETIME(3) NULL,
    `locale` VARCHAR(191) NOT NULL DEFAULT 'en',
    `studioId` VARCHAR(191) NULL,
    `forceOtpNextLogin` BOOLEAN NOT NULL DEFAULT false,
    `lastLoginAt` DATETIME(3) NULL,
    `lastIp` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_studioId_idx`(`studioId`),
    INDEX `User_role_idx`(`role`),
    INDEX `User_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Account` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `providerAccountId` VARCHAR(191) NOT NULL,

    INDEX `Account_userId_idx`(`userId`),
    UNIQUE INDEX `Account_provider_providerAccountId_key`(`provider`, `providerAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OtpChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `purpose` ENUM('login', 'activate', 'reset') NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumedAt` DATETIME(3) NULL,
    `deviceFingerprint` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OtpChallenge_userId_purpose_consumedAt_idx`(`userId`, `purpose`, `consumedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `purpose` ENUM('invite', 'reset') NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuthToken_userId_purpose_idx`(`userId`, `purpose`),
    INDEX `AuthToken_tokenHash_idx`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TrustedDevice` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `deviceFingerprint` VARCHAR(191) NOT NULL,
    `deviceLabel` VARCHAR(191) NULL,
    `browser` VARCHAR(191) NULL,
    `os` VARCHAR(191) NULL,
    `deviceType` VARCHAR(191) NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `trustCreatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `trustExpiresAt` DATETIME(3) NOT NULL,
    `isTrusted` BOOLEAN NOT NULL DEFAULT false,
    `isRevoked` BOOLEAN NOT NULL DEFAULT false,
    `revokedAt` DATETIME(3) NULL,
    `revokeReason` VARCHAR(191) NULL,
    `lastIp` VARCHAR(191) NULL,

    INDEX `TrustedDevice_userId_idx`(`userId`),
    UNIQUE INDEX `TrustedDevice_userId_deviceFingerprint_key`(`userId`, `deviceFingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoginEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `deviceFingerprint` VARCHAR(191) NULL,
    `browser` VARCHAR(191) NULL,
    `os` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `isTrustedDevice` BOOLEAN NOT NULL DEFAULT false,
    `isSuspicious` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoginEvent_userId_eventType_createdAt_idx`(`userId`, `eventType`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Studio` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Studio_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Series` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Event` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `eventDate` DATETIME(3) NOT NULL,
    `venue` VARCHAR(191) NOT NULL DEFAULT 'All studios',
    `status` ENUM('scheduled', 'live', 'final') NOT NULL DEFAULT 'scheduled',
    `firstWaveTime` VARCHAR(191) NOT NULL DEFAULT '09:00',
    `waveMinutes` INTEGER NOT NULL DEFAULT 20,
    `waveCapacity` INTEGER NOT NULL DEFAULT 9,
    `finisherCapSeconds` INTEGER NOT NULL DEFAULT 900,
    `boardOpensAt` DATETIME(3) NULL,
    `currentWave` INTEGER NOT NULL DEFAULT 1,
    `waveRunning` BOOLEAN NOT NULL DEFAULT false,
    `waveEndsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Event_seriesId_idx`(`seriesId`),
    INDEX `Event_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Team` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` ENUM('Rookie', 'Open', 'Pro') NOT NULL,
    `division` ENUM('Men', 'Women', 'Mixed') NOT NULL,
    `wave` INTEGER NOT NULL DEFAULT 1,
    `studioId` VARCHAR(191) NULL,
    `scoreEdits` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Team_eventId_category_division_idx`(`eventId`, `category`, `division`),
    INDEX `Team_studioId_idx`(`studioId`),
    UNIQUE INDEX `Team_eventId_number_key`(`eventId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Athlete` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `studioId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `normalizedName` VARCHAR(191) NOT NULL,

    INDEX `Athlete_normalizedName_idx`(`normalizedName`),
    INDEX `Athlete_userId_idx`(`userId`),
    INDEX `Athlete_studioId_idx`(`studioId`),
    UNIQUE INDEX `Athlete_teamId_position_key`(`teamId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Score` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `z1Deadlift` INTEGER NULL,
    `z1Bench` INTEGER NULL,
    `z2Metres` INTEGER NULL,
    `z3Kettlebell` INTEGER NULL,
    `z3Dumbbell` INTEGER NULL,
    `z4Minutes` INTEGER NULL,
    `z4Seconds` INTEGER NULL,
    `status` ENUM('draft', 'submitted') NOT NULL DEFAULT 'draft',
    `submittedAt` DATETIME(3) NULL,
    `submittedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Score_teamId_key`(`teamId`),
    INDEX `Score_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScoreAudit` (
    `id` VARCHAR(191) NOT NULL,
    `scoreId` VARCHAR(191) NOT NULL,
    `field` VARCHAR(191) NOT NULL,
    `oldValue` VARCHAR(191) NULL,
    `newValue` VARCHAR(191) NULL,
    `reason` VARCHAR(191) NULL,
    `operatorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ScoreAudit_scoreId_createdAt_idx`(`scoreId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LoadStandard` (
    `id` VARCHAR(191) NOT NULL,
    `category` ENUM('Rookie', 'Open', 'Pro') NOT NULL,
    `sex` VARCHAR(191) NOT NULL,
    `trapBar` VARCHAR(191) NOT NULL,
    `bench` VARCHAR(191) NOT NULL,
    `kettlebell` VARCHAR(191) NOT NULL,
    `dumbbell` VARCHAR(191) NOT NULL,
    `wallBall` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `LoadStandard_category_sex_key`(`category`, `sex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_studioId_fkey` FOREIGN KEY (`studioId`) REFERENCES `Studio`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Account` ADD CONSTRAINT `Account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OtpChallenge` ADD CONSTRAINT `OtpChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthToken` ADD CONSTRAINT `AuthToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TrustedDevice` ADD CONSTRAINT `TrustedDevice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LoginEvent` ADD CONSTRAINT `LoginEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Team` ADD CONSTRAINT `Team_studioId_fkey` FOREIGN KEY (`studioId`) REFERENCES `Studio`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Athlete` ADD CONSTRAINT `Athlete_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Athlete` ADD CONSTRAINT `Athlete_studioId_fkey` FOREIGN KEY (`studioId`) REFERENCES `Studio`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Athlete` ADD CONSTRAINT `Athlete_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Score` ADD CONSTRAINT `Score_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `Team`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Score` ADD CONSTRAINT `Score_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScoreAudit` ADD CONSTRAINT `ScoreAudit_scoreId_fkey` FOREIGN KEY (`scoreId`) REFERENCES `Score`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScoreAudit` ADD CONSTRAINT `ScoreAudit_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
