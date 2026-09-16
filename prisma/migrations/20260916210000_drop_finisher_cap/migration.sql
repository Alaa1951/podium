-- The finisher is timed by the wave clock itself — the remaining time of the
-- wave at the moment of capture — so the separate cap window has no meaning.
ALTER TABLE `Series` DROP COLUMN `finisherCapSeconds`;
