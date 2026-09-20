-- ─────────────────────────────────────────────────────────────────────────────
-- ASKING SOMEBODY TO BE YOUR PARTNER.
--
-- An athlete browses the others looking for a partner at their own level and
-- category, and asks. The other one accepts or declines; accepting is what
-- links them.
--
--   • `openPairKey` is the two ids sorted and joined while the request is open,
--     and NULL once it is answered. The UNIQUE index on it is the whole "one
--     open request per pair" rule: NULLs do not collide in MariaDB, so a pair
--     may have any number of answered rows but only ever one open one — in
--     either direction, so A cannot ask B while B is already asking A.
--   • `pairKey` is the same value, never cleared, so a pair's history reads
--     with one indexed lookup.
--   • The level and category of BOTH sides are snapshotted, so somebody who
--     changes level while a request is open does not silently re-bracket it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `PartnerRequest` (
    `id` VARCHAR(191) NOT NULL,
    `fromUserId` VARCHAR(191) NOT NULL,
    `toUserId` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'accepted', 'declined', 'withdrawn', 'cancelled') NOT NULL DEFAULT 'pending',
    `pairKey` VARCHAR(191) NOT NULL,
    `openPairKey` VARCHAR(191) NULL,
    `division` ENUM('Rookie', 'Open', 'Pro') NULL,
    `category` ENUM('Womens', 'Mens', 'Mixed') NULL,
    `toDivision` ENUM('Rookie', 'Open', 'Pro') NULL,
    `toCategory` ENUM('Womens', 'Mens', 'Mixed') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PartnerRequest_openPairKey_key`(`openPairKey`),
    INDEX `PartnerRequest_toUserId_status_createdAt_idx`(`toUserId`, `status`, `createdAt`),
    INDEX `PartnerRequest_fromUserId_status_createdAt_idx`(`fromUserId`, `status`, `createdAt`),
    INDEX `PartnerRequest_pairKey_createdAt_idx`(`pairKey`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PartnerRequest` ADD CONSTRAINT `PartnerRequest_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PartnerRequest` ADD CONSTRAINT `PartnerRequest_toUserId_fkey` FOREIGN KEY (`toUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The Athlete role gains the two new keys ──────────────────────────────────
-- ensureSystemRoles() only ever CREATES a role that is missing; once a row
-- exists it belongs to BFT MENA and is never overwritten (see
-- src/lib/permissions/ensure-system-roles.ts, and the same rule in
-- prisma/seed.ts). Permissions are read from this row, not from the code, so
-- without the statement below no athlete anywhere could open the finder — the
-- feature would ship green and be invisible.
--
-- Conditional on the row still being the shape we shipped: if BFT MENA have
-- already edited the Athlete role, their edit stands and they add the two keys
-- themselves on the Roles screen.
UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY(
      'athleteHome.view', 'athleteHome.editTeam',
      'partner.view', 'partner.edit', 'partner.browse', 'partner.request'
    )
WHERE `key` = 'athlete'
  AND `isSystem` = 1
  AND JSON_CONTAINS(`permissions`, '"partner.edit"')
  AND NOT JSON_CONTAINS(`permissions`, '"partner.browse"');
