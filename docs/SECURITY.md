# Security

What protects this system, where each control lives, and what is deliberately
left undone.

---

## The model in one paragraph

Accounts are issued, never self-created. BFT MENA adds studios; a studio adds
its own competitors. There is one sign-in screen and no role picker — the
database decides what a person is. Any unrecognised browser is challenged with a
six-digit code by email before a session exists, except explicitly allowlisted
password-authenticated staff accounts described below. Everything a signed-in person
can then see or change is filtered on the server by their role and their studio.

---

## Sign-in

| Control | Where |
| --- | --- |
| Passwords hashed with bcrypt, cost 12 | [`security.ts`](../src/lib/security.ts) |
| Minimum 6 chars, upper + lower + digit | `checkPasswordStrength`, length from [`password-rules.ts`](../src/lib/password-rules.ts) |
| Email OTP on untrusted devices, with a server-side named staff exception | [`auth-password.ts`](../src/lib/auth-password.ts) |
| Codes stored as HMAC-SHA256, never plaintext | [`otp.ts`](../src/lib/otp.ts) |
| Codes expire in 10 minutes, 5 attempts, consumed on use | `otp.ts` |
| Issuing a code consumes any outstanding one | `createOtpChallenge` |
| Device trust for 30 days, then re-challenged | [`trusted-device.ts`](../src/lib/trusted-device.ts) |
| Device fingerprints stored as HMAC, never raw | `hashDeviceFingerprint` |
| Rate limit per IP **and** per address | [`rate-limit.ts`](../src/lib/rate-limit.ts) |
| Recent failures force a code even on a trusted device | `isSuspiciousLogin` |
| Session: httpOnly, SameSite=Lax, Secure in production, 30 days since last use | `session-deadline.ts` |
| Role, studio and status re-read from the database every 5 min | `jwt` callback |

**Signed in until sign-out**, or 30 days without use. The mobile app is expected
to stay signed in; every open extends the deadline, and an expired session is
never revived. The cost: a shared laptop left signed in stays signed in, so staff
must sign out on shared machines. Disabled or archived accounts still lose access
within the five-minute refresh above.

`OTP_EXEMPT_EMAILS` is a server-only, exact email allowlist for temporary reviewer
staff access. It is evaluated only after a valid password and account status checks
in the credentials provider; it also skips forced/suspicious-login email challenges
for the named account. Rate limits, audit logs and session permissions remain in
effect. It never bypasses OTP-only or competitor authentication, and does not mark
an unrecognized device trusted. Remove the exception and disable the reviewer
account after review. The global development bypass is still ignored in production.

`TEST_ACCOUNT_EMAILS` is a second server-only exact allowlist, for the per-role test
accounts (docs/ACCESS.md). A listed address signs in with its password alone — no
emailed code, whatever the device — and `email.ts` sends it nothing, so a test
account can never bounce mail or receive a code. The password, rate limits, account
status, audit log and permissions all still apply; what a test account may do is
exactly its account type and roles. The list and the password never go in the
repository (it is public). Block the accounts on Users between test sessions: a
blocked account cannot sign in at all.

### What sign-in does not reveal

An unknown email and a wrong password fail identically. Password reset always
answers "if that email has an account, a link is on its way", whether or not it
does. Neither can be used to work out who holds an account.

### Invitations and resets

One-time tokens, stored only as an HMAC of the random value in the emailed link.
Invitations last 7 days, resets 30 minutes. Issuing a new one spends the old
one. Setting a password — from an invitation or a reset — revokes every trusted
device and forces a code on the next sign-in, because possession of a mailbox is
not possession of a device.

Changing a password from inside a session is done by the same emailed link, and
never by typing the current one. The old rule asked for the current password so
that a borrowed unlocked laptop was not enough to take an account over; the
emailed link clears that bar and a higher one, because whoever holds the laptop
must also hold the mailbox. `POST /api/auth/request-password-reset` takes no
body — the address is the session's own, so a signed-in person cannot aim it at
somebody else's inbox.

### Sign-up and approval

Anyone can ask for an account at `/signup`, as an athlete or an organiser
(organiser, judge, volunteer, coach, or a Gym/Studio). The request is created
**waiting for approval** and a code goes to the address; typing it in proves the
address and signs the person in. Until someone approves them, their permissions
are the _everyone_ set only — the general pages and the live board — whatever
roles the account might carry ([`load.ts`](../src/lib/permissions/load.ts)).

- The reply never says whether an address already has an account; an existing
  address gets an email pointing at sign-in instead of a code.
- Rate limited per address and, more loosely, per network, so a gym signing up
  its members on one Wi-Fi is not throttled as one person.
- **Who decides** ([`approvals.ts`](../src/lib/approvals.ts)): BFT MENA sees every
  request; a studio sees only requests that named it, and never a request to
  become a Gym/Studio. Whoever acts first decides; a second decision is refused.
- Approving applies the same anti-escalation rules as the Access panel: a
  studio approves only into itself and gives only roles marked "studios can
  give". Nobody decides their own request. Every decision is audited and emailed.
- A **paid registration** approves an athlete account automatically.
- Partners are linked only when both addresses are proven and each named the
  other (or the named one was looking for a partner) — typing someone's email
  never attaches you to them ([`partners.ts`](../src/lib/partners.ts)).

---

## Authorization

Two separate questions, answered separately:

- **What may this person do?** Their permissions, worked out from the roles
  they hold. The catalog, the resolver and the anti-escalation rules are pure
  functions in [`src/lib/permissions/`](../src/lib/permissions/); the full
  matrix of default roles is generated into [ACCESS.md](ACCESS.md).
- **Whose data may they touch?** Their account type, as the Prisma filters in
  [`access.ts`](../src/lib/access.ts).

| Account type | Data it reaches | What it may do |
| --- | --- | --- |
| **BFT MENA · Full access** (`admin`) | everything | everything; the only account that can correct or unlock a submitted score |
| **BFT MENA · Partial access** (`staff`) | everything | exactly what its roles grant |
| **Gym / Studio** (`studio`) | its own teams and its own people | its roles (default: Gym / Studio) — never score entry, never BFT MENA-only permissions |
| **Organiser** (`organiser`) | every team, read through its roles | its roles (Organiser, Judge, Volunteer, Coach) |
| **Athlete** (`competitor`) | their own team | their roles (default: Athlete) |

Every permission carries a policy: _everyone_ (always on, even while waiting
for approval — the live board is one), _role_, _BFT MENA only_ (above the
ceiling of every studio, organiser and athlete account, whatever a role says),
or _Full access only_ (never grantable: `scores.correct`, `scores.unlock`).
Effective access is `(general ∪ roles ∪ grants) ∩ ceiling − locks`, and a
per-person **lock always wins**.

Properties worth stating explicitly, because each is tested
([`permissions.test.ts`](../src/lib/permissions/permissions.test.ts),
[`access.test.ts`](../src/lib/access.test.ts)):

- **You can only give what you hold.** Editing a role, giving a role (BFT MENA
  Partial) or granting/locking a single permission touches only keys the actor
  holds; BFT MENA Full access is the only exemption. A studio's authority to
  appoint judges comes from the role's "studios can give" flag, which only BFT
  MENA sets — and such a role can never carry a BFT MENA-only permission.
- **Nobody changes their own access**, and nobody below Full access touches a
  Full-access account.
- **Saves only touch what the editor could change.** Keys an editor could not
  see or change keep their stored state whatever the request carried, and a
  stale save (someone else changed the role or the person meanwhile) is refused.
- **Fails closed.** A studio account with no studio assigned scopes to
  `__none__` and sees nothing, rather than scoping to `{}` and seeing the whole
  field.
- **Submitted values are overridden, not validated.** When a studio creates an
  account, the studio id it sent is discarded and replaced with its own. A
  crafted request cannot place someone in another studio.

Menus, pages and actions check the **same** permission key, so a menu can never
offer a door that refuses. Hiding a tab is still only presentation: each page
and each server action re-checks the rule.

---

## Transport and browser

Set by [`proxy.ts`](../src/proxy.ts) on every response:

- `Content-Security-Policy` with a **per-request nonce** and `strict-dynamic`.
  The app loads nothing from anywhere else — fonts are self-hosted by
  `next/font`, the brand marks are local files, there is no analytics or embed —
  so the policy is closed to `'self'`. `'unsafe-inline'` remains on *styles*
  only, because the design uses inline `style` attributes.
- `Strict-Transport-Security` (production), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  a closed `Permissions-Policy`, and `X-Robots-Tag: noindex`.

`?callbackUrl=` is accepted only when it is a same-site path, so a crafted link
cannot bounce a freshly signed-in operator to another origin. Links we email are
built from configuration, never from the `Host` header.

---

## Audit

Every privileged act is recorded with the account behind it and the IP:
invitations, re-invitations, enabling and disabling, score unlocks, studio
assignment, wave assignment, team deletion, device revocation, password changes.
Visible to BFT MENA at `/e/{event}/audit`.

Score changes are recorded separately, field by field, with the old and new
value — visible per team in Score entry.

---

## Known limits

These are real, and stated rather than hidden.

1. **The rate limiter is in-process.** Correct for one instance; behind two, the
   effective limit doubles. Move it to Redis or a MySQL table before scaling
   out. `src/lib/rate-limit.ts` is the only file that changes.
2. **No 2FA beyond email.** The OTP goes to the mailbox. If an attacker holds
   the mailbox they hold the account. TOTP would close this; the schema has room
   for it on `User`.
3. **`npm audit` is not clean.** The remaining advisories are inside the Prisma 7
   dependency tree (`mariadb`, `mysql2`, `deepmerge-ts`) with no fix that does
   not mean downgrading to Prisma 6. The `mariadb` advisory concerns credentials
   over an untrusted network with `ssl: true`; this deployment reaches MySQL over
   a private Docker network. Re-check on each Prisma release.
4. **Seeded studio accounts are real accounts.** `db:seed` creates one per
   studio in `invited` state with no password. Harmless — they cannot sign in
   until someone activates them by email — but remove them before production if
   the studios are not the seeded four.
5. **The standalone build copies `.env`.** `next build` places the developer's
   `.env` inside `.next/standalone`. The Dockerfile deletes it; a manual copy of
   that directory must do the same.

## Reporting

Security issues go to BFT MENA directly, not into a public tracker.
