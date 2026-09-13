# Architecture

How PODIUM is put together, and why. Read this before changing anything that
touches scoring or access.

---

## The shape of it

```
Browser ── proxy.ts ──► Next.js App Router ──► Prisma 7 ──► MySQL 8.4
             │                  │
             │                  ├─ Server Components  read  (queries.ts)
             │                  ├─ Server Actions     write (actions/*)
             │                  └─ Route Handlers     auth, board poll, export, health
             │
             └─ security headers, CSP nonce, early sign-in bounce
```

There is no separate API service and no client-side data store. A screen is a
Server Component that reads what it needs, and a mutation is a Server Action
that re-derives who is asking before it writes. The only polled endpoint is the
live board, because a wall screen has to update itself.

---

## Three rules the codebase is built around

### 1. Store raw inputs, derive everything else

The database holds the seven numbers a judge writes down — deadlift reps, bench
reps, rower metres, kettlebell rounds, dumbbell rounds, and the minutes and
seconds *remaining* on the finisher. It never holds points, totals, ranks or
podium places.

Those are computed on read by [`src/lib/scoring.ts`](../src/lib/scoring.ts).

The payoff: correcting a formula re-scores the entire field at once, and a
judging correction touches only the movement in dispute. The cost: every board
query computes. At 108 teams that is nothing.

### 2. Authorization is a pure function, applied on the server

[`src/lib/access.ts`](../src/lib/access.ts) holds the rules and imports nothing —
no database, no session, no network. It is therefore readable in one sitting,
exhaustively tested ([`access.test.ts`](../src/lib/access.test.ts)), and
reviewable as a security surface on its own.

[`src/lib/session.ts`](../src/lib/session.ts) is the thin layer that resolves the
current user from the session and re-exports those rules.

Every read that returns teams goes through `teamScope(user)`, which is a Prisma
`where` filter. Every write re-checks with `canEditScore` or its siblings. A
hidden tab is presentation; the filter is the protection.

The scope for a studio with no studio assigned is `{ studioId: "__none__" }` —
a value that matches no row. Failing closed is deliberate and tested.

### 3. Durations, not instants, cross the wire

The wave clock lives on the `Event` row so every screen in the venue reads the
same countdown. But the server sends `waveRemainingMs`, not `waveEndsAt`.

Each screen anchors that duration against its own clock the moment it arrives
and counts down from there. A laptop whose system time is an hour out therefore
shows the same twenty minutes as the board on the wall.

---

## Data model

Two halves that meet only at `User`.

**Competition:** `Series → Event → Team → Score`, with `Athlete` hanging off
`Team` and `Studio` referenced by both. Every team, score and podium is scoped
to exactly one `Event`, so brackets never mix across dates.

**Access:** `User`, `AuthToken` (invitations and resets), `OtpChallenge`,
`TrustedDevice`, `LoginEvent`, `AdminAuditLog`, `Account` (Google links).

Two things are worth knowing:

- **`Athlete.normalizedName`** — lower-cased, punctuation stripped. A studio
  registers a competitor by typing their name, long before that competitor has
  an account. When the account arrives, this column links the two instead of
  creating a second registration.
- **`Team.scoreEdits`** — a stored counter, not a UI state. A studio gets two
  writes: the submission and one correction. Because it is in the database, the
  limit survives a reload, a second tab, or a request that skips the interface.

## Audit

Two trails, deliberately separate:

- **`ScoreAudit`** — one row per changed field, with the old and new value.
  What the number was and what it became.
- **`AdminAuditLog`** — invitations, disabling, score unlocks, studio
  assignment. Who had the authority and used it.

A score correction writes to both.

---

## Rendering and data flow

Every route is dynamic (`ƒ` in the build output). There is nothing to
pre-render: every screen depends on the session, and the board changes every
few seconds.

- **Reads** — Server Components call `queries.ts`, which returns plain objects.
- **Writes** — Server Actions in `actions/`. Each one starts with
  `requireUser()`, validates with zod, re-checks authorization, writes, records
  an audit row, then `revalidatePath`.
- **The board** — the first render is server-side; after that the client polls
  `/api/events/[id]/board` every five seconds and swaps the payload. A dropped
  poll is ignored: a wall screen keeps the numbers it has and tries again.

## Internationalisation

English and Arabic, with RTL. Keys are the English source string, so an
untranslated key renders as correct English rather than a placeholder. The
locale is a cookie written by a Server Action, so the response that follows
already carries the new language and `dir`.

## What is deliberately not here

- **No client state library.** The server is the state.
- **No websockets.** Polling every five seconds is enough for a leaderboard and
  survives a flaky venue network far better.
- **No CSS framework in the design.** The blueprint language is plain CSS with
  design tokens in `globals.css`, ported from the approved reference.
- **No public routes.** Everything is behind a sign-in, including the board.
