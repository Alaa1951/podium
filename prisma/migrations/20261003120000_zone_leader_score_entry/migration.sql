-- Append the new leader sheet and score-entry permissions without replacing
-- existing role customizations. Individual grants and locks remain untouched.
UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'judgeSheet.leaderView')
WHERE `key` = 'zone-leaders'
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('judgeSheet.leaderView'), '$');

UPDATE `AccessRole`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'scores.enter')
WHERE `key` = 'zone-leaders'
  AND JSON_TYPE(`permissions`) = 'ARRAY'
  AND NOT JSON_CONTAINS(`permissions`, JSON_QUOTE('scores.enter'), '$');
