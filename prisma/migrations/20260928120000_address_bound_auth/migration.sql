-- Address-bound sign-in proof (plan v7 §3.1). Additive only.
--
-- A code or link proves the mailbox it was SENT TO, not whatever address the
-- account carries when it is typed in. Until now nothing recorded that
-- address, so a code sent to A could be accepted after the account moved to
-- B. From now on every code and link records its recipient, is accepted only
-- while the account's email is still that recipient, and the proven address
-- is kept on the account. Rows without a recipient (issued before this
-- migration) are never accepted again; people simply request a new one.
ALTER TABLE `User` ADD COLUMN `verifiedEmail` VARCHAR(191) NULL;
ALTER TABLE `OtpChallenge` ADD COLUMN `sentTo` VARCHAR(191) NULL;
ALTER TABLE `AuthToken` ADD COLUMN `sentTo` VARCHAR(191) NULL;
