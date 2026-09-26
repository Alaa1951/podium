/**
 * Shifts every competition datetime −3 hours — ONCE.
 *
 * The settings forms always meant Qatar time, but the server stored the typed
 * wall time as UTC, so a competition set for 02:00 was kept as 02:00Z, which
 * displays as 05:00 Qatar — three hours AHEAD of the intended instant
 * (02:00 Qatar = 23:00Z). The app now parses entries as Qatar time
 * (src/lib/qatar-time.ts); this script repairs the rows saved before that fix
 * by subtracting three hours from the stored instants: 02:00Z — which MEANT
 * 02:00 Qatar — becomes 23:00Z the evening before, which IS 02:00 Qatar.
 *
 * Columns: competitionDate, boardOpensAt, registrationClosesAt,
 * registrationsFinalAt, scoreEntryClosesAt, resultsPublicAt,
 * championsAnnouncedAt. Wave start times are plain "HH:mm" strings and wave
 * startedAt/endsAt are true instants, so neither is touched.
 *
 *   node scripts/fix-qatar-times.mjs                    # dry run: prints every change
 *   node scripts/fix-qatar-times.mjs --apply            # writes
 *   node scripts/fix-qatar-times.mjs --apply --exclude podium-series-1   # repeatable
 *
 * A row seeded with an explicit +03:00 offset is already correct — exclude it
 * by id or slug. Run the script ONCE: there is no marker, and a second run
 * moves every competition another three hours.
 */
import path from "node:path";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client.ts";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

const SHIFT_MS = 3 * 60 * 60 * 1000; // SUBTRACTED — the bug stored instants 3h late.
const COLUMNS = [
  "competitionDate",
  "boardOpensAt",
  "registrationClosesAt",
  "registrationsFinalAt",
  "scoreEntryClosesAt",
  "resultsPublicAt",
  "championsAnnouncedAt",
];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const excludes = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--exclude") excludes.push(args[++i]);
}

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("DATABASE_URL is not set (.env next to the repo root).");
  process.exit(1);
}
const target = new URL(url);
console.log(`Target: ${target.hostname}${target.port ? `:${target.port}` : ""}${target.pathname}`);
console.log(apply ? "Mode: APPLY\n" : "Mode: DRY RUN (pass --apply to write)\n");

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(url) });

const series = await prisma.series.findMany({
  select: { id: true, name: true, slug: true, ...Object.fromEntries(COLUMNS.map(c => [c, true])) },
  orderBy: { competitionDate: "asc" },
});

let touchedSeries = 0;
let touchedColumns = 0;

for (const row of series) {
  if (excludes.includes(row.id) || excludes.includes(row.slug)) {
    console.log(`= ${row.slug} — ${row.name}: EXCLUDED`);
    continue;
  }
  const updates = {};
  const lines = [];
  for (const column of COLUMNS) {
    const value = row[column];
    if (!value) continue;
    const shifted = new Date(value.getTime() - SHIFT_MS);
    updates[column] = shifted;
    touchedColumns++;
    lines.push(`    ${column}: ${value.toISOString()} → ${shifted.toISOString()}`);
  }
  if (!lines.length) {
    console.log(`= ${row.slug} — ${row.name}: nothing to shift`);
    continue;
  }
  console.log(`* ${row.slug} — ${row.name}`);
  for (const line of lines) console.log(line);
  touchedSeries++;
  if (apply) await prisma.series.update({ where: { id: row.id }, data: updates });
}

console.log(
  `\n${apply ? "Shifted" : "Would shift"} ${touchedColumns} column(s) across ${touchedSeries} competition(s), ` +
  `${series.length - touchedSeries} untouched.`
);
if (!apply && touchedColumns) console.log("Check the numbers above, then run again with --apply.");

await prisma.$disconnect();
