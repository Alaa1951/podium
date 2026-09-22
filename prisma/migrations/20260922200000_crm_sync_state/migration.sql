-- ─────────────────────────────────────────────────────────────────────────────
-- CRM SYNC STATE.
--
-- One row, id "singleton". Not a table of runs: the only questions worth
-- answering are whether a poll is happening right now and when one last
-- worked. A row per fifteen-minute poll would be tens of thousands of rows
-- nobody reads, and the audit log already records what each poll changed.
--
-- `running` IS THE CLAIM. A poll takes it with
--     UPDATE ... SET running = 1 WHERE id = 'singleton' AND running = 0
-- and runs only if that changed exactly one row — the same idiom that starts a
-- wave exactly once. It is what stops the fifteen-minute timer and the Sync
-- now button from working the same eighty-five records at the same moment.
--
-- `claimedAt` is how the claim heals. A process killed mid-poll would
-- otherwise leave `running` set for good and lock the sync out permanently;
-- a claim older than the stale window is presumed dead and released. There is
-- no owner recorded and no lease to renew, because a timestamp is enough and
-- it recovers whether the same process came back or a deploy replaced it.
--
-- NOTHING IS SWITCHED ON BY THIS MIGRATION. The poller is gated by
-- `CRM_SYNC_ENABLED`, which is absent in production: the table exists and the
-- loop does not start until somebody sets it deliberately.
--
-- The singleton row is seeded here so the first claim is an UPDATE like every
-- other one, rather than a create-then-claim that two processes could race.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `CrmSyncState` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `running` BOOLEAN NOT NULL DEFAULT false,
    `claimedAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastCreated` INTEGER NOT NULL DEFAULT 0,
    `lastUpdated` INTEGER NOT NULL DEFAULT 0,
    `lastSkipped` INTEGER NOT NULL DEFAULT 0,
    -- Already redacted by the client: a status and a short code, never a body.
    -- The body of a CRM error echoes back the contacts it was asked for.
    `lastError` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `CrmSyncState` (`id`, `updatedAt`) VALUES ('singleton', CURRENT_TIMESTAMP(3));
