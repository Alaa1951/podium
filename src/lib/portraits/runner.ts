import "server-only";

import { prisma as defaultPrisma } from "@/lib/prisma";
import { createPortraitClient, type PortraitClient } from "@/lib/portraits/openai-client";
import { compressForStorage } from "@/lib/portraits/upload";

// ─────────────────────────────────────────────────────────────────────────────
// THE WORKER.
//
// There is no queue in this project and no job runner to build on — the only
// background precedent in the codebase is the setInterval + unref + cleanup
// closure in `request-timing.ts`, so this is that, started once from
// `instrumentation.ts`.
//
// HOW WORK IS CLAIMED is the part that matters. A row is taken with
// `updateMany({ where: { id, status: "queued" } })` and run only if it changed
// exactly one row — the same idiom that starts a wave exactly once. Two ticks
// overlapping, or a second process arriving one day, cannot both pay for the
// same call. That is the one property of this design that survives the
// single-process assumption being broken later.
//
// HOW A CRASH RECOVERS: a row left `running` past `staleMs` goes back to
// `queued` with its retry count bumped, and to `failed` once that is spent.
// There is no owner to record and no lease to renew — a timestamp is enough,
// and it heals whether the same process came back or a deploy replaced it.
//
// THE UPLOADED PHOTO IS CLEARED WHEN A JOB ENDS, either way. Not when it
// succeeds — either way. A failed job has no more use for a photograph of
// somebody's face than a successful one does.
// ─────────────────────────────────────────────────────────────────────────────

type Db = typeof defaultPrisma;

export type RunnerOptions = {
  prisma?: Db;
  client?: PortraitClient;
  now?: () => Date;
  pollMs?: number;
  concurrency?: number;
  /** How long a `running` row may sit before it is presumed abandoned. */
  staleMs?: number;
  maxRetries?: number;
};

/**
 * Whether the feature is switched on at all.
 *
 * Absent means OFF. The tables exist in production and every door is shut
 * until somebody sets this deliberately — which is what keeps the feature out
 * of the live site while the store review is running, since the native shell
 * loads that site directly.
 */
export function portraitsEnabled(): boolean {
  return process.env.PORTRAITS_ENABLED === "1";
}

const DEFAULTS = { pollMs: 5_000, concurrency: 2, staleMs: 5 * 60_000, maxRetries: 2 };

/** Put abandoned work back, and give up on what has been abandoned too often. */
export async function reclaimStale(prisma: Db, now: Date, staleMs: number, maxRetries: number) {
  const cutoff = new Date(now.getTime() - staleMs);
  await prisma.portraitJob.updateMany({
    where: { status: "running", claimedAt: { lt: cutoff }, retryCount: { lt: maxRetries } },
    data: { status: "queued", retryCount: { increment: 1 }, claimedAt: null },
  });
  await prisma.portraitJob.updateMany({
    where: { status: "running", claimedAt: { lt: cutoff }, retryCount: { gte: maxRetries } },
    data: {
      status: "failed",
      failedReason: "Abandoned",
      finishedAt: now,
      sourceB64: null,
      sourceMime: null,
    },
  });
}

/** Take the oldest queued job, or nothing. */
export async function claimNext(prisma: Db, now: Date) {
  const candidate = await prisma.portraitJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!candidate) return null;

  const claimed = await prisma.portraitJob.updateMany({
    where: { id: candidate.id, status: "queued" },
    data: { status: "running", claimedAt: now, startedAt: now },
  });
  // Somebody else took it between the read and the write. Not an error — the
  // next tick finds whatever is left.
  if (claimed.count === 0) return null;

  return prisma.portraitJob.findUnique({ where: { id: candidate.id } });
}

type Job = NonNullable<Awaited<ReturnType<typeof claimNext>>>;

async function finishFailed(prisma: Db, job: Job, now: Date, reason: string, maxRetries: number) {
  const canRetry = job.retryCount < maxRetries;
  await prisma.portraitJob.update({
    where: { id: job.id },
    data: canRetry
      ? { status: "queued", retryCount: { increment: 1 }, claimedAt: null, failedReason: reason }
      : {
          status: "failed",
          failedReason: reason,
          finishedAt: now,
          // Ended is ended: the photo goes whether this went well or badly.
          sourceB64: null,
          sourceMime: null,
        },
  });
}

/**
 * Both portraits of a team exist? Then queue the composite.
 *
 * The two portrait ids are PINNED here rather than looked up when that job
 * runs. Without it, re-rolling one face while a composite waits produces a
 * team image with one new face and one old one — and nobody would spot that
 * until it was on a wall.
 */
async function queueCompositeIfReady(prisma: Db, teamId: string, now: Date) {
  const seats = await prisma.competitor.findMany({
    where: { teamId },
    orderBy: { position: "asc" },
    select: { portraits: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
  });
  const latest = seats.map((seat) => seat.portraits[0]?.id).filter(Boolean) as string[];
  if (seats.length !== 2 || latest.length !== 2) return;

  // Any composite already waiting is for an older pair of faces.
  await prisma.portraitJob.updateMany({
    where: { teamId, targetKind: "team", status: "queued" },
    data: { status: "failed", failedReason: "Superseded", finishedAt: now },
  });

  await prisma.portraitJob.create({
    data: {
      targetKind: "team",
      teamId,
      inputPortraitIdA: latest[0],
      inputPortraitIdB: latest[1],
    },
  });
}

/** One job, start to finish. Never throws: a worker that dies stops working. */
export async function runOne(
  prisma: Db,
  client: PortraitClient,
  job: Job,
  now: Date,
  maxRetries: number
) {
  try {
    if (job.targetKind === "competitor") {
      if (!job.competitorId || !job.sourceB64 || !job.sourceMime) {
        await finishFailed(prisma, job, now, "Nothing to work from", maxRetries);
        return;
      }
      const generated = await client.restylePortrait({
        imageB64: job.sourceB64,
        mimeType: job.sourceMime,
      });
      // A real call returns a ~1.4MB PNG; stored as-is that is ~1.9MB of
      // base64 per face, in the database and in every backup.
      const result = await compressForStorage(generated);
      const portrait = await prisma.competitorPortrait.create({
        data: {
          competitorId: job.competitorId,
          jobId: job.id,
          imageB64: result.imageB64,
          mimeType: result.mimeType,
        },
        select: { id: true, competitorId: true },
      });
      await prisma.competitor.update({
        where: { id: portrait.competitorId },
        // Same-origin and rooted, so `athletePhoto()` accepts it unchanged.
        data: { photoPath: `/api/portraits/competitor/${portrait.competitorId}/${portrait.id}` },
      });
      await prisma.portraitJob.update({
        where: { id: job.id },
        data: { status: "succeeded", finishedAt: now, sourceB64: null, sourceMime: null },
      });

      const seat = await prisma.competitor.findUnique({
        where: { id: portrait.competitorId },
        select: { teamId: true },
      });
      if (seat) await queueCompositeIfReady(prisma, seat.teamId, now);
      return;
    }

    // ── The team composite ────────────────────────────────────────────────
    if (!job.teamId || !job.inputPortraitIdA || !job.inputPortraitIdB) {
      await finishFailed(prisma, job, now, "Nothing to work from", maxRetries);
      return;
    }
    const sources = await prisma.competitorPortrait.findMany({
      where: { id: { in: [job.inputPortraitIdA, job.inputPortraitIdB] } },
      select: { id: true, imageB64: true, mimeType: true },
    });
    if (sources.length !== 2) {
      await finishFailed(prisma, job, now, "A source portrait is gone", maxRetries);
      return;
    }
    // Back into the order they were pinned in, so seat 1 stays on the left.
    const a = sources.find((one) => one.id === job.inputPortraitIdA)!;
    const b = sources.find((one) => one.id === job.inputPortraitIdB)!;

    const composed = await client.compositeTeam({
      a: { imageB64: a.imageB64, mimeType: a.mimeType },
      b: { imageB64: b.imageB64, mimeType: b.mimeType },
    });
    const result = await compressForStorage(composed);
    const teamPortrait = await prisma.teamPortrait.create({
      data: {
        teamId: job.teamId,
        jobId: job.id,
        imageB64: result.imageB64,
        mimeType: result.mimeType,
      },
      select: { id: true, teamId: true },
    });
    await prisma.team.update({
      where: { id: teamPortrait.teamId },
      data: { groupPortraitPath: `/api/portraits/team/${teamPortrait.teamId}/${teamPortrait.id}` },
    });
    await prisma.portraitJob.update({
      where: { id: job.id },
      data: { status: "succeeded", finishedAt: now },
    });
  } catch (error) {
    // The message is already redacted by the client; nothing here adds to it.
    const reason = error instanceof Error ? error.message.slice(0, 180) : "Failed";
    await finishFailed(prisma, job, now, reason, maxRetries).catch(() => undefined);
  }
}

type TickSettings = {
  prisma: Db;
  client: PortraitClient;
  now: () => Date;
  concurrency: number;
  staleMs: number;
  maxRetries: number;
  inFlight: { count: number };
};

/** One pass: recover what was abandoned, then take what work there is. */
export async function tick(settings: TickSettings) {
  const { prisma, client, now, concurrency, staleMs, maxRetries, inFlight } = settings;
  await reclaimStale(prisma, now(), staleMs, maxRetries);

  while (inFlight.count < concurrency) {
    const job = await claimNext(prisma, now());
    if (!job) break;
    inFlight.count += 1;
    void runOne(prisma, client, job, now(), maxRetries).finally(() => {
      inFlight.count -= 1;
    });
  }
}

/**
 * Start the worker. Returns the function that stops it.
 *
 * Shaped exactly like `startRequestTiming`: every dependency is a parameter
 * with a production default, so tests drive it with no timers, no database and
 * no network.
 */
export function startPortraitRunner(options: RunnerOptions = {}) {
  const settings: TickSettings = {
    prisma: options.prisma ?? defaultPrisma,
    client: options.client ?? createPortraitClient(),
    now: options.now ?? (() => new Date()),
    concurrency: options.concurrency ?? DEFAULTS.concurrency,
    staleMs: options.staleMs ?? DEFAULTS.staleMs,
    maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
    inFlight: { count: 0 },
  };

  const timer = setInterval(() => {
    void tick(settings).catch((error: unknown) => {
      console.error("[PORTRAITS:tick]", error instanceof Error ? error.message : error);
    });
  }, options.pollMs ?? DEFAULTS.pollMs);
  // Never hold the process open, the same as request-timing.ts.
  timer.unref();

  return () => clearInterval(timer);
}
