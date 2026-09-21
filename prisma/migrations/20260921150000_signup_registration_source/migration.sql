-- ─────────────────────────────────────────────────────────────────────────────
-- WHERE AN ENTRY CAME FROM: a fourth answer.
--
-- `source` had three values, and a pair who signed themselves up fitted none
-- of them. Recording such an entry as `manual` would say BFT MENA typed it in,
-- which is the one thing it is not — and `source` is a column somebody
-- reconciling the registrations export actually pivots on.
--
-- Widening an ENUM is append-only and rewrites no rows: every existing entry
-- keeps the value it has, and the default stays `manual`.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `Team`
  MODIFY COLUMN `source` ENUM('ghl', 'manual', 'seed', 'signup') NOT NULL DEFAULT 'manual';
