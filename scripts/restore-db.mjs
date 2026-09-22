/**
 * Restores a dump made by scripts/backup-db.mjs.
 *
 *   node scripts/restore-db.mjs db-backups/podium_2026-10-03T09-20-00.sql
 *
 * This REPLACES the current contents of the database. It refuses to run unless
 * the file exists and you confirm with --yes, because on an event day the wrong
 * restore costs more than the incident it was meant to fix.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { clientCommand, readDbCredentials, requirePassword } from "./db-credentials.mjs";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const confirmed = args.includes("--yes");
const useHost = args.includes("--host");

if (!file) {
  console.error("Usage: node scripts/restore-db.mjs <dump.sql> --yes");
  process.exit(1);
}

const dumpPath = path.resolve(process.cwd(), file);
if (!fs.existsSync(dumpPath)) {
  console.error(`No such dump: ${dumpPath}`);
  process.exit(1);
}

let credentials;
try {
  credentials = requirePassword(readDbCredentials());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const { database, host, port, container } = credentials;

if (!confirmed) {
  const sizeKb = Math.round(fs.statSync(dumpPath).size / 1024);
  // The HOST is named, not just the database. The expensive version of this
  // mistake is not restoring the wrong dump — it is restoring the right dump
  // onto the wrong machine, and until now this line could not tell them apart.
  const target = useHost ? `${host}:${port}` : `container ${container}`;
  console.error(
    `About to REPLACE the "${database}" database on ${target} ` +
      `with ${path.basename(dumpPath)} (${sizeKb} KB).\n` +
      "Re-run with --yes if that is what you want."
  );
  process.exit(1);
}

const sql = fs.readFileSync(dumpPath);
const { command, args: mysqlArgs, env } = clientCommand("mysql", credentials, { useHost });

try {
  execFileSync(command, mysqlArgs, { env, input: sql });
  console.log(`[restore] ${database} restored from ${path.basename(dumpPath)}`);
} catch (error) {
  console.error("[restore] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
