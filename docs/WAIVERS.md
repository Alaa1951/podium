# Waiver declarations and competition-day readiness

Each athlete signs the competition's waiver themselves, in English or Arabic. The entrance and warm-up desks check that signature, and Wave control will not start a wave until every athlete in it is signed, checked in and warmed up for that wave.

## The document

The waiver is bundled with the application as structured JSON. `src/lib/waivers/documents/podium-series-1.v1.en.json` and `.ar.json` are generated from the approved *Waiver - EN.docx* and *Waiver - AR.docx* and checked against them word for word. There is one approved change: the contact address `westwalk@bodyfittraining.com` is replaced by `info@bftmiddleeast.com`, and the English file's `corrections` note records it. The document names PODIUM Series 1, 3 October 2026, Aspire Ladies Sports Hall. It applies to a competition only when BFT MENA attaches it to that competition, and it is never attached automatically.

The exact acknowledgement sentence, name label, helper text and button text for each language are in `src/lib/waivers/document.ts › SIGNING_TEXT`.

## Versions

- **Attaching.** In **Settings → Waiver** (`waivers.manage`, BFT MENA only), attaching a document creates a `WaiverRelease` for that competition. The release has one `WaiverEdition` per language, storing the exact content with its SHA-256 and the acknowledgement sentence.
- **Immutability.** A release and its editions never change after they are attached.
- **New versions.** Attaching a new version retires the previous one. Every athlete then has to sign the new version, and their earlier signatures are kept.
- **One active version.** A competition has at most one active version. Only the active version counts: a signature on an earlier version shows as **Sign again**.

## Signing

- **Where.** Athletes sign on **Waiver Declarations** (`/waivers`, "الإقرارات والموافقات"). They can reach it from the personal menu, the phone tab bar, the card on My profile, and the prompt shown after sign-in while a signature is pending.
- **The page.** It shows the competition, the version, the status and the full document. Arabic is shown right to left.
- **The signing form.** The tick box starts empty, and the name field is never filled in for the athlete.
- **Server checks.** `actions/waivers.ts › signMyWaiver` is used by the signed-in athlete for their own seat, and nobody else. The seat comes from the session, never from the form. The server refuses:
  - a missing tick;
  - a blank name, or one with no letters;
  - a name longer than 200 characters;
  - a version that is no longer current (the reply names the current version);
  - an unknown language;
  - view-as mode;
  - an account with no seat in the competition.

  Staff hold no seat, so there is nobody for them to sign as. An organiser who also competes signs their own seat.
- **What is stored.** Each signature is one insert-only `WaiverAcceptance` row. It records:
  - the account, the seat and the team;
  - the release and edition, with the content hash;
  - the language;
  - the exact acknowledgement sentence;
  - the name as typed (Unicode-normalised, with spaces collapsed);
  - the server time;
  - the category and level at signing, kept as a record only.

  The audit line (`registration.waiver_signed`, with the IP) names the version and language, never the typed name. The unique `dedupeKey` (release · account) makes pressing twice, or two requests at once, produce one record.
- **Receipt.** `/waivers/receipt/{id}` is a print-friendly receipt. Only its owner, or someone holding `waivers.manage`, can open it; anybody else gets *not found*. The receipt shows whether the stored content still matches its hash.
- **Who a signature covers.** A signature covers its signer and nobody else, and never a partner. If someone new takes a seat, the new person signs for themselves.

### Decided: no guardian flow, no re-signing for a category change

- **No guardian flow.** Whoever signs is the person consenting. PODIUM has no guardian or parental-consent flow and no age check, and none is planned.
- **Category changes never need a new signature.** A category or level change never asks for a new signature. The recorded category is only what the athlete signed as. A new signature is needed only when BFT MENA attaches a new version.

## Check-in, check-out and readiness

Readiness is made of three facts, stored apart and checked in order (`src/lib/readiness.ts`):

| Fact | Stored in | Needed for |
|---|---|---|
| The athlete signed the current waiver | `WaiverAcceptance` | Entrance check-in |
| The athlete is at the venue | `Competitor.attendedAt` (the team's `attendedAt` is set once everyone has arrived) | Warm-up check-in |
| The team is ready **for its wave** | `Team.warmupReadyAt` + `Team.warmupWaveId` | Start Wave |

- **Entrance check-in.** An athlete who has not signed is refused, by name. A team check-in checks nobody in until everyone on the team has signed.
- **Entrance check-out.** It records the departure and takes back the team's warm-up readiness.
- **Warm-up check-in.** It needs:
  - a registered team, in the field and placed in a wave;
  - every athlete signed and checked in.

  **Warm-up check-out** is always allowed.
- **When readiness is cleared.** Readiness counts only for the wave it was given for. It is cleared (and logged) when:
  - the team is moved, by hand or by an approved wave change request;
  - the team exchanges its slot;
  - a member joins or leaves the team.
- **History.** Every check-in and check-out, and every cleared readiness, is an append-only `AttendanceEvent` (actor, time, athlete or wave, reason), and is also audited.
- **Refusals.** A refusal lists the gaps by team and by athlete. It never checks in part of a team without saying so, and it never drops anybody.

The desks keep their existing keys: `registrations.attendance` / `registrations.payment` for the entrance, `checkIn.warmup` for the warm-up, and `checkIn.view` to watch. Judges and athletes get neither desk. The desks show whether each athlete is signed or not, never the signature itself.

## Start Wave

`controlWave` is the only way to start a wave. Inside the wave-schedule transaction (`scheduleTransaction`, read-committed), `wave-start-check.ts › waveStartBlockers` locks the wave's teams and seats and re-checks every athlete of every team in the field. If anything is missing, the start is refused with `NOT_READY` and the list of what is missing. This applies to BFT MENA too, and nothing is written. Because of the lock, a check-out or a move that arrives at the same moment either happens first and blocks the start, or waits until the start is done.

The Live Dashboard's **Up Next** shows only the teams in the next wave to start.

## Migration

`20261001090000_waivers_attendance` is additive. It creates the `WaiverRelease`, `WaiverEdition`, `WaiverAcceptance` and `AttendanceEvent` tables and adds the nullable column `Team.warmupWaveId`. Its one data statement stamps any existing readiness with the team's current wave. It creates no signatures.

To deploy it:

1. Take a backup.
2. Run `prisma migrate deploy`.
3. Serve the new build.
4. Attach the waiver to the real PODIUM Series 1 competition in **Settings → Waiver**.

Until step 4, no waiver is required, and check-in behaves as before except for the readiness rules above.

## Tests

- **Unit:**
  - `waivers/status.test.ts`
  - `readiness.test.ts`
  - `checkin-db.test.ts`
  - `actions/waves.start.test.ts`
- **Real database** (`INTEGRATION_DB=1`):
  - `waiver.integration.test.ts`
  - `readiness.integration.test.ts`, which includes a concurrent check-out racing a start
  - `desk-checkin.integration.test.ts`
  - `schedule-move.integration.test.ts`
  - `schedule-exchange.integration.test.ts`
- **Browser** (local only):
  - `e2e/waivers.spec.ts`: signing in English and Arabic, refusals, the receipt, the desks and Start Wave
  - `e2e/board-up-next.spec.ts`
  - `e2e/desks.spec.ts`
