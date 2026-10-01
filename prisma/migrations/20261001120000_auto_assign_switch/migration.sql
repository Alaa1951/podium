-- Auto Assign on/off per competition (additive).
--
-- Every existing competition keeps Auto Assign on, exactly as before. Turning
-- it off in Settings → Category schedule lets staff change wave times,
-- category times and team slots by hand without the category-block and
-- running-manually checks.

-- AlterTable
ALTER TABLE `Series` ADD COLUMN `autoAssignEnabled` BOOLEAN NOT NULL DEFAULT true;
