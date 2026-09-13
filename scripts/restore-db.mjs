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

const database = process.env.MYSQL_DATABASE || "pudem";
const user = process.env.MYSQL_USER || "pudem";
const password = process.env.MYSQL_PASSWORD || "";
const container = process.env.MYSQL_CONTAINER || "pudem-mysql";
const port = process.env.MYSQL_PORT || "3306";

if (!confirmed) {
  const sizeKb = Math.round(fs.statSync(dumpPath).size / 1024);
  console.error(
    `About to REPLACE the "${database}" database with ${path.basename(dumpPath)} (${sizeKb} KB).\n` +
      "Re-run with --yes if that is what you want."
  );
  process.exit(1);
}

const sql = fs.readFileSync(dumpPath);
const mysqlArgs = [`--user=${user}`, `--password=${password}`, "--default-character-set=utf8mb4", database];

try {
  if (useHost) {
    execFileSync("mysql", [`--host=127.0.0.1`, `--port=${port}`, ...mysqlArgs], { input: sql });
  } else {
    execFileSync("docker", ["exec", "-i", container, "mysql", ...mysqlArgs], { input: sql });
  }
  console.log(`[restore] ${database} restored from ${path.basename(dumpPath)}`);
} catch (error) {
  console.error("[restore] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
