/**
 * THE GATE.
 *
 * A change is not done until this is clean. It runs the whole suite in one
 * command so that "I forgot to run the tests" cannot happen, and so the answer
 * to "is this safe?" is a single exit code rather than a judgement.
 *
 *   npm run verify           the full suite
 *   npm run verify -- --fast skip the production build (the slow one)
 *
 * Every gate must be clean: zero errors AND zero warnings. A warning that is
 * allowed to live becomes a warning nobody reads.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FAST = process.argv.includes("--fast");
const ROOT = process.cwd();

/** The longest a source file may be, in lines. */
const MAX_LINES = 300;

const results = [];
let failed = false;

function run(name, command, args, { expectClean } = {}) {
  process.stdout.write(`\n▸ ${name}\n`);

  const started = Date.now();
  const proc = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  // A zero exit code is not always success: eslint exits 0 with warnings, and
  // a warning nobody is forced to read is a warning that stays forever.
  const dirty = expectClean ? expectClean(output) : null;
  const ok = proc.status === 0 && !dirty;

  if (!ok) {
    failed = true;
    process.stdout.write(output.trimEnd() + "\n");
    if (dirty) process.stdout.write(`  ✗ ${dirty}\n`);
  }

  results.push({ name, ok, seconds, note: dirty ?? (ok ? "" : `exit ${proc.status}`) });
  process.stdout.write(`  ${ok ? "✓" : "✗"} ${name} (${seconds}s)\n`);
  return ok;
}

/** Every source file we wrote — generated output and migrations excluded. */
function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "generated" || entry.name === ".next") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * A file over this length is a file nobody reads to the end. The limit is
 * about keeping each one to a single job, which is why it counts source we
 * wrote and not generated output.
 */
function checkFileLengths() {
  process.stdout.write(`\n▸ file length (≤ ${MAX_LINES} lines)\n`);

  const offenders = [];
  for (const dir of ["src", "prisma", "scripts"]) {
    if (!fs.existsSync(path.join(ROOT, dir))) continue;
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const lines = fs.readFileSync(file, "utf8").split("\n").length;
      if (lines > MAX_LINES) {
        offenders.push({ file: path.relative(ROOT, file).replace(/\\/g, "/"), lines });
      }
    }
  }

  offenders.sort((a, b) => b.lines - a.lines);
  const ok = offenders.length === 0;
  if (!ok) {
    failed = true;
    for (const one of offenders) {
      process.stdout.write(`  ${String(one.lines).padStart(5)}  ${one.file}\n`);
    }
  }

  results.push({
    name: "file length",
    ok,
    seconds: "0.0",
    note: ok ? "" : `${offenders.length} file(s) over ${MAX_LINES} lines`,
  });
  process.stdout.write(`  ${ok ? "✓" : "✗"} file length\n`);
  return ok;
}

// ── The suite, in the order that fails fastest ───────────────────────────────

run("prisma generate", "npx", ["prisma", "generate", "--config", "prisma7.config.ts"]);

run("prisma migrate status", "npx", ["prisma", "migrate", "status", "--config", "prisma7.config.ts"], {
  expectClean: (out) =>
    /not yet been applied|drift|failed migration/i.test(out) ? "migrations are not up to date" : null,
});

run("typescript", "npx", ["tsc", "--noEmit"]);

run("eslint", "npx", ["eslint", "."], {
  expectClean: (out) => {
    const match = out.match(/(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
    if (!match) return null;
    const [, , errors, warnings] = match.map(Number);
    return errors + warnings > 0 ? `${errors} error(s), ${warnings} warning(s)` : null;
  },
});

run("tests", "npx", ["vitest", "run"]);

checkFileLengths();

if (!FAST) {
  run("next build", "npx", ["next", "build"]);
} else {
  results.push({ name: "next build", ok: true, seconds: "—", note: "skipped (--fast)" });
}

// ── The verdict ──────────────────────────────────────────────────────────────

process.stdout.write("\n" + "─".repeat(58) + "\n");
for (const one of results) {
  const mark = one.ok ? "✓" : "✗";
  process.stdout.write(
    `${mark}  ${one.name.padEnd(24)} ${String(one.seconds).padStart(6)}s  ${one.note}\n`
  );
}
process.stdout.write("─".repeat(58) + "\n");

if (failed) {
  process.stdout.write("\nNOT SAFE TO COMMIT — fix the gates above.\n\n");
  process.exit(1);
}

process.stdout.write("\nAll gates clean.\n\n");
