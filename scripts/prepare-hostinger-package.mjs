/**
 * HOSTINGER / CPANEL DEPLOYMENT PACKAGE.
 *
 * Bundles the production build into `dist-hostinger/` — one folder to upload
 * (or zip and upload):
 *
 *   npm run build            (first: produces .next/standalone + .next/static)
 *   npm run package:hostinger
 *
 * Contents:
 *   standalone server.js     the app itself (run: node server.js, PORT env)
 *   .next/static             client assets
 *   public/                  brand marks
 *   prisma/                  schema + migrations, for `npx prisma migrate deploy`
 *                            on the host (plus query engine via node_modules)
 *
 * The .env is NOT included — it never leaves the machine. Set the production
 * environment on the host (DATABASE_URL, NEXTAUTH_SECRET, OTP_SECRET,
 * SMTP_PASSWORD, OTP_DEV_BYPASS=false or unset).
 */
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const standaloneDir = path.join(rootDir, ".next", "standalone");
const staticDir = path.join(rootDir, ".next", "static");
const publicDir = path.join(rootDir, "public");
const prismaDir = path.join(rootDir, "prisma");
const distDir = path.join(rootDir, "dist-hostinger");

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const missing = [];
  if (!(await exists(standaloneDir))) missing.push(".next/standalone");
  if (!(await exists(staticDir))) missing.push(".next/static");
  if (missing.length > 0) {
    throw new Error(`Missing build artifacts: ${missing.join(", ")}. Run npm run build first.`);
  }

  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  // The standalone server is the app; static assets live beside it where the
  // server expects them; public + prisma ride along for the host.
  await fs.cp(standaloneDir, distDir, { recursive: true, dereference: true });
  await fs.cp(staticDir, path.join(distDir, ".next", "static"), { recursive: true, dereference: true });
  await fs.cp(publicDir, path.join(distDir, "public"), { recursive: true, dereference: true });
  await fs.cp(prismaDir, path.join(distDir, "prisma"), {
    recursive: true,
    filter: (src) => !src.includes("migrations_archive"),
  });

  console.log(`[hostinger] package ready → ${distDir}`);
  console.log("[hostinger] upload contents, set env on the host, then: node server.js");
}

main().catch((error) => {
  console.error("[hostinger] packaging failed:", error.message);
  process.exit(1);
});
