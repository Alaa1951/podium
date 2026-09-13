# Security

What protects this system, where each control lives, and what is deliberately
left undone.

---

## The model in one paragraph

Accounts are issued, never self-created. BFT MENA adds studios; a studio adds
its own competitors. There is one sign-in screen and no role picker — the
database decides what a person is. Any unrecognised browser is challenged with a
six-digit code by email before a session exists. Everything a signed-in person
can then see or change is filtered on the server by their role and their studio.

---

## Sign-in

| Control | Where |
| --- | --- |
| Passwords hashed with bcrypt, cost 12 | [`security.ts`](../src/lib/security.ts) |
| Minimum 10 chars, upper + lower + digit | `checkPasswordStrength` |
| Email OTP on every untrusted device | [`auth.ts`](../src/lib/auth.ts) |
| Codes stored as HMAC-SHA256, never plaintext | [`otp.ts`](../src/lib/otp.ts) |
| Codes expire in 10 minutes, 5 attempts, consumed on use | `otp.ts` |
| Issuing a code consumes any outstanding one | `createOtpChallenge` |
| Device trust for 30 days, then re-challenged | [`trusted-device.ts`](../src/lib/trusted-device.ts) |
| Device fingerprints stored as HMAC, never raw | `hashDeviceFingerprint` |
| Rate limit per IP **and** per address | [`rate-limit.ts`](../src/lib/rate-limit.ts) |
| Recent failures force a code even on a trusted device | `isSuspiciousLogin` |
| Session: httpOnly, SameSite=Lax, Secure in production, 12 hours | `auth.ts` |
| Role, studio and status re-read from the database every 5 min | `jwt` callback |

**Twelve hours** is one event day. A session that outlives the event is a laptop
left open in a gym.

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

Changing a password from inside a session still requires the current one: a
borrowed unlocked laptop must not be enough to take an account over.

---

## Authorization

The rules are pure functions in [`access.ts`](../src/lib/access.ts) and are
applied on the server on every read and every write.

| Role | Sees | Writes |
| --- | --- | --- |
| **BFT MENA** | everything | everything; the only role that can unlock a submitted score |
| **Studio** | its own teams and its own people | its own teams' scores — one submission plus one correction |
| **Member** | their own registration; the board while it runs; results when it is over | nothing |

Three properties are worth stating explicitly, because each is tested:

- **Fails closed.** A studio account with no studio assigned scopes to
  `__none__` and sees nothing, rather than scoping to `{}` and seeing the whole
  field.
- **Submitted values are overridden, not validated.** When a studio creates a
  competitor, the studio id it sent is discarded and replaced with its own. A
  crafted request cannot place someone in another studio.
- **The edit budget is stored.** `Team.scoreEdits` is a database column. A
  second tab, a replayed request or a direct call to the action all hit the same
  counter.

Hiding a tab is presentation. Each page re-checks the same rule.

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
