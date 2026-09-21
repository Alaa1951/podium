-- ─────────────────────────────────────────────────────────────────────────────
-- WHICH COMPETITION SOMEBODY SIGNED UP FOR, and who can watch for the people
-- still without a partner.
--
--   • `User.requestedSeriesId` — an athlete belongs to a competition before
--     they belong to a team. Until now the only thing tying a person to a
--     Series was Competitor → Team → Series, so somebody who had signed up and
--     not yet been entered belonged nowhere and appeared on no screen.
--
--   • `Series.signupOpen` — OFF by default. The public sign-up form is open to
--     the internet, so a competition appears on it only when somebody decides
--     it should. Being `scheduled` is not the same as being ready to
--     advertise, and production currently carries several competitions
--     ("test", "podium 4") that must not be offered to strangers.
--
--   • The `registrations.partners` permission, which gates the new screen.
--
-- NO BACKFILL for requestedSeriesId. One would only be honest where exactly
-- one competition is still to come, and production has five — so athletes who
-- signed up before today are set by hand from the user screen. A guess here
-- would be indistinguishable from a choice afterwards.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `User` ADD COLUMN `requestedSeriesId` VARCHAR(191) NULL;
CREATE INDEX `User_requestedSeriesId_idx` ON `User`(`requestedSeriesId`);
ALTER TABLE `User` ADD CONSTRAINT `User_requestedSeriesId_fkey`
  FOREIGN KEY (`requestedSeriesId`) REFERENCES `Series`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Series` ADD COLUMN `signupOpen` BOOLEAN NOT NULL DEFAULT false;

-- ── The new permission reaches the roles that already exist ──────────────────
-- ensureSystemRoles() only ever CREATES a role that is missing, and the seed's
-- update branch touches `isSystem` alone; permissions are read from the stored
-- row (src/lib/permissions/load.ts). Without the statement below the screen
-- ships INVISIBLE — and invisible to everybody except an admin, because can()
-- short-circuits for them, which is exactly who would be testing it.
--
-- JSON_ARRAY_APPEND rather than a literal list, so a role BFT MENA has already
-- edited on the Roles screen keeps its edits AND gains the key. The previous
-- migration restated the whole array and would have skipped an edited row.
UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'registrations.partners')
WHERE `key` IN ('gym-studio', 'organiser', 'bft-partial')
  AND `isSystem` = 1
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND NOT JSON_CONTAINS(`permissions`, '"registrations.partners"');
