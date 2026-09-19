-- ─────────────────────────────────────────────────────────────────────────────
-- Sign-up, approval, and the athlete's own profile.
--
--   • Every existing account is APPROVED (the column default). Only a new
--     self-service sign-up starts pending.
--   • A sign-up records what was asked for (athlete / organiser / judge / …),
--     the gym chosen (which routes the request to that studio), and for a new
--     Gym/Studio the gym's name and city.
--   • An athlete's profile: level, category, and a partner — or "looking for
--     a partner", indexed by level and category for pairing.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `User` ADD COLUMN `approvalStatus` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'approved',
    ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` VARCHAR(191) NULL,
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `rejectionReason` VARCHAR(191) NULL,
    ADD COLUMN `requestedCity` VARCHAR(191) NULL,
    ADD COLUMN `requestedRoleKey` VARCHAR(191) NULL,
    ADD COLUMN `requestedStudioId` VARCHAR(191) NULL,
    ADD COLUMN `requestedStudioName` VARCHAR(191) NULL,
    ADD COLUMN `signupAt` DATETIME(3) NULL,
    ADD COLUMN `signupType` VARCHAR(191) NULL;

CREATE INDEX `User_approvalStatus_idx` ON `User`(`approvalStatus`);
CREATE INDEX `User_requestedStudioId_idx` ON `User`(`requestedStudioId`);
ALTER TABLE `User` ADD CONSTRAINT `User_requestedStudioId_fkey` FOREIGN KEY (`requestedStudioId`) REFERENCES `Studio`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `AthleteProfile` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `dateOfBirth` DATETIME(3) NULL,
    `sex` VARCHAR(191) NULL,
    `division` ENUM('Rookie', 'Open', 'Pro') NULL,
    `category` ENUM('Womens', 'Mens', 'Mixed') NULL,
    `lookingForPartner` BOOLEAN NOT NULL DEFAULT false,
    `partnerUserId` VARCHAR(191) NULL,
    `partnerName` VARCHAR(191) NULL,
    `partnerEmail` VARCHAR(191) NULL,
    `partnerPhone` VARCHAR(191) NULL,
    `partnerDateOfBirth` DATETIME(3) NULL,
    `partnerLinkedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AthleteProfile_userId_key`(`userId`),
    INDEX `AthleteProfile_lookingForPartner_division_category_idx`(`lookingForPartner`, `division`, `category`),
    INDEX `AthleteProfile_partnerEmail_idx`(`partnerEmail`),
    INDEX `AthleteProfile_partnerUserId_idx`(`partnerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AthleteProfile` ADD CONSTRAINT `AthleteProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AthleteProfile` ADD CONSTRAINT `AthleteProfile_partnerUserId_fkey` FOREIGN KEY (`partnerUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Nobody's access changes on upgrade ──────────────────────────────────────
-- Under the old rules a studio account ALWAYS saw its Teams, Scores, Waves and
-- Results tabs, whatever custom access role it held (the Apple App Review
-- account is one: the read-only "limited-admin" role, which lists none of
-- them). Under the new rules each tab needs its own permission, so every
-- studio account holding a custom role keeps those four views as a
-- per-person grant — read-only, exactly as before.
UPDATE `User` AS u
SET u.`permissionOverrides` = JSON_OBJECT(
      'grant', JSON_ARRAY('registrations.view', 'scores.view', 'waves.view', 'results.view'),
      'deny', JSON_ARRAY()
    ),
    u.`permissionsUpdatedAt` = CURRENT_TIMESTAMP(3)
WHERE u.`role` = 'studio'
  AND u.`permissionOverrides` IS NULL
  AND EXISTS (SELECT 1 FROM `UserAccessRole` AS r WHERE r.`userId` = u.`id`);
