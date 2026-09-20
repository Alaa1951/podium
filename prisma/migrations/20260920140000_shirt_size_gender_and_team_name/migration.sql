-- ─────────────────────────────────────────────────────────────────────────────
-- The sign-up form, unified with the CRM's registration form.
--
--   • SHIRT SIZE for both halves of a pair. A fixed list, not free text: the
--     only reason to ask is to count how many of each to order.
--   • The partner's own GENDER, which the form now asks for. The column is
--     still called `sex` — LoadStandard is keyed on [division, sex], and
--     renaming it would move the prescribed-loads table for nothing. Only the
--     wording on screen changes.
--   • TEAM NAME, on the profile rather than on Team: somebody who is still
--     looking for a partner has no Team row to hang it off yet.
--   • BFT MEMBER, which the form asks as a plain checkbox. It is a statement
--     of studio membership and is NOT the same thing as the studio that owns
--     an entry (`User.studioId`), so it gets its own column.
--
-- Every column is nullable or defaulted, so existing rows are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `AthleteProfile`
    ADD COLUMN `shirtSize` ENUM('XS', 'S', 'M', 'L', 'XL', 'XXL') NULL,
    ADD COLUMN `bftMember` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `teamName` VARCHAR(191) NULL,
    ADD COLUMN `partnerSex` VARCHAR(191) NULL,
    ADD COLUMN `partnerShirtSize` ENUM('XS', 'S', 'M', 'L', 'XL', 'XXL') NULL,
    ADD COLUMN `partnerBftMember` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `Competitor`
    ADD COLUMN `shirtSize` ENUM('XS', 'S', 'M', 'L', 'XL', 'XXL') NULL,
    ADD COLUMN `bftMember` BOOLEAN NOT NULL DEFAULT false;
