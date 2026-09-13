/**
 * Event-day insurance: a full dump of the database into ./db-backups.
 *
 * Run it between waves. It shells out to `mysqldump` inside the Docker
 * container by default, so nothing has to be installed on the operator's
 * machine; pass --host to dump from a MySQL reachable directly instead.
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

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

const args = process.argv.slice(2);
const useHost = args.includes("--host");
const keepIndex = args.indexOf("--keep");
const keep = keepIndex >= 0 ? Number(args[keepIndex + 1]) || 14 : 14;

const database = process.env.MYSQL_DATABASE || "pudem";
const user = process.env.MYSQL_USER || "pudem";
const password = process.env.MYSQL_PASSWORD || "";
const container = process.env.MYSQL_CONTAINER || "pudem-mysql";
const port = process.env.MYSQL_PORT || "3306";

if (!password) {
  console.error("MYSQL_PASSWORD is not set — check .env");
  process.exit(1);
}

const outDir = path.join(process.cwd(), "db-backups");
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(outDir, `podium_${stamp}.sql`);

// `--single-transaction` keeps the dump consistent without locking the tables,
// so a backup mid-wave does not stall score entry.
const dumpArgs = [
  `--user=${user}`,
  `--password=${password}`,
  "--single-transaction",
  "--quick",
  "--default-character-set=utf8mb4",
  database,
];

try {
  const stdout = useHost
    ? execFileSync("mysqldump", [`--host=127.0.0.1`, `--port=${port}`, ...dumpArgs], {
        maxBuffer: 1024 * 1024 * 512,
      })
    : execFileSync("docker", ["exec", container, "mysqldump", ...dumpArgs], {
        maxBuffer: 1024 * 1024 * 512,
      });

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
