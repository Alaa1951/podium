/**
 * Event-day insurance: a full dump of the database into ./db-backups.
 *
 * Run it between waves. It works out for itself whether to run `mysqldump`
 * here or inside the Docker container, and SAYS WHICH IT CHOSE — it used to
 * default to the container, so on the production server, which has none, it
 * failed and wrote no file unless the operator knew to pass --host. Force
 * either with --host or --container.
 *
 * Credentials come from DATABASE_URL, or from MYSQL_* if those are set. See
 * scripts/db-credentials.mjs for why, and for the bug that taught us.
 *
 *   node scripts/backup-db.mjs
 *   node scripts/backup-db.mjs --host        (this machine's mysqldump)
 *   node scripts/backup-db.mjs --container   (the dev Docker container)
 *   node scripts/backup-db.mjs --keep 20
 *
 * Restore with:  node scripts/restore-db.mjs db-backups/<file>.sql
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  chooseTransport,
  clientCommand,
  readDbCredentials,
  redactSecrets,
  requirePassword,
} from "./db-credentials.mjs";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

const args = process.argv.slice(2);
const useHost = args.includes("--host");
const useContainer = args.includes("--container");
const keepIndex = args.indexOf("--keep");
const keep = keepIndex >= 0 ? Number(args[keepIndex + 1]) || 14 : 14;

let credentials;
try {
  credentials = requirePassword(readDbCredentials());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}


/** Is this client actually here? Asked, not assumed — see chooseTransport. */
function canRun(client) {
  try {
    execFileSync(client, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const outDir = path.join(process.cwd(), "db-backups");
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(outDir, `podium_${stamp}.sql`);

// `--single-transaction` keeps the dump consistent without locking the tables,
// so a backup mid-wave does not stall score entry. How the password reaches
// the client — and why it differs between the two paths — is in
// db-credentials.mjs, next to the test that holds it.
// Which client, decided by what is actually on this machine — and said out
// loud, because a backup taken from somewhere other than you think is worse
// than no backup at all.
let transport;
try {
  ({ transport } = chooseTransport({ useHost, useContainer, clientOnPath: canRun("mysqldump") }));
} catch (error) {
  console.error(`[backup] ${error.message}`);
  process.exit(1);
}
console.log(
  transport === "direct"
    ? `[backup] ${credentials.database} on ${credentials.host}:${credentials.port}`
    : `[backup] ${credentials.database} in container ${credentials.container}`
);

const { command, args: dumpArgs, env } = clientCommand("mysqldump", credentials, { transport });

try {
  const stdout = execFileSync(command, dumpArgs, { env, maxBuffer: 1024 * 1024 * 512 });

  fs.writeFileSync(outFile, stdout);
  const sizeKb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`[backup] ${path.relative(process.cwd(), outFile)} — ${sizeKb} KB`);
} catch (error) {
  console.error("[backup] failed:", redactSecrets(error instanceof Error ? error.message : error, credentials));
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
