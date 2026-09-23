# Operations

Getting it running, and running it on an event day.

---

## Local

```bash
cp .env.example .env
# fill in NEXTAUTH_SECRET, MYSQL_PASSWORD, DEFAULT_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
npm install
npm run db:up          # MySQL 8.4 in Docker
npm run db:migrate     # schema
npm run db:seed        # four studios, two series, a live round of 108 teams
npm run dev
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Mail in development.** With `SMTP_HOST` unset, mail is written to the server
log instead of sent — sign-in codes and invitation links stay usable while
nothing leaves the machine. Watch the terminal for `[EMAIL:dev]`.

**First sign-in.** Use `DEFAULT_ADMIN_EMAIL` with `SEED_ADMIN_PASSWORD`, then
read the six-digit code out of the terminal.

If `SEED_ADMIN_PASSWORD` was left blank, the admin account is created in
`invited` state — use **Forgot password** on the sign-in screen and take the
activation link from the log.

### Migrations and the shadow database

`prisma migrate dev` needs permission to create a temporary shadow database. The
seeded MySQL user has it; if you rebuild the container from scratch with a
narrower grant:

```bash
docker exec pudem-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "GRANT ALL PRIVILEGES ON *.* TO 'pudem'@'%'; FLUSH PRIVILEGES;"
```

---

## Checks

```bash
npm test           # 109 unit tests: scoring, access rules, rate limiting, crypto, i18n
npm run type-check
npm run lint
npm run build
```

`npm test` is the one to run before touching scoring or `access.ts`. Those two
files decide podiums and who can see what.

---

## Deployment

### Docker

```bash
docker compose up --build
```

Applies migrations, seeds only if the live event has no teams, then serves on
`:3000` as a non-root user with a health check on `/api/health`.

### Plain Node host

`next build` produces a self-contained bundle, so the app runs without
installing the dependency tree on the host:

```bash
npm ci
npm run build
# copy to the host: .next/standalone, .next/static, public, server.js,
#                   prisma/, prisma7.config.ts, src/generated/
node server.js
```

`npm run build` now finishes the standalone bundle itself (`postbuild` →
`scripts/finish-standalone.mjs`): it copies `.next/static` and `public/` into
`.next/standalone`. Running that copy again in a deploy script is harmless.

It was a manual step, and it fails silently when forgotten: the server starts
and renders pages while every JavaScript chunk 404s. Nothing hydrates, and a
sign-in form falls back to a native GET that puts the password in the query
string. (The auth forms now carry `method="post"` so that last part cannot
happen, but the page is still dead.)

**The `.env` deletion below is still by hand, and deliberately so.** Delete the
`.env` inside `.next/standalone` only when the bundle was built on a LAPTOP and
is being shipped to a host — that one is the developer's and would shadow the
host's environment. When the build runs ON the host, the `.env` copied in is
the host's own and deleting it takes the database away from the server. No
script can tell the two apart, so neither does this one.

### Production — Hostinger VPS

Live at `https://podium.bftmiddleeast.com` (Let's Encrypt, auto-renews).
OpenLiteSpeed reverse-proxies `:443` to the app on `127.0.0.1:3000`; the app
runs as the `podium` user under `systemd` (`podium.service`), with MariaDB
local to the box and bound to loopback.

The release pipeline is the Checks above, run as gates on GitHub Actions
(`.github/workflows/gates.yml`). It publishes a `podium/gates` commit status,
and nothing reaches the server until someone ships it on purpose:

```bash
# push as usual — gates run on GitHub and report the podium/gates status.
# then, on the server, deploy only when you decide to:
/root/scripts/deploy.sh           # ships origin/main ONLY if gates passed
/root/scripts/deploy.sh --force   # override the gates ( emergencies only )
```

The deploy keeps the running build; if the health check fails after the
restart it rolls back to it automatically.

**The deploy does not run migrations.** When a change ships with one, apply
it right after the deploy (the migration files only exist on the server once
the new commit is checked out, so this order matters):

```bash
cd /opt/podium && npx prisma migrate deploy
```

Backups run nightly at 03:00 via root cron → `/opt/backups` (keeps 14).
Restore one: `gunzip < /opt/backups/<file>.sql.gz | mariadb pudem`.

### Environment that must be set in production

| Variable | Why |
| --- | --- |
| `NEXTAUTH_SECRET` | signs sessions; the app refuses to start without it |
| `NEXT_PUBLIC_APP_URL` | the origin used in emailed links, preferred over the `Host` header |
| `DATABASE_URL` | MySQL connection |
| `DEFAULT_ADMIN_EMAIL` | the bootstrap BFT MENA account |
| `SMTP_*`, `EMAIL_FROM` | without these, **no one can sign in** — codes and invitations go by email |

Set `OTP_SECRET` and `DEVICE_FINGERPRINT_SECRET` separately from
`NEXTAUTH_SECRET` so rotating one does not invalidate the others.

### Temporary Google Play review account

The owner authorized an active admin named **Google Play Review**, email
`google-play-review@bftmiddleeast.com`. Creation must run against the live
service's database, using its actual environment file (discover the path from
`systemctl cat podium.service`; do not copy database credentials to logs).

After deploying the authentication change, add just this email to the server-only
`OTP_EXEMPT_EMAILS` comma-separated allowlist and restart the service. Password
verification, account status checks and rate limits still apply. The exception
skips the additional email challenge only for password-authenticated staff;
competitor/code-only sign-in is unchanged. Leave `OTP_DEV_BYPASS` off.

On the production host, with the live service environment loaded:

```bash
NODE_ENV=production node --env-file=<actual-production-env> scripts/create-play-review-account.mjs --production
```

This creates the account and an audit record in one transaction, refuses to reset
an existing account, and prints its randomly generated password once. Store the
credentials privately in Play Console's App access declaration; do not put them
in the repository. Confirm a real password sign-in works before declaring reviewer
access complete. An admin can edit live competition data.

After review, disable/archive **Google Play Review** under Users, remove its email
from `OTP_EXEMPT_EMAILS` and restart. No migration or versionCode change is needed.

### Temporary Apple App Review account

Same pattern, deliberately weaker: role **studio**, not admin, carrying the
existing read-only `limited-admin` access role (`results.view`, `board.view`,
`users.view`) and scoped to the empty **Test** studio, so no real competitor
data is reachable and nothing can be changed. Email
`apple-review@bftmiddleeast.com`; it shares the same `OTP_EXEMPT_EMAILS`
allowlist entry style as the Play reviewer (comma-separated, both kept).

```bash
NODE_ENV=production node --env-file=<actual-production-env> scripts/create-apple-review-account.mjs --production
```

The script refuses to run if the access role gains a non-`.view` permission or
the sandbox studio has teams. After review, remove/archive **Apple App Review**
in Users, drop its email from `OTP_EXEMPT_EMAILS` and restart.

---

## Resetting a competition for a fresh start

Wipes every team in a competition — competitors, scores, zone entries, audit
lines, portraits, the waiting list, the waves, and anything the CRM intake was
holding — then re-dates the competition so sign-up opens and the board unlocks
for a new event day. The competition itself survives: its slug and every link
into it, its zones and scoring formulas, its staff assignments, its studios
and sponsors. Every user account survives. Team numbering restarts at 101 on
its own, because the next number is derived from the highest one left.

`scripts/reset-series.mjs` names the target — HOST and database, and every
number it is about to delete — and refuses to run without `--yes`. On the
server, backup first (the nightly 03:00 dump, or take a fresh one):

```bash
cd /opt/podium
node scripts/backup-db.mjs --host      # event-day insurance, always first
grep -E '^CRM_SYNC' .env               # must be off, or dry-run — see below
node scripts/reset-series.mjs --yes    # defaults: today, status live
```

Then check the site: sign-up open on the competition page, an empty field, and
today as the competition date.

- With more than one active competition the script refuses to guess — name one
  with `--series <slug>`. `--date 2026-12-01` re-dates to another day, and
  `--status scheduled` keeps the countdown up instead of going live.
- If `CRM_SYNC_ENABLED=1` on the server, the 15-minute poller re-creates teams
  from GoHighLevel the moment the wipe lands. The script refuses to run in
  that state: turn the sync off or onto `CRM_SYNC_DRY_RUN=1` first, or pass
  `--allow-crm` to accept the re-pull.
- The way back is the backup: `npm run db:restore db-backups/<file>.sql --yes`
  brings the old competition back whole.

---

## Event day

### Before

1. **Register the field.** Teams & waves — add teams by hand, or paste the
   registration export into Bulk import:
   `Team name, Athlete 1, Athlete 2, Category, Division, Studio 1, Studio 2`
2. **Assign waves.** Auto-assign groups by bracket first, then fills waves in
   order, so a wave runs one or two brackets and the judges use one set of loads
   per floor. Override any team on its row.
3. **Check the capacity line** on each wave card — it turns bold when a wave is
   over its limit.
4. **Set the board unlock time** if the board is going up early. Until then
   everyone but BFT MENA sees the countdown.
5. **Take a backup.** `npm run db:backup`

### During

- **Score entry** is the operator's screen. Search by team, number or athlete.
  Points appear as you type; the projected rank updates with them.
- **The wave clock** is driven from that screen and moves the board on the wall
  with it. Start next wave, pause, restart, or step back if the floor slips.
- **A flagged entry** — more than 40% from the bracket mean — is a prompt to
  check the score sheet, not a rejection.
- **The board** rotates brackets on its own if you turn Auto-rotate on, and
  turns the page of a long bracket every ten seconds.
- **Back up between waves.** `npm run db:backup` keeps the last 14.

### If something goes wrong

| Problem | What to do |
| --- | --- |
| Wrong score, entered by a studio | The studio has one correction. After that, BFT MENA edits it directly. |
| Score needs to leave the board | Score entry → **Unlock for correction**. It returns to draft, leaves the board, and the studio's budget resets. |
| A studio cannot sign in | Accounts → **Resend invitation**. Check the log or the mailbox for the link. |
| Someone lost their laptop | That account → Security → **Remove all** trusted devices. Or disable the account from Accounts. |
| The board is behind | It polls every five seconds. If it has stalled, reload it — nothing is stored in the page. |
| The database is wrong | `npm run db:restore db-backups/<file>.sql --yes`. This replaces everything. |

### After

1. Mark the event **final**, or let the last wave finish — either releases
   winners and the full results to competitors.
2. **Winners** has a staged reveal for the announcement: third, second, then the
   champions.
3. **Download the CSV export** from Teams & waves. Raw movement fields first, so
   it can be re-imported or re-scored; derived points and totals follow.
4. Final backup.

---

## Monitoring

`GET /api/health` returns `{"status":"ok","database":"up"}` and a `503` when the
database is unreachable. Unauthenticated and deliberately thin — a health
endpoint should not be a reconnaissance endpoint.
