/**
 * READ-ONLY REPORT: which athletes cannot yet see their team, and why.
 *
 * Writes nothing (plan v7 §3.2 item 11). Linking happens only at run time,
 * when an account proves its address (auth-proof.ts → link-seats.ts). This
 * lists what that rule leaves waiting, so BFT MENA can chase people or fix
 * registrations:
 *
 *   1. seats whose email matches an account that is unlinked — the account
 *      has not proven that address yet (they need one code sign-in);
 *   2. seats with no email at all — nothing can ever link them until the
 *      registrant or BFT MENA adds one;
 *   3. athlete accounts still waiting for approval;
 *   4. athlete accounts that hold no seat anywhere.
 *
 * Counts by default; --names prints names and emails (for BFT MENA's eyes).
 *
 *   node --env-file=.env scripts/link-seats.mjs [--names] [--series <slug>]
 */
import mariadb from "mariadb";
import { readDbCredentials, requirePassword } from "./db-credentials.mjs";

try { process.loadEnvFile(); } catch (e) { if (e.code !== "ENOENT") throw e; }
const args = process.argv.slice(2);
const names = args.includes("--names");
const slugIndex = args.indexOf("--series");
const slug = slugIndex >= 0 ? args[slugIndex + 1] : null;

const credentials = requirePassword(readDbCredentials());
const db = await mariadb.createConnection({
  host: credentials.host, user: credentials.user, password: credentials.password, database: credentials.database,
  allowPublicKeyRetrieval: ["localhost", "127.0.0.1", "::1"].includes(credentials.host), port: Number(credentials.port), timezone: "Z",
});

const seriesFilter = slug ? "AND s.slug = ?" : "";
const params = slug ? [slug] : [];
const show = (row) => (names ? row : Object.fromEntries(Object.entries(row).filter(([key]) => !/name|email/i.test(key))));

try {
  console.log("== 1. Unlinked seats whose email matches an athlete account (waiting for a proven address)");
  const unlinked = await db.query(
    `SELECT s.name AS series, t.number AS team, c.position, c.fullName AS seatName, c.email,
            u.status, u.approvalStatus, (u.verifiedEmail IS NOT NULL AND u.verifiedEmail = u.email) AS proven
     FROM Competitor c JOIN Team t ON t.id = c.teamId AND t.archivedAt IS NULL
     JOIN Series s ON s.id = t.seriesId AND s.archivedAt IS NULL
     JOIN User u ON u.email = c.email AND u.archivedAt IS NULL
     WHERE c.userId IS NULL ${seriesFilter} ORDER BY s.name, t.number, c.position`, params);
  console.table(Array.from(unlinked).map(show));

  console.log("== 2. Seats with no email (cannot be linked until one is added)");
  const noEmail = await db.query(
    `SELECT s.name AS series, t.number AS team, c.position, c.fullName AS seatName,
            (SELECT r.email FROM Competitor r WHERE r.teamId = t.id AND r.position <> c.position LIMIT 1) AS otherSeatEmail
     FROM Competitor c JOIN Team t ON t.id = c.teamId AND t.archivedAt IS NULL
     JOIN Series s ON s.id = t.seriesId AND s.archivedAt IS NULL
     WHERE c.email IS NULL ${seriesFilter} ORDER BY s.name, t.number`, params);
  console.table(Array.from(noEmail).map(show));

  console.log("== 3. Athlete accounts waiting for approval");
  const pending = await db.query(
    `SELECT u.name, u.email, u.status, u.signupAt, (u.verifiedEmail IS NOT NULL AND u.verifiedEmail = u.email) AS proven,
            EXISTS(SELECT 1 FROM Competitor c WHERE c.userId = u.id) AS hasSeat
     FROM User u WHERE u.role = 'competitor' AND u.archivedAt IS NULL AND u.approvalStatus = 'pending' ORDER BY u.signupAt`);
  console.table(Array.from(pending).map(show));

  console.log("== 4. Athlete accounts with no seat anywhere");
  const seatless = await db.query(
    `SELECT u.name, u.email, u.status, u.approvalStatus, (u.verifiedEmail IS NOT NULL AND u.verifiedEmail = u.email) AS proven,
            EXISTS(SELECT 1 FROM Competitor c JOIN Team t ON t.id = c.teamId WHERE c.email = u.email AND t.archivedAt IS NULL) AS seatWithThisEmail
     FROM User u WHERE u.role = 'competitor' AND u.archivedAt IS NULL
       AND NOT EXISTS (SELECT 1 FROM Competitor c JOIN Team t ON t.id = c.teamId WHERE c.userId = u.id AND t.archivedAt IS NULL)
     ORDER BY u.createdAt`);
  console.table(Array.from(seatless).map(show));

  console.log(`Totals: unlinked-with-account=${unlinked.length} no-email=${noEmail.length} pending=${pending.length} seatless=${seatless.length}`);
} finally {
  await db.end();
}
