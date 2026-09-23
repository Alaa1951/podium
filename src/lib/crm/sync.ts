import "server-only";

import { prisma as defaultPrisma } from "@/lib/prisma";
import { createCrmClient, type CrmClient } from "@/lib/crm/client";
import { admitIfRoom } from "@/lib/crm/admit";
import { assertFieldMap } from "@/lib/crm/field-map";
import { reconcile, summarise, type Action, type Snapshot } from "@/lib/crm/reconcile";
import { findEntryInSeries } from "@/lib/one-entry";
import { createTeam } from "@/lib/team-create";

// ─────────────────────────────────────────────────────────────────────────────
// ONE POLL OF THE CRM.
//
// Read everything, work out the plan with `reconcile` (a pure function, tested
// without a network), then carry it out. Reading and deciding are separated on
// purpose: the live CRM changes while you read it — its counts moved twice in
// one afternoon — so every decision is made against a single snapshot rather
// than against a system that is still moving.
//
// HOW A POLL IS CLAIMED is the part that survives everything else changing.
// `CrmSyncState` has one row, and a poll takes it with an UPDATE guarded on
// `running: false`, running only if that changed exactly one row — the same
// idiom that starts a wave once. The fifteen-minute timer and the Sync now
// button cannot work the same eighty-five records at the same moment.
//
// A claim older than `staleMs` is presumed dead and taken anyway, because a
// process killed mid-poll would otherwise lock the sync out for good.
// ─────────────────────────────────────────────────────────────────────────────

type Db = typeof defaultPrisma;

export const SYNC_STATE_ID = "singleton";

/** Fifteen minutes, the interval BFT MENA asked for. */
export const POLL_MS = 15 * 60_000;

/** A poll that has not finished in this long is presumed dead. */
const STALE_MS = 10 * 60_000;

/**
 * Whether the poller runs at all. Absent means OFF, exactly like
 * `portraitsEnabled` — the table exists in production and nothing starts
 * until somebody sets this deliberately.
 */
export function crmSyncEnabled(): boolean {
  return process.env.CRM_SYNC_ENABLED === "1";
}

/** Work out the plan and log it, but write nothing. */
export function crmSyncDryRun(): boolean {
  return process.env.CRM_SYNC_DRY_RUN === "1";
}

export type SyncResult = {
  ok: boolean;
  created: number;
  updated: number;
  /** Registrations the CRM has not finished, held where they can be chased. */
  waiting: number;
  skipped: number;
  reasons: Record<string, number>;
  error?: string;
  /** Set when another poll held the claim; not a failure. */
  busy?: boolean;
  /** Nothing was written: the counts are what a real run WOULD do. */
  dryRun?: boolean;
};

/** Take the claim, or report that somebody else has it. */
export async function claimSync(db: Db, now: Date, staleMs = STALE_MS): Promise<boolean> {
  const cutoff = new Date(now.getTime() - staleMs);
  const taken = await db.crmSyncState.updateMany({
    where: {
      id: SYNC_STATE_ID,
      OR: [{ running: false }, { claimedAt: { lt: cutoff } }],
    },
    data: { running: true, claimedAt: now, lastRunAt: now },
  });
  return taken.count === 1;
}

/** Give the claim back, with what the poll did. */
export async function releaseSync(db: Db, now: Date, result: SyncResult): Promise<void> {
  await db.crmSyncState.updateMany({
    where: { id: SYNC_STATE_ID },
    data: {
      running: false,
      claimedAt: null,
      lastSuccessAt: result.ok ? now : undefined,
      lastCreated: result.created,
      lastUpdated: result.updated,
      lastWaiting: result.waiting,
      lastSkipped: result.skipped,
      // Already redacted by the client — a status and a short code, no body.
      lastError: result.error ? result.error.slice(0, 180) : null,
    },
  });
}

/** Everything the plan is worked out against, read in one pass. */
async function readSnapshot(db: Db, client: CrmClient, seriesId: string): Promise<Snapshot> {
  const [fieldIds, pipelines, contacts, opportunities, studios, teams, series] = await Promise.all([
    client.listCustomFieldIds(),
    client.listPipelines(),
    client.listContacts(),
    client.listOpportunities(),
    db.studio.findMany({ select: { id: true, name: true } }),
    db.team.findMany({
      where: { seriesId },
      select: {
        id: true,
        externalId: true,
        source: true,
        paymentStatus: true,
        amountMinor: true,
        billingNumber: true,
      },
    }),
    db.series.findUnique({ where: { id: seriesId }, select: { registrationClosesAt: true } }),
  ]);

  // Before anything is decided: a field deleted or rebuilt in the CRM form
  // reads as empty everywhere, and the sync would go on writing that emptiness
  // one poll at a time with nothing in any log to say so.
  assertFieldMap(fieldIds);

  return {
    contacts,
    opportunities,
    pipelines,
    studioNames: studios.map((studio) => studio.name),
    teams,
    registrationClosesAt: series?.registrationClosesAt ?? null,
  };
}

/**
 * The studio a seat belongs to, founding it if this is the first time anybody
 * from there has registered.
 *
 * BFT MENA opens studios, and a pair from a new one should not lose their
 * membership because PODIUM had not heard of it yet — that membership is a
 * figure the reports are asked for, and a silent null is the wrong answer to
 * "which studio are they from". `approveSignup` already does exactly this for
 * a self-registered athlete naming a studio we do not have
 * (`actions/approvals.ts`), so this is the established rule, not a new one.
 *
 * `Studio.name` is unique, which is both the de-duplication and the race
 * guard: two seats from the same new studio in one poll cannot found it
 * twice, because the second create loses and re-reads.
 */
async function studioIdFor(
  db: Db,
  name: string,
  cache: Map<string, string>
): Promise<{ id: string; created: boolean }> {
  const known = cache.get(name.toLowerCase());
  if (known) return { id: known, created: false };

  try {
    const made = await db.studio.create({ data: { name }, select: { id: true } });
    cache.set(name.toLowerCase(), made.id);
    return { id: made.id, created: true };
  } catch {
    // Somebody else founded it between the read and the write — or it existed
    // under a spelling the cache missed. Either way the name is taken, and
    // the row behind it is the one we want.
    const found = await db.studio.findUnique({ where: { name }, select: { id: true } });
    if (!found) throw new Error(`Could not find or create the studio "${name}".`);
    cache.set(name.toLowerCase(), found.id);
    return { id: found.id, created: false };
  }
}

/** Carry out one action. Returns what happened, never throws for a bad record. */
async function apply(
  db: Db,
  action: Action,
  seriesId: string,
  studioIdByName: Map<string, string>,
  now: Date
): Promise<"created" | "updated" | "intake" | "skipped"> {
  if (action.kind === "skip") return "skipped";

  if (action.kind === "intake") {
    // Upsert, because the same unfinished registration turns up on every poll
    // and `firstSeenAt` is the useful number: how long somebody has been
    // sitting there unchased.
    const { externalId, raw, ...fields } = action.intake;
    const payload = raw as unknown as never;
    await db.crmIntake.upsert({
      where: { seriesId_externalId: { seriesId, externalId } },
      create: { seriesId, externalId, ...fields, rawPayload: payload, lastSeenAt: now },
      update: { ...fields, rawPayload: payload, lastSeenAt: now },
    });
    return "intake";
  }

  if (action.kind === "update") {
    const { paymentStatus } = action.changes;
    await db.team.update({
      where: { id: action.teamId },
      data: {
        ...action.changes,
        // Mirrors `setPayment`: the timestamp follows the status. There is no
        // `confirmedById` — nobody at BFT MENA confirmed this one, the CRM
        // did, and naming a person who was asleep is worse than naming none.
        ...(paymentStatus === undefined
          ? {}
          : { paidAt: paymentStatus === "paid" ? now : null, confirmedById: null }),
      },
    });

    return "updated";
  }

  const { draft } = action;
  const seats = [];
  for (const seat of draft.seats) {
    // Sequential, not Promise.all: two seats of one pair are usually from the
    // same studio, and racing them would have both try to found it.
    const studio = seat.studioName ? await studioIdFor(db, seat.studioName, studioIdByName) : null;
    if (studio?.created) console.info("[CRM:studio]", `created "${seat.studioName}"`);
    seats.push({
      position: seat.position,
      fullName: seat.fullName,
      email: seat.email,
      phone: seat.phone,
      dateOfBirth: seat.dateOfBirth,
      shirtSize: seat.shirtSize,
      bftMember: seat.bftMember,
      studioId: studio?.id ?? null,
    });
  }

  // ── Is this pair already entered? ────────────────────────────────────────
  //
  // ADOPT, DO NOT DUPLICATE. A pair who signed themselves up, or whom a
  // studio entered by hand, already has a team — with no `externalId`, so
  // the unique index sees no collision and this used to make a SECOND one.
  // Two rows for two people stays invisible until payment lands, and then it
  // is two lines on the board, two ranks in the results, and every figure in
  // the reports counted twice.
  //
  // Adoption is refused unless BOTH seats match. One matching email means the
  // partner changed, and which pair is the real entry is a person's decision,
  // not a poll's.
  const seatEmails = seats.map((seat) => seat.email).filter(Boolean) as string[];
  const existing = seatEmails.length
    ? await findEntryInSeries({ seriesId, emails: seatEmails }, db)
    : null;

  if (existing) {
    const mine = await db.team.findUnique({
      where: { id: existing.teamId },
      select: { id: true, externalId: true, competitors: { select: { email: true } } },
    });
    const theirs = new Set(
      (mine?.competitors ?? []).map((seat) => seat.email).filter(Boolean) as string[]
    );
    const bothMatch = seatEmails.length === 2 && seatEmails.every((email) => theirs.has(email));

    if (mine && !mine.externalId && bothMatch) {
      await db.team.update({
        where: { id: mine.id },
        data: {
          externalId: draft.externalId,
          source: "ghl",
          rawPayload: draft.raw as never,
          paymentStatus: draft.paymentStatus,
          paidAt: draft.paymentStatus === "paid" ? now : null,
          amountMinor: draft.amountMinor,
          billingNumber: draft.billingNumber,
        },
      });
      await db.crmIntake
        .deleteMany({ where: { seriesId, externalId: draft.externalId } })
        .catch(() => undefined);
      console.info("[CRM:adopt]", `${draft.externalId} -> existing team`);
      return "updated";
    }

    // Ambiguous. Leave both alone and say so — a poll must not pick.
    console.warn(
      "[CRM:conflict]",
      `${draft.externalId} matches a team that is not its own; left untouched`
    );
    return "skipped";
  }

  const created = await createTeam(db, {
    seriesId,
    name: draft.name,
    category: draft.category,
    division: draft.division,
    // The registering competitor's studio owns the team, which is what scopes
    // it for that studio's account — the same rule the manual path uses.
    studioId: seats[0]?.studioId ?? null,
    paymentStatus: draft.paymentStatus,
    source: "ghl",
    paidAt: draft.paymentStatus === "paid" ? now : null,
    // The deadline applies to the CRM too, which it never used to.
    waitlistedAt: draft.waitlisted ? now : null,
    amountMinor: draft.amountMinor,
    billingNumber: draft.billingNumber,
    externalId: draft.externalId,
    // Every field the CRM sent, mapped or not — see TeamDraft.raw.
    rawPayload: draft.raw,
    seats,
  });

  // ALREADY_ENTERED is not a failure. It is the unique index doing its job
  // when two polls overlap, and the right response is to count it and move on.
  if (!created.ok) return "skipped";

  // It is a team now, so it is no longer waiting to be one. Deleting rather
  // than flagging keeps one answer to "is this a team yet": the team itself.
  await db.crmIntake
    .deleteMany({ where: { seriesId, externalId: draft.externalId } })
    .catch(() => undefined);
  return "created";
}

export type SyncOptions = {
  prisma?: Db;
  client?: CrmClient;
  now?: () => Date;
  /** The competition CRM registrations land in, by slug. */
  seriesSlug?: string;
  dryRun?: boolean;
  staleMs?: number;
};

/**
 * One poll, start to finish. Never throws: a poller that dies stops polling.
 *
 * IT DOES NOT REVALIDATE ANY PAGE, and that is not an oversight.
 * `revalidatePath` only works inside a request, and this runs from a timer —
 * calling it there throws, and the throw landed inside the try below, turning
 * a poll that had already written fifty-five teams into a reported failure
 * with `lastSuccessAt` never set. The manual action refreshes instead, because
 * it has a request; the timer's work is picked up on the next page load.
 */
export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const db = options.prisma ?? defaultPrisma;
  const now = options.now ?? (() => new Date());
  const dryRun = options.dryRun ?? crmSyncDryRun();
  const slug = options.seriesSlug ?? process.env.CRM_SYNC_SERIES;

  const empty: SyncResult = { ok: false, created: 0, updated: 0, waiting: 0, skipped: 0, reasons: {} };

  if (!slug) return { ...empty, error: "CRM_SYNC_SERIES is not set." };

  const series = await db.series.findUnique({ where: { slug }, select: { id: true } });
  if (!series) return { ...empty, error: `No competition with the slug "${slug}".` };

  // A dry run reads and decides but takes no claim: it changes nothing, so it
  // cannot collide with anything.
  const claimed = dryRun || (await claimSync(db, now(), options.staleMs));
  if (!claimed) return { ...empty, ok: true, busy: true };

  let result: SyncResult;
  try {
    const client = options.client ?? createCrmClient();
    const snapshot = await readSnapshot(db, client, series.id);
    const actions = reconcile(snapshot);
    const planned = summarise(actions);

    if (dryRun) {
      // The PLANNED counts, not zeroes: "would create 55" is the answer
      // somebody runs a dry run to get, and reporting it as 55 skipped reads
      // like the opposite of what it means.
      console.info("[CRM:dry-run]", JSON.stringify(planned));
      return {
        ok: true,
        dryRun: true,
        created: planned.create,
        updated: planned.update,
        waiting: planned.intake,
        skipped: planned.skip,
        reasons: planned.reasons,
      };
    }

    const studioIdByName = new Map<string, string>();
    for (const studio of await db.studio.findMany({ select: { id: true, name: true } })) {
      // Keyed lowercase, the way `studioIdFor` looks it up — keying by the
      // exact name would miss every existing studio and make the sync try to
      // found each one again on every seat.
      studioIdByName.set(studio.name.toLowerCase(), studio.id);
    }

    let created = 0;
    let updated = 0;
    let waiting = 0;
    let skipped = 0;
    for (const action of actions) {
      // ONE RECORD AT A TIME, and one bad record does not stop the rest:
      // eighty-seven people should not wait on the one whose row is odd.
      try {
        const outcome = await apply(db, action, series.id, studioIdByName, now());
        if (outcome === "created") created += 1;
        else if (outcome === "updated") updated += 1;
        else if (outcome === "intake") waiting += 1;
        else skipped += 1;
      } catch (error) {
        skipped += 1;
        console.error(
          "[CRM:record]",
          action.externalId,
          error instanceof Error ? error.message.slice(0, 180) : "failed"
        );
      }
    }

    // ── Let in whoever there is room for ──────────────────────────────────
    //
    // A PASS, NOT A REACTION TO PAYMENT. Tying this to the moment money
    // arrives would miss the commoner case by far: a pair who paid weeks ago
    // and are let in because somebody else withdrew this morning. Nothing
    // about them changes in the CRM, so the reconciler has nothing to say
    // about them — the room is what changed.
    //
    // Money still does not buy a place; the floor does. `admitIfRoom` fills
    // a station on a wave somebody already planned and never creates one, so
    // the most this can do is what a person would have done by hand.
    let admitted = 0;
    const readyToAdmit = await db.team.findMany({
      where: {
        seriesId: series.id,
        archivedAt: null,
        waitlistedAt: { not: null },
        paymentStatus: "paid",
      },
      // Longest waiting first: the queue is a queue.
      orderBy: { waitlistedAt: "asc" },
      select: { id: true, number: true },
    });
    for (const team of readyToAdmit) {
      const seat = await admitIfRoom(db, team.id);
      if (!seat.admitted) {
        // No room stops the whole pass: the next team in the queue would find
        // the same full floor, and asking again per team is a query each.
        if (seat.reason === "NO_ROOM") break;
        continue;
      }
      admitted += 1;
      console.info(
        "[CRM:admit]",
        `team ${team.number} -> wave ${seat.waveNumber}, station ${seat.station}`
      );
    }
    if (admitted > 0) updated += admitted;

    // THE TABLE MIRRORS THE CRM, so what the CRM no longer has, it loses.
    // Without this, a contact deleted there — or finished by some path this
    // poll did not see — sits on the chase list forever and somebody rings
    // a person who sorted themselves out weeks ago.
    const stillWaiting = actions
      .filter((action) => action.kind === "intake")
      .map((action) => action.externalId);
    await db.crmIntake.deleteMany({
      where: { seriesId: series.id, externalId: { notIn: stillWaiting } },
    });

    result = { ok: true, created, updated, waiting, skipped, reasons: planned.reasons };
  } catch (error) {
    result = {
      ...empty,
      error: error instanceof Error ? error.message.slice(0, 180) : "Sync failed.",
    };
  }

  await releaseSync(db, now(), result).catch(() => undefined);
  return result;
}

/**
 * Start the poller. Returns the function that stops it.
 *
 * Shaped exactly like `startPortraitRunner`: every dependency is a parameter
 * with a production default, so tests drive it with no timers and no network.
 */
export function startCrmPoller(options: SyncOptions & { pollMs?: number } = {}) {
  const timer = setInterval(() => {
    void runSync(options)
      .then((result) => {
        if (result.busy) return;
        // A DRY RUN HAS ALREADY SAID ITS PIECE, on its own [CRM:dry-run] line
        // and in the plain words of a plan. It must not also appear here:
        // `created` on a dry run is what a real poll WOULD create, so this
        // line would read "[CRM:poll] created 56" while nothing was written —
        // which is both a fright to read during a rehearsal and, worse, makes
        // the real line afterwards prove nothing, because a rehearsal can
        // produce the same words.
        if (result.dryRun) return;
        if (!result.ok) console.error("[CRM:poll]", result.error);
        else if (result.created || result.updated) {
          console.info("[CRM:poll]", `created ${result.created}, updated ${result.updated}`);
        }
      })
      .catch((error: unknown) => {
        console.error("[CRM:poll]", error instanceof Error ? error.message : error);
      });
  }, options.pollMs ?? POLL_MS);
  // Never hold the process open, the same as request-timing.ts.
  timer.unref();

  return () => clearInterval(timer);
}
