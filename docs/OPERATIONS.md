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

Delete any `.env` that ends up inside `.next/standalone` — `next build` copies
the developer's one in, and it must not shadow the host's environment.

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
