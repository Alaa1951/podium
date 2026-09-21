#!/usr/bin/env node
/**
 * FINISH THE STANDALONE BUILD.
 *
 * `next build` with `output: "standalone"` produces a server that carries its
 * own node_modules — but NOT the static assets it serves. `.next/static` and
 * `public/` have to be copied in afterwards, and Next does not do it.
 *
 * Left undone, the failure is silent and total: the server starts, pages
 * render, and every JavaScript chunk 404s. Nothing hydrates. A local QA pass
 * found the worst version of that — the sign-in form fell back to a native GET
 * submit and put an email and password in the query string without ever
 * authenticating.
 *
 * The step was documented in two places (OPERATIONS.md, RESUME.md) and done by
 * hand on the server. Documented and manual is one forgotten command away from
 * a broken host, so it runs as `postbuild` now: `npm run build` produces a
 * bundle that actually works, and the deploy script doing it again is harmless.
 *
 * IT DOES NOT TOUCH `.env`, though the docs describe deleting one by hand.
 * That step is right only when the bundle is built on a LAPTOP and shipped to
 * a host: the `.env` inside it is then the developer's and would shadow the
 * host's. When the build runs ON the host — which is how this deploy works —
 * the `.env` copied in is the host's own, and deleting it would take the
 * database URL away from the server that just built it. A script cannot tell
 * the two apart, and guessing wrong takes production down, so it leaves the
 * file alone and OPERATIONS.md keeps the rule for the case that needs it.
 *
 * Plain `node:fs`, no dependency, and cross-platform: this runs on a Windows
 * laptop and on the Linux host.
 */
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  // Not a standalone build — nothing to finish, and not an error.
  console.log("· no .next/standalone (not a standalone build) — nothing to do");
  process.exit(0);
}

/** Copy a directory into the bundle, overwriting what is there. */
function bring(from, to, label) {
  const source = path.join(root, from);
  if (!existsSync(source)) {
    console.log(`· ${label}: nothing at ${from} — skipped`);
    return;
  }
  cpSync(source, path.join(standalone, to), { recursive: true });
  console.log(`✓ ${label}: ${from} → .next/standalone/${to}`);
}

bring(path.join(".next", "static"), path.join(".next", "static"), "static assets");
bring("public", "public", "public files");
