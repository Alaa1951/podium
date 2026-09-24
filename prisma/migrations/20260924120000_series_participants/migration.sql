-- DropIndex
DROP INDEX `PartnerRequest_openPairKey_key` ON `PartnerRequest`;

-- AlterTable
ALTER TABLE `PartnerRequest` ADD COLUMN `seriesId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Series` ADD COLUMN `isTraining` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `trainingSourceId` VARCHAR(191) NULL,
    ADD COLUMN `trainingCopiedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `SeriesParticipant` (
    `id` VARCHAR(191) NOT NULL,
    `seriesId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `signedUpAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `division` ENUM('Rookie', 'Open', 'Pro') NULL,
    `category` ENUM('Womens', 'Mens', 'Mixed') NULL,
    `shirtSize` ENUM('XS', 'S', 'M', 'L', 'XL', 'XXL') NULL,
    `bftMember` BOOLEAN NOT NULL DEFAULT false,
    `lookingForPartner` BOOLEAN NOT NULL DEFAULT true,
    `teamName` VARCHAR(191) NULL,
    `partnerUserId` VARCHAR(191) NULL,
    `partnerName` VARCHAR(191) NULL,
    `partnerEmail` VARCHAR(191) NULL,
    `partnerPhone` VARCHAR(191) NULL,
    `partnerDateOfBirth` DATETIME(3) NULL,
    `partnerSex` VARCHAR(191) NULL,
    `partnerShirtSize` ENUM('XS', 'S', 'M', 'L', 'XL', 'XXL') NULL,
    `partnerBftMember` BOOLEAN NOT NULL DEFAULT false,
    `partnerLinkedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SeriesParticipant_userId_archivedAt_idx`(`userId`, `archivedAt`),
    INDEX `SeriesParticipant_seriesId_lookingForPartner_division_catego_idx`(`seriesId`, `lookingForPartner`, `division`, `category`),
    INDEX `SeriesParticipant_seriesId_partnerEmail_idx`(`seriesId`, `partnerEmail`),
    INDEX `SeriesParticipant_partnerUserId_idx`(`partnerUserId`),
    UNIQUE INDEX `SeriesParticipant_seriesId_userId_key`(`seriesId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `PartnerRequest_seriesId_status_idx` ON `PartnerRequest`(`seriesId`, `status`);

-- CreateIndex
CREATE UNIQUE INDEX `PartnerRequest_seriesId_openPairKey_key` ON `PartnerRequest`(`seriesId`, `openPairKey`);

-- AddForeignKey
ALTER TABLE `PartnerRequest` ADD CONSTRAINT `PartnerRequest_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeriesParticipant` ADD CONSTRAINT `SeriesParticipant_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `Series`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeriesParticipant` ADD CONSTRAINT `SeriesParticipant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SeriesParticipant` ADD CONSTRAINT `SeriesParticipant_partnerUserId_fkey` FOREIGN KEY (`partnerUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill memberships without modifying existing teams, people, money or scores.
-- A proven team seat takes precedence over the legacy single sign-up choice.
INSERT INTO SeriesParticipant
  (id, seriesId, userId, signedUpAt, division, category, shirtSize, bftMember,
   lookingForPartner, teamName, partnerUserId, partnerName, partnerEmail, partnerPhone,
   partnerDateOfBirth, partnerShirtSize, partnerBftMember, partnerLinkedAt, updatedAt)
SELECT CONCAT('sp_', MD5(CONCAT(t.seriesId, ':', c.userId))), t.seriesId, c.userId,
  t.registeredAt, t.division, t.category, c.shirtSize, c.bftMember,
  FALSE, t.name, p.userId, p.fullName, p.email, p.phone,
  p.dateOfBirth, p.shirtSize, COALESCE(p.bftMember, FALSE), t.createdAt, CURRENT_TIMESTAMP(3)
FROM Competitor c JOIN Team t ON t.id = c.teamId
LEFT JOIN Competitor p ON p.teamId = t.id AND p.position <> c.position
WHERE c.userId IS NOT NULL AND t.archivedAt IS NULL
  AND NOT EXISTS (SELECT 1 FROM Competitor c2 JOIN Team t2 ON t2.id = c2.teamId
    WHERE c2.userId = c.userId AND t2.seriesId = t.seriesId AND t2.archivedAt IS NULL AND c2.id < c.id)
ON DUPLICATE KEY UPDATE id = SeriesParticipant.id;

-- A profile's partner is copied only into the original explicitly chosen event,
-- and only when the other athlete chose that same event.
INSERT INTO SeriesParticipant
  (id, seriesId, userId, signedUpAt, division, category, shirtSize, bftMember,
   lookingForPartner, teamName, partnerUserId, partnerName, partnerEmail, partnerPhone,
   partnerDateOfBirth, partnerSex, partnerShirtSize, partnerBftMember, partnerLinkedAt, updatedAt)
SELECT CONCAT('sp_', MD5(CONCAT(u.requestedSeriesId, ':', u.id))), u.requestedSeriesId, u.id,
  COALESCE(u.signupAt, u.createdAt), ap.division, ap.category, ap.shirtSize, COALESCE(ap.bftMember, FALSE),
  CASE WHEN partner.requestedSeriesId = u.requestedSeriesId THEN FALSE ELSE COALESCE(ap.lookingForPartner, TRUE) END,
  ap.teamName, CASE WHEN partner.requestedSeriesId = u.requestedSeriesId THEN ap.partnerUserId ELSE NULL END,
  ap.partnerName, ap.partnerEmail, ap.partnerPhone, ap.partnerDateOfBirth, ap.partnerSex,
  ap.partnerShirtSize, COALESCE(ap.partnerBftMember, FALSE),
  CASE WHEN partner.requestedSeriesId = u.requestedSeriesId THEN ap.partnerLinkedAt ELSE NULL END, CURRENT_TIMESTAMP(3)
FROM User u LEFT JOIN AthleteProfile ap ON ap.userId = u.id
LEFT JOIN User partner ON partner.id = ap.partnerUserId
WHERE u.requestedSeriesId IS NOT NULL AND u.role = 'competitor'
ON DUPLICATE KEY UPDATE id = SeriesParticipant.id;

-- Unattributable historical requests remain null and are excluded from actions.
UPDATE PartnerRequest pr JOIN User a ON a.id = pr.fromUserId JOIN User b ON b.id = pr.toUserId
SET pr.seriesId = a.requestedSeriesId
WHERE a.requestedSeriesId IS NOT NULL AND a.requestedSeriesId = b.requestedSeriesId;
