-- ─────────────────────────────────────────────────────────────────────────────
-- A PORTRAIT PER SEAT.
--
-- The screens over the rigs show who is standing there. A name carries a long
-- way; a face carries further, and the reference boards BFT MENA works from
-- are portraits with the name under them.
--
-- NULL on every row, and that is the whole state today: every seat falls back
-- to one shared default image. Nobody uploads anything yet and nothing is
-- generated — this column is where a real portrait will live when it does.
--
-- It holds a PATH served by this app, never a URL pointing somewhere else. A
-- column that accepted a foreign URL is how a page quietly starts loading from
-- a third party, and this app's published privacy page says it loads from none.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `Competitor` ADD COLUMN `photoPath` VARCHAR(191) NULL;
