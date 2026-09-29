/**
 * BACKFILL: WHO REGISTERED EACH TEAM (plan v7 §4, release R2a).
 *
 * Sets `Team.ownership = registrant` + `registrantEmail` (+ `registrantUserId`
 * when that seat is already linked) for CRM teams whose payer is on exactly
 * one seat — the rule in ownership-plan.mjs. Every other team stays
 * `unknown` and is LISTED (team number and the reason only) for BFT MENA to
 * set on the registration page.
 *
 *   node --env-file=.env scripts/backfill-ownership.mjs            dry run: counts + the unknown list
 *   node --env-file=.env scripts/backfill-ownership.mjs --apply    writes, and a journal of every row
 *   node --env-file=.env scripts/backfill-ownership.mjs --revert <journal.jsonl>
 *
 * --apply only writes rows still `unknown` with no registrant email (checked
 * again in the UPDATE itself), so it never overwrites BFT MENA or a newer
 * sync, and running it twice changes nothing the second time.
 * --revert puts back a row only if it is still exactly what this run wrote;
 * anything changed since is listed and left alone.
 */
import fs from "node:fs";
import mariadb from "mariadb";

import { readDbCredentials, requirePassword } from "./db-credentials.mjs";
import { planOwnership } from "./ownership-plan.mjs";

try { process.loadEnvFile(); } catch (e) { if (e.code !== "ENOENT") throw e; }
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const revertIndex = args.indexOf("--revert");
const revertFile = revertIndex >= 0 ? args[revertIndex + 1] : null;

const credentials = requirePassword(readDbCredentials());
const db = await mariadb.createConnection({
  host: credentials.host, user: credentials.user, password: credentials.password, database: credentials.database,
  allowPublicKeyRetrieval: ["localhost", "127.0.0.1", "::1"].includes(credentials.host), port: Number(credentials.port), timezone: "Z",
});

try {
  if (revertFile) {
    await revert(revertFile);
  } else {
    await backfill();
  }
} finally {
  await db.end();
}

async function backfill() {
  const rows = await db.query(
    `SELECT t.id, t.number, s.slug AS series, t.source, t.externalId, t.ownership, t.registrantEmail,
            JSON_UNQUOTE(JSON_EXTRACT(t.rawPayload, '$.email')) AS payerEmail,
            EXISTS (SELECT 1 FROM CrmRegistrationMerge m WHERE m.teamId = t.id AND m.canonicalExternalId <> t.externalId) AS mergedAway
     FROM Team t JOIN Series s ON s.id = t.seriesId AND s.archivedAt IS NULL
     WHERE t.archivedAt IS NULL
     ORDER BY s.slug, t.number`
  );
  const seats = await db.query(
    `SELECT c.id, c.teamId, c.email, c.userId FROM Competitor c JOIN Team t ON t.id = c.teamId AND t.archivedAt IS NULL`
  );
  const byTeam = new Map();
  for (const seat of seats) byTeam.set(seat.teamId, [...(byTeam.get(seat.teamId) ?? []), seat]);
  const label = new Map(rows.map((row) => [row.id, `${row.series} #${row.number}`]));
  const plan = planOwnership(
    rows.map((row) => ({
      id: row.id, source: row.source, externalId: row.externalId, ownership: row.ownership,
      registrantEmail: row.registrantEmail, payerEmail: row.payerEmail === "null" ? null : row.payerEmail,
      mergedAway: Boolean(Number(row.mergedAway)), seats: byTeam.get(row.id) ?? [],
    }))
  );

  console.log(`teams: ${rows.length} · to set as registrant: ${plan.set.length} · stay unknown: ${plan.unknown.length} · already decided: ${plan.alreadySet}`);
  const reasons = {};
  for (const one of plan.unknown) reasons[one.reason] = (reasons[one.reason] ?? 0) + 1;
  if (plan.unknown.length) {
    console.log("unknown, by reason:", reasons);
    console.log("unknown teams (for BFT MENA to set on the registration page):");
    for (const one of plan.unknown) console.log(`  ${label.get(one.id)} — ${one.reason}`);
  }
  if (!apply) {
    console.log("(dry run — pass --apply to write)");
    return;
  }

  const journal = `backfill-ownership-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  let written = 0;
  for (const row of plan.set) {
    const result = await db.query(
      `UPDATE Team SET ownership = 'registrant', registrantEmail = ?, registrantUserId = ?
       WHERE id = ? AND ownership = 'unknown' AND registrantEmail IS NULL`,
      [row.after.registrantEmail, row.after.registrantUserId, row.id]
    );
    if (result.affectedRows === 1) {
      fs.appendFileSync(journal, JSON.stringify({ ...row, at: new Date().toISOString() }) + "\n");
      written += 1;
    }
  }
  console.log(`written: ${written} · journal: ${journal}`);
}

async function revert(file) {
  const entries = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  let reverted = 0;
  const changed = [];
  for (const entry of entries) {
    const result = await db.query(
      `UPDATE Team SET ownership = ?, registrantEmail = ?, registrantUserId = ?
       WHERE id = ? AND ownership = ? AND registrantEmail <=> ? AND registrantUserId <=> ?`,
      [entry.before.ownership, entry.before.registrantEmail, entry.before.registrantUserId,
       entry.id, entry.after.ownership, entry.after.registrantEmail, entry.after.registrantUserId]
    );
    if (result.affectedRows === 1) reverted += 1;
    else changed.push(entry.id);
  }
  console.log(`reverted: ${reverted} · changed since, left alone: ${changed.length}`);
  for (const id of changed) console.log(`  ${id}`);
}
