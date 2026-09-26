-- 1. The shipped Organiser role runs the floor of every competition (Wave
--    control, zone teams). It was flagged as a role studios could hand out,
--    which let a gym give one of its own people control of rival gyms' waves
--    and judges. From now on only BFT MENA gives it. Touches the shipped row
--    only, and only while it still carries the old default.
UPDATE `AccessRole`
SET `assignableBy` = 'bft'
WHERE `key` = 'organiser' AND `isSystem` = 1 AND `assignableBy` = 'bft_studio';

-- 2. Checking a team in on the day is now its own permission,
--    `registrations.attendance`, split from `registrations.payment` (BFT MENA
--    only) so the Organiser can run check-in. The shipped Organiser row gets it
--    — a new key that no stored role carries would ship invisible.
UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'registrations.attendance')
WHERE `key` = 'organiser'
  AND `isSystem` = 1
  AND JSON_CONTAINS(`permissions`, '"registrations.attendance"') = 0;
