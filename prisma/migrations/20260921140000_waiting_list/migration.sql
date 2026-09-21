-- ─────────────────────────────────────────────────────────────────────────────
-- THE WAITING LIST.
--
-- Registration used to be a hard door: past `registrationClosesAt` a studio
-- simply could not enter anybody. That threw away the people BFT MENA most
-- wants to keep — the ones who turned up late and would happily take a place
-- if one came free.
--
-- `Team.waitlistedAt` is a FACT about an entry, not a status: the moment it
-- was put on the waiting list. It sits beside `archivedAt` and `paidAt` for
-- the same reason — the single word a team is SHOWN by stays derived in
-- team-status.ts, so a stored status cannot drift from what is on screen.
--
-- It is independent of payment on purpose. Somebody on the waiting list can
-- pay at any time, and the money must not buy them a place; `isCompeting()`
-- now reads both, and every board, report and login gate reads that.
--
-- NULL for every existing row, which is correct: everything already entered
-- holds its place. Nothing is backfilled onto the list retroactively.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `Team` ADD COLUMN `waitlistedAt` DATETIME(3) NULL;

-- Reads are always "the entries in this competition that are/aren't waiting",
-- so the competition leads the index and the flag follows it.
CREATE INDEX `Team_seriesId_waitlistedAt_idx` ON `Team`(`seriesId`, `waitlistedAt`);
