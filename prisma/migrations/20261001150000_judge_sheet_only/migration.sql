-- The Judge role opens the judge sheet only (data).
--
-- A judge sees their zone, their station and the team on it now or next,
-- and enters that team's score. The role also held waves.view, scores.view,
-- waveControl.view and zoneStaff.view, which opened the Waves, Score entry,
-- Wave control and Marshalling screens — every team of the competition.
-- Those four are taken away; nothing else changes. A zone leader's powers
-- come from the post (ZoneStaff), not from these keys.
--
-- ensureSystemRoles never overwrites an existing role row, so the stored row
-- is corrected here.

UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY('judgeSheet.view', 'scores.enter')
WHERE `key` = 'judge';
