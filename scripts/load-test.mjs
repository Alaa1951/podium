/**
 * LOAD TEST — event-day concurrency check.
 *
 *   node scripts/load-test.mjs [concurrency] [seconds]
 *
 * Defaults: 100 concurrent workers, 30 seconds.
 *
 * Simulates the event-day mix: competitors and studios hammering the public
 * results, the public poll, and (signed in) the live board and its poll.
 * Pure Node — no dependencies. Every worker holds one session cookie; JWT
 * sessions are cookie-reads, so sharing the pattern one-user-one-cookie is
 * what the server actually sees.
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CONCURRENCY = Number(process.argv[2] || 100);
const SECONDS = Number(process.argv[3] || 30);

const EMAIL = process.env.LOAD_USER || "walk-admin@bftmena.com";
const PASSWORD = process.env.LOAD_PASSWORD || "PodiumDev!2026";

const SLUG = "podium-series-2";
const SERIES_ID = process.env.LOAD_SERIES_ID || "";

const mix = [
  { path: "/results", weight: 2, auth: false },
  { path: `/results/podium-series-1/Womens/Pro`, weight: 3, auth: false },
  { path: `/api/results/podium-series-1/Womens/Pro`, weight: 2, auth: false },
  // Signed-in targets (live board + its poll). Off by default: on a real event
  // day the 500-1500 concurrent crowd is VIEWERS on the public results — the
  // staff board is a handful of laptops. Set LOAD_COOKIE to include them.
  { path: `/series/${SLUG}/board`, weight: 1, auth: true, needsCookie: true },
  { path: `/api/series/${SERIES_ID || SLUG}/board`, weight: 2, auth: true, needsCookie: true },
].filter((m) => !m.needsCookie || process.env.LOAD_COOKIE);

function pick() {
  const total = mix.reduce((sum, m) => sum + m.weight, 0);
  let roll = Math.random() * total;
  for (const m of mix) {
    roll -= m.weight;
    if (roll <= 0) return m;
  }
  return mix[0];
}

async function login() {
  // Only needed when the mix includes signed-in targets.
  if (!mix.some((m) => m.auth)) return "";

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { cache: "no-store" });
  const { csrfToken } = await csrfRes.json();
  const setCookie = csrfRes.headers.get("set-cookie") || "";
  const csrfCookie = setCookie.split(";")[0];

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfCookie,
    },
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      redirect: "false",
      json: "true",
    }),
    redirect: "manual",
  });

  const raw = res.headers.get("set-cookie") || "";
  const session = raw
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0])
    .filter((c) => c.includes("session-token"));
  if (!session.length) throw new Error("no session cookie — login failed");
  return session.join("; ");
}

const latencies = [];
const codes = new Map();
let done = 0;
let errors = 0;
const deadline = Date.now() + SECONDS * 1000;

async function worker(cookie) {
  while (Date.now() < deadline) {
    const target = pick();
    const started = performance.now();
    let status = 0;
    try {
      const res = await fetch(`${BASE}${target.path}`, {
        cache: "no-store",
        headers: target.auth ? { cookie } : undefined,
      });
      status = res.status;
      await res.arrayBuffer();
    } catch {
      status = -1;
    }
    const ms = performance.now() - started;
    latencies.push(ms);
    done += 1;
    codes.set(status, (codes.get(status) || 0) + 1);
    if (status >= 400 || status === 0) errors += 1;
  }
}

function percentile(list, p) {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const cookie = await login();
console.log(`Load test: ${CONCURRENCY} concurrent × ${SECONDS}s against ${BASE}`);
console.log(`Targets: results page, public leaderboard, public poll, live board, board poll\n`);

const started = performance.now();
await Promise.all(
  Array.from({ length: CONCURRENCY }, () => worker(cookie))
);
const wallSeconds = (performance.now() - started) / 1000;

const codesLine = [...codes.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([code, count]) => `${code}×${count}`)
  .join("  ");

console.log(`requests      ${done}`);
console.log(`throughput    ${(done / wallSeconds).toFixed(1)} req/s`);
console.log(`errors        ${errors} (${codesLine})`);
console.log(`p50           ${percentile(latencies, 50).toFixed(0)} ms`);
console.log(`p95           ${percentile(latencies, 95).toFixed(0)} ms`);
console.log(`p99           ${percentile(latencies, 99).toFixed(0)} ms`);
console.log(`max           ${Math.max(...latencies).toFixed(0)} ms`);
process.exit(0);
