import "server-only";

import { prisma as defaultPrisma } from "@/lib/prisma";
import { createCrmClient, type CrmClient } from "@/lib/crm/client";
import { assertFieldMap } from "@/lib/crm/field-map";
import { reconcile, summarise, type Action, type Snapshot } from "@/lib/crm/reconcile";
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
      lastSkipped: result.skipped,
      // Already redacted by the client — a status and a short code, no body.
      lastError: result.error ? result.error.slice(0, 180) : null,
    },
  });
}

/** Everything the plan is worked out against, read in one pass. */
async function readSnapshot(db: Db, client: CrmClient, seriesId: string): Promise<Snapshot> {
  const [fieldIds, pipelines, contacts, opportunities, studios, teams] = await Promise.all([
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
  };
}

/** Carry out one action. Returns what happened, never throws for a bad record. */
async function apply(
  db: Db,
  action: Action,
  seriesId: string,
  studioIdByName: Map<string, string>,
  now: Date
): Promise<"created" | "updated" | "skipped"> {
  if (action.kind === "skip") return "skipped";

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
  const seats = draft.seats.map((seat) => ({
    position: seat.position,
    fullName: seat.fullName,
    email: seat.email,
    phone: seat.phone,
    dateOfBirth: seat.dateOfBirth,
    shirtSize: seat.shirtSize,
    bftMember: seat.bftMember,
    studioId: seat.studioName ? (studioIdByName.get(seat.studioName) ?? null) : null,
  }));

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
    amountMinor: draft.amountMinor,
    billingNumber: draft.billingNumber,
    externalId: draft.externalId,
    seats,
  });

  // ALREADY_ENTERED is not a failure. It is the unique index doing its job
  // when two polls overlap, and the right response is to count it and move on.
  return created.ok ? "created" : "skipped";
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

  const empty: SyncResult = { ok: false, created: 0, updated: 0, skipped: 0, reasons: {} };

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
        skipped: planned.skip,
        reasons: planned.reasons,
      };
    }

    const studioIdByName = new Map<string, string>();
    for (const studio of await db.studio.findMany({ select: { id: true, name: true } })) {
      studioIdByName.set(studio.name, studio.id);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const action of actions) {
      // ONE RECORD AT A TIME, and one bad record does not stop the rest:
      // eighty-five people should not wait on the one whose row is odd.
      try {
        const outcome = await apply(db, action, series.id, studioIdByName, now());
        if (outcome === "created") created += 1;
        else if (outcome === "updated") updated += 1;
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

    result = { ok: true, created, updated, skipped, reasons: planned.reasons };
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
