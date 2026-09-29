/**
 * BACKFILL: WHO REGISTERED EACH TEAM (plan v7 §4, release R2a).
 *
 * Sets `Team.ownership = registrant` + `registrantEmail` (+ `registrantUserId`
 * when that seat is already linked) for CRM teams whose payer is on exactly
 * one seat — the rule in ownership-plan.mjs. Every other team stays `unknown`
 * and is LISTED (team number and the reason only) for BFT MENA to set on the
 * registration page.
 *
 *   node --env-file=.env scripts/backfill-ownership.mjs              dry run: counts + the unknown list
 *   node --env-file=.env scripts/backfill-ownership.mjs --apply      writes, with a journal
 *   node --env-file=.env scripts/backfill-ownership.mjs --revert <journal.jsonl>
 *
 * SAFE TO STOP AT ANY POINT, AND TO RUN AGAIN.
 *   · Each team is its own transaction: the team row and its seats are
 *     LOCKED, and the decision is taken again on what the lock returned —
 *     never on the earlier read the dry-run list came from.
 *   · The journal line saying what is about to change ("intent", with the
 *     before and after) is written and flushed to disk BEFORE the update; the
 *     update only matches a team still `unknown` with no registrant; "done" is
 *     written after the commit. A crash after the update but before "done"
 *     leaves an intent whose after-state is in the database — which --revert
 *     reads exactly like a done one.
 *   · Running --apply again changes nothing already decided (the team is no
 *     longer `unknown`), so an interrupted run is finished by running it again.
 *   · --revert locks each team and puts it back only if it is STILL exactly
 *     what this run wrote; a team BFT MENA (or anything else) changed since is
 *     listed and left alone. It journals itself the same way.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import mariadb from "mariadb";

import { readDbCredentials, requirePassword } from "./db-credentials.mjs";
import { planOwnership } from "./ownership-plan.mjs";

try { process.loadEnvFile(); } catch (e) { if (e.code !== "ENOENT") throw e; }
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const revertIndex = args.indexOf("--revert");
const revertFile = revertIndex >= 0 ? args[revertIndex + 1] : null;
/** TEST ONLY: stop the process at a named point, to prove recovery. */
const crashAt = process.env.BACKFILL_TEST_CRASH || null;

const credentials = requirePassword(readDbCredentials());
const db = await mariadb.createConnection({
  host: credentials.host, user: credentials.user, password: credentials.password, database: credentials.database,
  allowPublicKeyRetrieval: ["localhost", "127.0.0.1", "::1"].includes(credentials.host), port: Number(credentials.port), timezone: "Z",
});

const run = crypto.randomUUID();

/** Append one line and push it to disk before going on. */
function journal(file, entry) {
  const fd = fs.openSync(file, "a");
  try {
    fs.writeSync(fd, JSON.stringify({ ...entry, run, at: new Date().toISOString() }) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function crash(point) {
  if (crashAt === point) {
    console.error(`[test] stopping at ${point}`);
    process.exit(3);
  }
}

const SEATS = "SELECT id, teamId, email, userId FROM Competitor WHERE teamId = ? ORDER BY position FOR UPDATE";
const TEAM_ROW = `SELECT t.id, t.source, t.externalId, t.ownership, t.registrantEmail, t.registrantUserId,
       JSON_UNQUOTE(JSON_EXTRACT(t.rawPayload, '$.email')) AS payerEmail,
       EXISTS (SELECT 1 FROM CrmRegistrationMerge m WHERE m.teamId = t.id AND m.canonicalExternalId <> t.externalId) AS mergedAway
     FROM Team t WHERE t.id = ? AND t.archivedAt IS NULL`;

const asPlanInput = (row, seats) => ({
  id: row.id, source: row.source, externalId: row.externalId, ownership: row.ownership,
  registrantEmail: row.registrantEmail, payerEmail: row.payerEmail === "null" ? null : row.payerEmail,
  mergedAway: Boolean(Number(row.mergedAway)), seats,
});

try {
  if (revertFile) await revert(revertFile);
  else await backfill();
} finally {
  await db.end();
}

async function backfill() {
  const rows = await db.query(
    `SELECT t.id, t.number, s.slug AS series FROM Team t JOIN Series s ON s.id = t.seriesId AND s.archivedAt IS NULL
     WHERE t.archivedAt IS NULL ORDER BY s.slug, t.number`
  );
  const label = new Map(rows.map((row) => [row.id, `${row.series} #${row.number}`]));

  // The list shown (dry run) is computed the same way the writes will be.
  const decisions = [];
  for (const { id } of rows) {
    const [row] = await db.query(TEAM_ROW.replace(" AND t.archivedAt IS NULL", ""), [id]);
    const seats = await db.query("SELECT id, teamId, email, userId FROM Competitor WHERE teamId = ? ORDER BY position", [id]);
    decisions.push(planOwnership([asPlanInput(row, seats)]));
  }
  const set = decisions.flatMap((one) => one.set);
  const unknown = decisions.flatMap((one) => one.unknown);
  const alreadySet = decisions.reduce((sum, one) => sum + one.alreadySet, 0);

  console.log(`teams: ${rows.length} · to set as registrant: ${set.length} · stay unknown: ${unknown.length} · already decided: ${alreadySet}`);
  const reasons = {};
  for (const one of unknown) reasons[one.reason] = (reasons[one.reason] ?? 0) + 1;
  if (unknown.length) {
    console.log("unknown, by reason:", reasons);
    console.log("unknown teams (for BFT MENA to set on the registration page):");
    for (const one of unknown) console.log(`  ${label.get(one.id)} — ${one.reason}`);
  }
  if (!apply) {
    console.log("(dry run — pass --apply to write)");
    return;
  }

  const file = `backfill-ownership-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  console.log(`journal: ${file}`);
  let written = 0;
  let skipped = 0;
  for (const planned of set) {
    await db.beginTransaction();
    try {
      // Locked, then decided again on what the lock returned.
      const [row] = await db.query(TEAM_ROW + " FOR UPDATE", [planned.id]);
      const seats = row ? await db.query(SEATS, [planned.id]) : [];
      const now = row ? planOwnership([asPlanInput(row, seats)]).set[0] : null;
      if (!now) {
        await db.rollback();
        skipped += 1;
        journal(file, { phase: "skipped", id: planned.id, reason: "changed since the plan" });
        continue;
      }
      journal(file, { phase: "intent", id: now.id, before: { ...now.before, registrantUserId: row.registrantUserId ?? null }, after: now.after });
      const result = await db.query(
        `UPDATE Team SET ownership = 'registrant', registrantEmail = ?, registrantUserId = ?
         WHERE id = ? AND ownership = 'unknown' AND registrantEmail IS NULL`,
        [now.after.registrantEmail, now.after.registrantUserId, now.id]
      );
      if (result.affectedRows !== 1) {
        await db.rollback();
        skipped += 1;
        journal(file, { phase: "skipped", id: now.id, reason: "no longer unknown at write time" });
        continue;
      }
      crash("before-commit");
      await db.commit();
      crash("after-commit");
      journal(file, { phase: "done", id: now.id });
      written += 1;
    } catch (error) {
      await db.rollback().catch(() => undefined);
      throw error;
    }
  }
  console.log(`written: ${written} · skipped (changed since the plan): ${skipped} · journal: ${file}`);
}

async function revert(file) {
  // Every intent counts, done or not: a crash after the commit leaves an
  // intent whose "after" is in the database, and that is what is compared.
  const entries = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const intents = new Map();
  for (const entry of entries) if (entry.phase === "intent") intents.set(entry.id, entry);

  const log = `${file.replace(/\.jsonl$/, "")}.revert-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  let reverted = 0;
  let asBefore = 0;
  const changed = [];
  for (const entry of intents.values()) {
    await db.beginTransaction();
    try {
      const [row] = await db.query("SELECT ownership, registrantEmail, registrantUserId FROM Team WHERE id = ? FOR UPDATE", [entry.id]);
      const is = (state) => row && row.ownership === state.ownership && (row.registrantEmail ?? null) === (state.registrantEmail ?? null) && (row.registrantUserId ?? null) === (state.registrantUserId ?? null);
      if (is(entry.after)) {
        journal(log, { phase: "revert-intent", id: entry.id, from: entry.after, to: entry.before });
        await db.query("UPDATE Team SET ownership = ?, registrantEmail = ?, registrantUserId = ? WHERE id = ?",
          [entry.before.ownership, entry.before.registrantEmail, entry.before.registrantUserId, entry.id]);
        await db.commit();
        journal(log, { phase: "revert-done", id: entry.id });
        reverted += 1;
      } else {
        await db.rollback();
        if (is(entry.before)) asBefore += 1; // never written, or already reverted
        else changed.push(entry.id);
      }
    } catch (error) {
      await db.rollback().catch(() => undefined);
      throw error;
    }
  }
  console.log(`reverted: ${reverted} · already as before: ${asBefore} · changed since, left alone: ${changed.length} · journal: ${log}`);
  for (const id of changed) console.log(`  ${id}`);
}
