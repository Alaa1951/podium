/**
 * SPEND EVERY OUTSTANDING SIGN-IN CODE AND EMAILED LINK.
 *
 * Run once if the server is ever rolled back to a build that predates the
 * address-bound rule (plan v7 §15). Codes and links issued under the new
 * rule carry the address they went to; the old code does not check it, so
 * none of them may stay usable under that code. Everything still open is
 * marked consumed/used; people simply request a new one. Nothing else is
 * touched — no proof, no link, no session.
 *
 * Dry run by default; --apply writes, and writes a journal of the ids it
 * spent next to this script.
 *
 *   node --env-file=/opt/podium/.env scripts/spend-open-auth-tokens.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import mariadb from "mariadb";
import { readDbCredentials, requirePassword } from "./db-credentials.mjs";

try { process.loadEnvFile(); } catch (e) { if (e.code !== "ENOENT") throw e; }
const apply = process.argv.includes("--apply");
const credentials = requirePassword(readDbCredentials());
const db = await mariadb.createConnection({
  host: credentials.host, user: credentials.user, password: credentials.password, database: credentials.database,
  allowPublicKeyRetrieval: ["localhost", "127.0.0.1", "::1"].includes(credentials.host), port: Number(credentials.port), timezone: "Z",
});

try {
  const codes = Array.from(await db.query("SELECT id FROM OtpChallenge WHERE consumedAt IS NULL AND expiresAt > NOW(3)"));
  const links = Array.from(await db.query("SELECT id FROM AuthToken WHERE usedAt IS NULL AND expiresAt > NOW(3)"));
  console.log(`Open codes: ${codes.length}; open links: ${links.length}${apply ? "" : " (dry run — pass --apply to spend them)"}`);
  if (!apply) process.exit(0);

  await db.beginTransaction();
  const now = new Date();
  if (codes.length) await db.query("UPDATE OtpChallenge SET consumedAt = ? WHERE id IN (?)", [now, codes.map((r) => r.id)]);
  if (links.length) await db.query("UPDATE AuthToken SET usedAt = ? WHERE id IN (?)", [now, links.map((r) => r.id)]);
  await db.commit();

  const journal = path.join(path.dirname(new URL(import.meta.url).pathname), `spend-open-auth-tokens.${now.toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(journal, JSON.stringify({ at: now.toISOString(), codes: codes.map((r) => r.id), links: links.map((r) => r.id) }, null, 2));
  console.log(`Spent ${codes.length} codes and ${links.length} links. Journal: ${journal}`);
} finally {
  await db.end();
}
