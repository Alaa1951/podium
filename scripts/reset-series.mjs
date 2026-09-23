/**
 * Resets ONE competition back to its first morning.
 *
 *   node scripts/reset-series.mjs                          # the only active competition
 *   node scripts/reset-series.mjs --series <slug>          # a specific one
 *   node scripts/reset-series.mjs --date 2026-09-23 --status live --yes
 *
 * Deletes every team in the competition — and with them, through the
 * database's own cascade, every competitor, score, zone entry, score lock,
 * score audit, portrait and waiting-list place (the waiting list is a column
 * on Team, not a table) — plus the waves and whatever the CRM intake was
 * holding. The competition itself survives: its zones and scoring formulas,
 * its staff assignments, its studios, its sponsors and its slug, so every
 * existing link keeps working. Team numbering restarts at 101 on its own,
 * because the next number is derived from the highest one left.
 *
 * It then re-dates the competition for a fresh start: `--date` (default:
 * today) becomes the competition date and the moment the live board unlocks,
 * sign-up opens, registration and score entry close at the end of that day,
 * and published results are withdrawn (resultsPublicAt back to null —
 * publishing sets it again). Anything not named here — studios-may-enter,
 * wave sizes, venue — is left exactly as it was.
 *
 * What it deliberately does NOT touch: user accounts, studios, roles, audit
 * logs, and any other competition in the database.
 *
 * Like restore-db.mjs, it names the target — HOST and database, and every
 * number it is about to delete — and refuses to run without --yes. On an
 * event day the expensive version of this mistake is not wiping the wrong
 * competition; it is wiping the right competition on the wrong machine.
 *
 * If CRM_SYNC_ENABLED is on, the 15-minute poller would begin re-creating
 * teams from GoHighLevel the moment the wipe lands. The script refuses to run
 * in that state without --allow-crm: turn the sync off (or onto dry-run)
 * first, or pass the flag to accept the re-pull.
 */
import path from "node:path";

import mariadb from "mariadb";

import { readDbCredentials, requirePassword } from "./db-credentials.mjs";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

const args = process.argv.slice(2);

/** The value after `--name`, or null when the flag is absent or bare. */
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i + 1 >= args.length ? null : args[i + 1];
}

const slug = flag("series");
const dateArg = flag("date");
const statusArg = flag("status");
const confirmed = args.includes("--yes");
const allowCrm = args.includes("--allow-crm");

const statuses = ["scheduled", "live"];
if (statusArg && !statuses.includes(statusArg)) {
  console.error(`--status must be one of: ${statuses.join(", ")}`);
  process.exit(1);
}

/** [year, monthIndex, day] from YYYY-MM-DD, validated — a typo in the date is
 * a competition held in the wrong month, which nobody notices until it is over. */
function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) {
    console.error(`--date must be YYYY-MM-DD, got "${dateArg}"`);
    process.exit(1);
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) {
    console.error(`--date is not a real calendar day: "${dateArg}"`);
    process.exit(1);
  }
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}

const now = new Date();
const [y, mo, d] = dateArg ? parseDay(dateArg) : [now.getFullYear(), now.getMonth(), now.getDate()];
const competitionDate = new Date(y, mo, d);
const dayName = competitionDate.toDateString();
const endOfDay = new Date(y, mo, d, 23, 59, 59, 999);
const newStatus = statusArg ?? "live";

if (process.env.CRM_SYNC_ENABLED === "1" && !allowCrm) {
  console.error(
    "CRM_SYNC_ENABLED is 1 — the moment the teams are gone, the 15-minute\n" +
      "poller would re-create them from GoHighLevel. Turn the sync off or onto\n" +
      "CRM_SYNC_DRY_RUN=1 first, or pass --allow-crm to accept the re-pull."
  );
  process.exit(1);
}

let credentials;
try {
  credentials = requirePassword(readDbCredentials());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const { user, password, database, host, port } = credentials;

const conn = await mariadb.createConnection({
  host,
  port: Number(port) || 3306,
  user,
  password,
  database,
});

try {
  const seriesSelect =
    "SELECT id, name, slug, status, competitionDate, signupOpen, archivedAt FROM Series";
  const rows = slug
    ? await conn.query(`${seriesSelect} WHERE slug = ?`, [slug])
    : await conn.query(`${seriesSelect} WHERE archivedAt IS NULL ORDER BY competitionDate ASC`);

  if (rows.length === 0) {
    console.error(slug ? `No competition with slug "${slug}".` : "No active competition found.");
    process.exit(1);
  }
  if (!slug && rows.length > 1) {
    console.error("More than one active competition — name one with --series <slug>:");
    for (const s of rows) console.error(`  ${s.slug}  ${s.name}  (${s.status})`);
    process.exit(1);
  }
  const series = rows[0];
  const id = series.id;

  const count = async (sql, params = [id]) => Number((await conn.query(sql, params))[0].c);
  const teams = await count("SELECT COUNT(*) AS c FROM Team WHERE seriesId = ?");
  const waitlisted = await count(
    "SELECT COUNT(*) AS c FROM Team WHERE seriesId = ? AND waitlistedAt IS NOT NULL"
  );
  const teamIdsSub = "(SELECT id FROM Team WHERE seriesId = ?)";
  const competitors = await count(`SELECT COUNT(*) AS c FROM Competitor WHERE teamId IN ${teamIdsSub}`);
  const scores = await count(`SELECT COUNT(*) AS c FROM Score WHERE teamId IN ${teamIdsSub}`);
  const waves = await count("SELECT COUNT(*) AS c FROM Wave WHERE seriesId = ?");
  const crmIntakes = await count("SELECT COUNT(*) AS c FROM CrmIntake WHERE seriesId = ?");
  const zones = await count("SELECT COUNT(*) AS c FROM Zone WHERE seriesId = ?");
  const studios = await count("SELECT COUNT(*) AS c FROM SeriesStudio WHERE seriesId = ?");
  const sponsors = await count("SELECT COUNT(*) AS c FROM Sponsor WHERE seriesId = ?");

  const target = `${host}:${port}/${database}`;
  const plan =
    `About to RESET "${series.name}" (${series.slug}) on ${target}.\n` +
    `Deleting: ${teams} teams (${waitlisted} waiting), ${competitors} competitors, ` +
    `${scores} scores, ${waves} waves, ${crmIntakes} CRM intake rows — and every score\n` +
    `entry, audit line and portrait hanging under them.\n` +
    `Keeping: ${zones} zones with their scoring, ${studios} participating studios, ` +
    `${sponsors} sponsors, and every user account.\n` +
    `Re-dating: competition starts ${dayName} (status ${newStatus}), sign-up opens,\n` +
    `registration and score entry close at the end of that day, published results\n` +
    `are withdrawn.\n` +
    "Re-run with --yes if that is what you want.";
  if (!confirmed) {
    console.error(plan);
    process.exit(1);
  }
  console.log(plan.replace("Re-run with --yes if that is what you want.", "Resetting…"));

  await conn.beginTransaction();
  try {
    // Portrait jobs point at a team or a competitor, and either side alone can
    // be null — clear them first so the team cascade cannot orphan one that
    // only referenced a competitor.
    await conn.query(
      `DELETE FROM PortraitJob WHERE teamId IN ${teamIdsSub} OR competitorId IN ` +
        `(SELECT id FROM Competitor WHERE teamId IN ${teamIdsSub})`,
      [id, id]
    );
    // Everything else competition-scoped and person-scoped goes with the team:
    // competitors, scores, zone entries and locks, score audits, portraits,
    // and the waiting list, which is a column on the row.
    const teamDelete = await conn.query("DELETE FROM Team WHERE seriesId = ?", [id]);
    const waveDelete = await conn.query("DELETE FROM Wave WHERE seriesId = ?", [id]);
    const crmDelete = await conn.query("DELETE FROM CrmIntake WHERE seriesId = ?", [id]);
    await conn.query(
      "UPDATE Series SET competitionDate = ?, boardOpensAt = ?, status = ?, signupOpen = 1, " +
        "registrationClosesAt = ?, scoreEntryClosesAt = ?, resultsPublicAt = NULL WHERE id = ?",
      [competitionDate, competitionDate, newStatus, endOfDay, endOfDay, id]
    );
    await conn.commit();

    const afterTeams = await count("SELECT COUNT(*) AS c FROM Team WHERE seriesId = ?");
    const afterWaves = await count("SELECT COUNT(*) AS c FROM Wave WHERE seriesId = ?");
    const afterScores = await count(`SELECT COUNT(*) AS c FROM Score WHERE teamId IN ${teamIdsSub}`);
    console.log(
      `[reset] "${series.name}" is fresh: ` +
        `${teamDelete.affectedRows} teams, ${waveDelete.affectedRows} waves and ` +
        `${crmDelete.affectedRows} CRM rows deleted. ` +
        `Now ${afterTeams} teams, ${afterWaves} waves, ${afterScores} scores. ` +
        `Starts ${dayName} (${newStatus}), sign-up open.`
    );
  } catch (error) {
    await conn.rollback();
    throw error;
  }
} catch (error) {
  console.error("[reset] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await conn.end();
}
