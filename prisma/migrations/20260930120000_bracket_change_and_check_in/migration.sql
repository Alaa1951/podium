-- 1. Entrance check-in counts PEOPLE as well as teams: each seat records its
--    own arrival, so a pair arriving one at a time is shown as it is.
ALTER TABLE `Competitor` ADD COLUMN `attendedAt` DATETIME(3) NULL;

-- 2. Warm-up check-in: "ready to compete", stored apart from arrival at the
--    venue (`Team.attendedAt`) so neither ever writes the other.
ALTER TABLE `Team` ADD COLUMN `warmupReadyAt` DATETIME(3) NULL;

-- 3. Teams already checked in were checked in as a whole pair: both seats
--    arrived when the team did.
UPDATE `Competitor` c
JOIN `Team` t ON t.`id` = c.`teamId`
SET c.`attendedAt` = t.`attendedAt`
WHERE t.`attendedAt` IS NOT NULL AND c.`attendedAt` IS NULL;

-- 4. The new permissions reach the shipped roles that are meant to hold them
--    — a new key that no stored role carries would ship invisible. Shipped
--    rows only (`isSystem`), and only where the key is not there already.
--    The Judge, Coach and Athlete rows are deliberately not touched.
--
--      registrations.bracket     change a team's category or level at the
--                                athlete's request
--      registrations.attendance  entrance check-in (the Organiser has it)
--      checkIn.view              see the two check-in screens
--      checkIn.warmup            mark a team ready in warm-up
UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'registrations.bracket')
WHERE `key` IN ('bft-partial', 'gym-studio', 'organiser', 'volunteer')
  AND `isSystem` = 1
  AND JSON_CONTAINS(`permissions`, '"registrations.bracket"') = 0;

UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'registrations.attendance')
WHERE `key` IN ('bft-partial', 'gym-studio', 'organiser', 'volunteer')
  AND `isSystem` = 1
  AND JSON_CONTAINS(`permissions`, '"registrations.attendance"') = 0;

UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'checkIn.view')
WHERE `key` IN ('bft-partial', 'gym-studio', 'organiser', 'volunteer')
  AND `isSystem` = 1
  AND JSON_CONTAINS(`permissions`, '"checkIn.view"') = 0;

UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'checkIn.warmup')
WHERE `key` IN ('bft-partial', 'gym-studio', 'organiser', 'volunteer')
  AND `isSystem` = 1
  AND JSON_CONTAINS(`permissions`, '"checkIn.warmup"') = 0;
