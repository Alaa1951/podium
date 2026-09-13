# PODIUM — BFT MENA leaderboard system

Live leaderboard, score entry, wave scheduling and results for the PODIUM
series. Next.js 16 (App Router) · Prisma 7 · MySQL 8.4.

The design is a faithful build of the approved PODIUM reference: the deep navy
board, the blueprint wireframe language with registration marks at the corners,
condensed uppercase headings and tabular numerals. The sign-in system is new.

Self-contained: no external service, no CDN, no third-party script. It runs from
one `docker compose up`, or from `node server.js` on any plain Node host.

| | |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how it is put together, and why |
| [docs/SECURITY.md](docs/SECURITY.md) | every control, where it lives, and the known limits |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | running it locally, deploying it, and the event-day runbook |

---

## Getting started

```bash
cp .env.example .env          # then fill in the values below
npm install
npm run db:up                 # MySQL 8.4 in Docker
npm run db:migrate            # create the schema
npm run db:seed               # four studios, two series, a live round of 108 teams
npm run dev
```

Open <http://localhost:3000>.

### Environment

The three secrets that matter:

```bash
# node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
NEXTAUTH_SECRET=...
DEFAULT_ADMIN_EMAIL=admin@bftmena.com
SEED_ADMIN_PASSWORD=...        # read only by `db:seed`, never at runtime
```

`OTP_SECRET` and `DEVICE_FINGERPRINT_SECRET` fall back to `NEXTAUTH_SECRET`;
set them separately in production so rotating one does not invalidate the other.

**Email in development.** With `SMTP_HOST` unset, mail is written to the server
log instead of being sent — sign-in codes and invitation links stay usable while
nothing leaves the machine. Set `EMAIL_SEND_IN_DEV=true` to send for real.

---

## Accounts

There is **one sign-in screen** and no role picker. The account decides what a
person can do, and **no account is ever self-created**:

| Role | Created by | Scope |
| --- | --- | --- |
| **BFT MENA** | Another admin, by invitation | Everything: series, events, teams, waves, scores, results, accounts. The only role that can correct a locked score. |
| **Studio** | BFT MENA, assigned to one studio | Its own studio's teams — register, schedule, score. One correction after submission, then the score locks. Adds and activates its own competitors. |
| **Member** | Their studio, by invitation | Own registration before the event; the live board while it runs; own result, winners and full rankings once the last wave is done. |

An invited account has no password. It receives a one-time link by email and
chooses one itself — nothing is set for them, and nothing is ever emailed that
could be used twice.

### Security

Full detail in [docs/SECURITY.md](docs/SECURITY.md). In short:

- Passwords hashed with bcrypt (cost 12); nothing about them reaches the client.
- Every unrecognised device is challenged with a six-digit code by email before a
  session exists. Codes are stored only as an HMAC, expire in ten minutes, allow
  five attempts, and are consumed on use.
- A device can be trusted for thirty days. Changing a password revokes every
  trusted device and forces a fresh code.
- Sign-in, code, reset and invitation endpoints are rate-limited per IP *and* per
  address. Repeated failures force a code even on a trusted device and notify the
  account holder.
- Sign-in never reveals whether an address holds an account: an unknown email and
  a wrong password fail identically, and password reset always answers the same.
- Sessions are httpOnly, SameSite=Lax, Secure in production, twelve hours long.
- Authorization is decided on the server on every read and write — a studio's
  queries are filtered by `studioId` and a member's by their own athlete row.
  The score-edit limit is a stored counter, not a disabled button.
- A per-request CSP nonce with `strict-dynamic`, plus HSTS, `frame-ancestors
  'none'`, `nosniff` and a closed `Permissions-Policy`.
- Everyone can see their own trusted browsers and sign-in history at
  **/account**, remove a device, and change their password.
- Every privileged act — invitations, disabling, score unlocks, studio
  assignment — is recorded with the account behind it, visible to BFT MENA at
  **Audit trail**.

> The in-memory rate limiter (`src/lib/rate-limit.ts`) is correct for a single
> process. Move it to a shared store before running more than one instance.

---

## Scoring

Raw movement inputs are stored; points and ranks are always **derived**
(`src/lib/scoring.ts`), so correcting a formula re-scores the whole field.

| Zone | Raw input | Points |
| --- | --- | --- |
| 1 — Strength | deadlift reps + bench reps | `(deadlift + bench) × 10` |
| 2 — Conditioning | rower metres | `metres ÷ 100` |
| 3 — Strength endurance | kettlebell + dumbbell rounds | `(kettlebell + dumbbell) × 10` |
| 4 — Finisher | time **remaining** MM:SS | `(MM × 10) + (SS ÷ 10)` |

Ranking happens **inside a bracket**, never across brackets — three categories ×
three divisions = nine brackets. Equal totals share a rank and the next is
skipped (1, 2, 2, 4). Only submitted scores reach the public board.

> **Open with BFT MENA.** The reference's prose worked example gives Zone 4 as
> 26.10 for 02:41 remaining, which does not follow from the stated formula —
> (2 × 10) + (41 ÷ 10) is 24.10. The formula is implemented as written, matching
> the reference prototype's own code. Also still unconfirmed: the tie-break, and
> the 18-winner breakdown.

---

## Layout

```
src/
  app/
    (auth)/         login · verify · activate · reset-password · forgot-password
    (app)/          series and event management
      e/[eventId]/  live · scores · teams · setup · winners · lookup · me · accounts · audit · spec
      account/      own password, trusted devices, sign-in history
    api/            NextAuth, the auth endpoints, the board polling endpoint
  lib/
    access.ts       the authorization rules — pure, no imports, fully tested
    session.ts      resolves the current user and applies them
    auth.ts         one sign-in, email OTP, trusted devices
    scoring.ts      the scoring engine (shared by server and client)
    queries.ts      scoped reads
    audit.ts        the record of who used which authority
    actions/        server actions; each re-checks authorization
  components/       board, scores, setup, lookup, accounts, account, i18n
  proxy.ts          security headers, CSP nonce, early sign-in bounce
prisma/             schema, migrations, seed
scripts/            database backup and restore
docs/               architecture, security, operations
```

Both English and Arabic are supported, with RTL, from the switcher in the app
bar (`src/lib/i18n/`). Untranslated keys fall back to English rather than to a
placeholder.

---

## Commands

```bash
npm run dev          # Turbopack dev server
npm run build        # prisma generate + next build (standalone output)
npm start            # node server.js — production
npm test             # 109 unit tests
npm run test:watch
npm run test:coverage
npm run type-check   # tsc --noEmit
npm run lint         # eslint

npm run db:up        # start MySQL
npm run db:migrate   # prisma migrate dev
npm run db:seed      # demo field
npm run db:studio    # Prisma Studio
npm run db:backup    # dump to ./db-backups, keeping the last 14
npm run db:restore   # restore a dump — replaces everything
```

**`npm test`** covers the scoring engine against the reference worked example,
the tie rule, score validation, every access rule (including the fail-closed
cases), the rate limiter's two independent buckets, password hashing and the
one-time-secret helpers, and the translation contract. Run it before touching
`scoring.ts` or `access.ts` — those two decide podiums and who sees what.

### Docker

```bash
docker compose up --build
```

Applies migrations, seeds if the live event has no teams, then serves on
`:3000` as a non-root user with a health check on `/api/health`.

For a plain Node host, `next build` produces a self-contained bundle — see
[docs/OPERATIONS.md](docs/OPERATIONS.md#deployment).
