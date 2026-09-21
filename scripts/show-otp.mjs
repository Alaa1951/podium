/**
 * Prints the most recent sign-in code from the development server log.
 *
 * With no SMTP configured, `npm run dev` writes mail to its own output instead
 * of sending it — which is what you want locally, but only helps if you can see
 * that output. When the server is running in the background, this reads the
 * code out of `dev-server.log` for you.
 *
 *   npm run otp
 *   npm run otp -- admin@bftmena.com     one address only
 *   npm run otp -- --watch
 *
 * A code is single-use and lives ten minutes, and a log file outlives both the
 * code and the server that wrote it. So this does not just print the newest
 * line: it asks the database whether that code is still outstanding, and says
 * plainly when it has already been used, expired, or run out of attempts.
 * Typing a code that was spent by something else is otherwise indistinguishable
 * from typing it wrong.
 *
 * Development only: it refuses to run in production. It reads the log for the
 * code and the challenge table for that code's STATE — never the code itself,
 * which is stored only as an HMAC and cannot be read back by anyone.
 */
import fs from "node:fs";
import path from "node:path";

process.loadEnvFile?.(path.join(process.cwd(), ".env"));

if (process.env.NODE_ENV === "production") {
  console.error("Not available in production — codes are emailed.");
  process.exit(1);
}

const TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const logPath = path.join(process.cwd(), process.env.DEV_LOG_FILE || "dev-server.log");

const args = process.argv.slice(2);
const watching = args.includes("--watch");
const wanted = args.find((arg) => arg.includes("@"))?.toLowerCase() ?? null;

if (!fs.existsSync(logPath)) {
  console.error(
    `No ${path.basename(logPath)} here.\n\n` +
      "Either run the server in your own terminal, where the code is printed directly:\n" +
      "  npm run dev\n\n" +
      "or run it in the background so this script can read it:\n" +
      "  npm run dev:bg"
  );
  process.exit(1);
}

// `at=` is written by the development mail transport. Logs from before it was
// added have no timestamp; those codes are reported as undateable rather than
// silently assumed fresh.
const BLOCK =
  /\[EMAIL:dev\] (?:at=(\S+)\s+\[EMAIL:dev\] )?to=(\S+)[\s\S]*?Your PODIUM code is: (\d{6})/g;
const LINK = /(https?:\/\/\S+\/(?:activate|reset-password)\?token=[a-f0-9]+)/g;

function minutesAgo(iso) {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : (Date.now() - at) / 60_000;
}

function age(minutes) {
  if (minutes === null) return "age unknown";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
}

/**
 * The state of the newest login challenge for an address, from the challenge
 * table. Returns null if the database cannot be reached — the log-only report
 * is still worth printing, it just cannot say whether the code is spent.
 */
async function challengeState(email) {
  try {
    const { PrismaMariaDb } = await import("@prisma/adapter-mariadb");
    const { PrismaClient } = await import("../src/generated/prisma/client.ts");
    const prisma = new PrismaClient({
      adapter: new PrismaMariaDb(process.env.DATABASE_URL),
    });

    try {
      const row = await prisma.otpChallenge.findFirst({
        where: { user: { email: email.toLowerCase() }, purpose: "login" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, expiresAt: true, consumedAt: true, attempts: true },
      });
      return row ?? null;
    } finally {
      await prisma.$disconnect();
    }
  } catch {
    return null;
  }
}

function read() {
  const log = fs.readFileSync(logPath, "utf8");

  const codes = [...log.matchAll(BLOCK)].map(([, at, to, code]) => ({
    at,
    to,
    code,
    minutes: minutesAgo(at),
  }));

  return {
    codes: wanted ? codes.filter((c) => c.to.toLowerCase() === wanted) : codes,
    everyAddress: [...new Set(codes.map((c) => c.to))],
    link: [...log.matchAll(LINK)].at(-1)?.[1],
    fileMinutes: (Date.now() - fs.statSync(logPath).mtimeMs) / 60_000,
  };
}

async function report(previous) {
  const { codes, everyAddress, link, fileMinutes } = read();
  const latest = codes.at(-1);

  if (!latest && !link) {
    console.log(
      wanted
        ? `\nNo code for ${wanted} in ${path.basename(logPath)}.` +
            (everyAddress.length ? `\nAddresses in this log: ${everyAddress.join(", ")}` : "")
        : "\nNothing yet — try signing in, then run this again.\n"
    );
    return previous;
  }

  if (latest && latest.code !== previous) {
    const challenge = await challengeState(latest.to);
    const now = Date.now();

    // The challenge row is the authority. The log only proves a code was sent.
    const spent =
      challenge?.consumedAt && latest.at && challenge.createdAt.getTime() >= Date.parse(latest.at) - 2000
        ? challenge.consumedAt
        : null;
    const expired = challenge
      ? challenge.expiresAt.getTime() < now
      : latest.minutes !== null && latest.minutes > TTL_MINUTES;
    const burned = (challenge?.attempts ?? 0) >= 5;

    const flag = spent ? "   ← ALREADY USED" : expired ? "   ← EXPIRED" : burned ? "   ← TOO MANY TRIES" : "";

    console.log(`\n  code   ${latest.code}${flag}`);
    console.log(`  for    ${latest.to}`);
    console.log(`  issued ${age(latest.minutes)}`);

    if (spent) {
      console.log(`  used   ${age((now - spent.getTime()) / 60_000)}`);
      console.log(
        "\n  A code can only be used once. Something already signed in with this\n" +
          "  one — another tab, or a script. Press Resend code on the verify\n" +
          "  screen, then run this again."
      );
    } else if (expired) {
      console.log(
        `\n  A code lives ${TTL_MINUTES} minutes, and this one is past that.\n` +
          `  ${path.basename(logPath)} was last written to ${age(fileMinutes)} — if that is not\n` +
          "  just now, no server is writing here. Start one with `npm run dev:bg`,\n" +
          "  then sign in again and re-run this."
      );
    } else if (burned) {
      console.log(
        "\n  This code has had too many wrong attempts and will no longer verify.\n" +
          "  Press Resend code on the verify screen, then run this again."
      );
    } else if (challenge) {
      const left = Math.max(0, (challenge.expiresAt.getTime() - now) / 60_000);
      console.log(`  valid  yes — ${Math.floor(left)} min ${Math.floor((left % 1) * 60)} s left`);

      // The code comes from the LOG; the challenge comes from the database.
      // When the database holds a NEWER challenge than anything in the log,
      // the code printed above is stale — it belongs to an earlier challenge
      // that this one replaced. That happens whenever mail was really being
      // sent for a while (EMAIL_SEND_IN_DEV=true), so nothing was logged.
      // Without this line the tool prints an old code and calls it valid.
      const loggedAt = latest.at ? Date.parse(latest.at) : NaN;
      if (Number.isFinite(loggedAt) && challenge.createdAt.getTime() > loggedAt + 2000) {
        console.log(
          `\n  ⚠ The newest code for ${latest.to} was issued ` +
            `${age((now - challenge.createdAt.getTime()) / 60_000)} and is NOT in\n` +
            `  ${path.basename(logPath)} — the one above is an older one and will not verify.\n` +
            "  That happens when mail is really being sent. Restart the server with\n" +
            "  EMAIL_SEND_IN_DEV=false, press Resend code, then run this again."
        );
      }
    }

    if (!spent && !expired && !wanted && everyAddress.length > 1) {
      console.log(`\n  Other addresses in this log: ${everyAddress.join(", ")}`);
      console.log("  Narrow it with:  npm run otp -- <email>");
    }
  }

  if (link) console.log(`  link   ${link}`);
  console.log();

  return latest?.code ?? previous;
}

if (watching) {
  console.log(`Watching ${path.basename(logPath)} — Ctrl+C to stop.`);
  let seen = await report(undefined);
  fs.watchFile(logPath, { interval: 700 }, () => {
    void report(seen).then((code) => {
      seen = code;
    });
  });
} else {
  await report(undefined);
}
