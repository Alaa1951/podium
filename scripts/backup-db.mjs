/**
 * Event-day insurance: a full dump of the database into ./db-backups.
 *
 * Run it between waves. It shells out to `mysqldump` inside the Docker
 * container by default, so nothing has to be installed on the operator's
 * machine; pass --host to dump from a MySQL reachable directly instead — which
 * is the form to use on the production server, where there is no container.
 *
 * Credentials come from DATABASE_URL, or from MYSQL_* if those are set. See
 * scripts/db-credentials.mjs for why, and for the bug that taught us.
 *
 *   node scripts/backup-db.mjs
 *   node scripts/backup-db.mjs --host
 *   node scripts/backup-db.mjs --keep 20
 *
 * Restore with:  node scripts/restore-db.mjs db-backups/<file>.sql
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { clientCommand, readDbCredentials, requirePassword } from "./db-credentials.mjs";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

const args = process.argv.slice(2);
const useHost = args.includes("--host");
const keepIndex = args.indexOf("--keep");
const keep = keepIndex >= 0 ? Number(args[keepIndex + 1]) || 14 : 14;

let credentials;
try {
  credentials = requirePassword(readDbCredentials());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}


const outDir = path.join(process.cwd(), "db-backups");
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(outDir, `podium_${stamp}.sql`);

// `--single-transaction` keeps the dump consistent without locking the tables,
// so a backup mid-wave does not stall score entry. How the password reaches
// the client — and why it differs between the two paths — is in
// db-credentials.mjs, next to the test that holds it.
const { command, args: dumpArgs, env } = clientCommand("mysqldump", credentials, { useHost });

try {
  const stdout = execFileSync(command, dumpArgs, { env, maxBuffer: 1024 * 1024 * 512 });

  fs.writeFileSync(outFile, stdout);
  const sizeKb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`[backup] ${path.relative(process.cwd(), outFile)} — ${sizeKb} KB`);
} catch (error) {
  console.error("[backup] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}

// Keep the most recent N and drop the rest, so an event day of backups does not
// silently fill the disk.
const existing = fs
  .readdirSync(outDir)
  .filter((f) => f.startsWith("podium_") && f.endsWith(".sql"))
  .sort()
  .reverse();

for (const stale of existing.slice(keep)) {
  fs.unlinkSync(path.join(outDir, stale));
  console.log(`[backup] pruned ${stale}`);
}
