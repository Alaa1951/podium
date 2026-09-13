/**
 * DEV ONLY — signs in as each role and opens every screen that role can reach,
 * reporting the status and, importantly, where a redirect landed.
 *
 *   node scripts/walk.mjs
 *
 * The point is not that pages render prettily; it is that nobody is bounced
 * into a loop and nothing 500s. A redirect to /login means the walk's session
 * did not take; a redirect back to where it started means a loop.
 */
const BASE = process.env.WALK_BASE ?? "http://localhost:3000";
const PASSWORD = "PodiumDev!2026";

const ACCOUNTS = [
  {
    role: "admin",
    email: "walk-admin@bftmena.com",
    password: process.env.ADMIN_PASSWORD ?? PASSWORD,
    paths: [
      "/",
      "/series",
      "/studios",
      "/users",
      "/audit",
      "/account",
      "/series/podium-series-2",
      "/series/podium-series-2/studios",
      "/series/podium-series-2/registrations",
      "/series/podium-series-2/waves",
      "/series/podium-series-2/scores",
      "/series/podium-series-2/results",
      "/series/podium-series-2/settings",
      "/series/podium-series-2/board",
      // Somewhere an admin may not be: it must land, not loop.
      "/studio",
      "/me",
    ],
  },
  {
    role: "studio",
    email: "westwalk@bftmena.com",
    password: PASSWORD,
    paths: [
      "/studio",
      "/studio/podium-series-2",
      "/studio/podium-series-2/teams",
      "/studio/podium-series-2/results",
      "/account",
      // The admin console: must bounce to /studio, not into a loop.
      "/",
      "/series/podium-series-2/settings",
      // A competition this studio is not in: 404, never someone else's data.
      "/studio/test/teams",
    ],
  },
  {
    role: "competitor",
    email: "hind.aziz@example.com",
    password: PASSWORD,
    paths: ["/me", "/account", "/", "/studio", "/series/podium-series-2/scores"],
  },
  {
    role: "anonymous",
    paths: ["/login", "/competitor", "/results", "/", "/studio", "/me"],
  },
];

async function signIn(email, password) {
  const jar = new Map();
  const keep = (response) => {
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`);
  keep(csrfResponse);
  const { csrfToken } = await csrfResponse.json();

  const post = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    // The walk's own device, trusted by scripts/dev-accounts.mjs. Without it
    // every sign-in here issues a code — and consumes the one a real person is
    // waiting for.
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      deviceFingerprint: "podium-dev-walk",
      json: "true",
    }),
  });
  keep(post);

  return cookie();
}

let failures = 0;

for (const account of ACCOUNTS) {
  let cookie = "";
  if (account.email) {
    cookie = await signIn(account.email, account.password);
    if (!/session-token/.test(cookie)) {
      console.log(`\n${account.role.toUpperCase()} — could not sign in as ${account.email}`);
      failures++;
      continue;
    }
  }

  console.log(`\n${account.role.toUpperCase()}${account.email ? ` (${account.email})` : ""}`);

  for (const path of account.paths) {
    const response = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      headers: cookie ? { cookie } : {},
    });

    const location = response.headers.get("location");
    const target = location ? new URL(location, BASE).pathname : "";
    const loop = target === path;
    const bad = response.status >= 500 || loop;
    if (bad) failures++;

    const note = location ? `→ ${target}${loop ? "  ** LOOP **" : ""}` : "";
    console.log(`  ${bad ? "✗" : "·"} ${String(response.status).padEnd(4)} ${path.padEnd(42)} ${note}`);
  }
}

console.log(failures === 0 ? "\nNo loops, no 500s.\n" : `\n${failures} problem(s).\n`);
process.exit(failures === 0 ? 0 : 1);
