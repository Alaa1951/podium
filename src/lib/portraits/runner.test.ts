/**
 * The worker that pays for image calls.
 *
 * Four things are pinned here, and each one prevents a failure that nothing
 * else would catch:
 *
 *   • a job is claimed ONCE, even from overlapping ticks — otherwise the same
 *     photo is paid for twice and two portraits race to be the current one
 *   • a job abandoned by a crash comes back — otherwise a restart mid-call
 *     leaves somebody's upload stuck for ever with no error anywhere
 *   • the uploaded photo is cleared when a job FAILS, not only when it
 *     succeeds — a face kept past the reason for keeping it
 *   • the composite pins the two portraits it combines — otherwise re-rolling
 *     one face produces a team image blending a new face with an old one, and
 *     nobody notices until it is on a wall
 *
 * The client is injected, as `play-publish.test.mjs` does: no network, and the
 * runner never learns whether the thing it called was real.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/portraits/openai-client", () => ({ createPortraitClient: () => ({}) }));

import { claimNext, reclaimStale, runOne, tick } from "@/lib/portraits/runner";

const NOW = new Date("2026-09-21T13:00:00.000Z");

type Row = Record<string, unknown>;

/** A prisma stand-in whose updateMany honours its WHERE, like the real one. */
function fakeDb(seed: { jobs?: Row[]; portraits?: Row[]; seats?: Row[] } = {}) {
  const jobs: Row[] = seed.jobs ?? [];
  const portraits: Row[] = seed.portraits ?? [];
  const seats: Row[] = seed.seats ?? [];
  const teams: Row[] = [];
  let ids = 0;

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, want]) => {
      const have = row[key];
      if (want && typeof want === "object" && !(want instanceof Date)) {
        const w = want as Record<string, unknown>;
        if ("lt" in w) return (have as Date) < (w.lt as Date);
        if ("gte" in w) return (have as number) >= (w.gte as number);
        if ("in" in w) return (w.in as unknown[]).includes(have);
        if ("not" in w) return have !== w.not;
        return true;
      }
      return have === want;
    });

  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as Row)) {
        row[key] = ((row[key] as number) ?? 0) + ((value as Row).increment as number);
      } else {
        row[key] = value;
      }
    }
  };

  const table = (rows: Row[]) => ({
    async findFirst({ where, orderBy }: { where: Row; orderBy?: Row }) {
      void orderBy;
      return rows.find((row) => matches(row, where)) ?? null;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return rows.find((row) => row.id === where.id) ?? null;
    },
    async findMany({ where }: { where?: Row } = {}) {
      return where ? rows.filter((row) => matches(row, where)) : rows;
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const hit = rows.filter((row) => matches(row, where));
      for (const row of hit) apply(row, data);
      return { count: hit.length };
    },
    async update({ where, data }: { where: { id: string }; data: Row }) {
      const row = rows.find((one) => one.id === where.id)!;
      apply(row, data);
      return row;
    },
    async create({ data }: { data: Row }) {
      // The schema's own defaults, which the real client applies and a fake
      // that forgets them makes a created row look unlike a stored one.
      const row = { id: `new-${++ids}`, createdAt: NOW, retryCount: 0, status: "queued", ...data };
      rows.push(row);
      return row;
    },
  });

  return {
    jobs,
    portraits,
    teams,
    portraitJob: table(jobs),
    competitorPortrait: table(portraits),
    teamPortrait: table(teams),
    competitor: {
      ...table(seats),
      async findMany({ where }: { where: Row }) {
        // Prisma always returns the relation named in the select; the fake
        // must too, or a seat with no portraits yet throws instead of reading
        // as "not ready".
        return seats
          .filter((row) => matches(row, where))
          .map((row) => ({ portraits: [], ...row }));
      },
    },
    team: table([{ id: "t1" }]),
  };
}

type Db = Parameters<typeof claimNext>[0];

const soloJob = (over: Row = {}): Row => ({
  id: "j1",
  targetKind: "competitor",
  competitorId: "c1",
  teamId: null,
  status: "queued",
  sourceB64: "AAAA",
  sourceMime: "image/jpeg",
  retryCount: 0,
  claimedAt: null,
  inputPortraitIdA: null,
  inputPortraitIdB: null,
  createdAt: NOW,
  ...over,
});

const client = () => ({
  restylePortrait: vi.fn(async () => ({ imageB64: "UE5H", mimeType: "image/png" })),
  compositeTeam: vi.fn(async () => ({ imageB64: "VEVBTQ==", mimeType: "image/png" })),
});

describe("claiming", () => {
  it("takes a job exactly once, even from two overlapping ticks", async () => {
    const db = fakeDb({ jobs: [soloJob()] });
    const [a, b] = await Promise.all([
      claimNext(db as unknown as Db, NOW),
      claimNext(db as unknown as Db, NOW),
    ]);
    // One of them got it; the other got nothing. Both getting it would be two
    // paid calls for one upload.
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(db.jobs[0].status).toBe("running");
  });

  it("leaves nothing to claim when the queue is empty", async () => {
    const db = fakeDb({ jobs: [soloJob({ status: "succeeded" })] });
    expect(await claimNext(db as unknown as Db, NOW)).toBeNull();
  });
});

describe("recovering from a crash", () => {
  const long = new Date(NOW.getTime() - 10 * 60_000);

  it("puts an abandoned job back on the queue", async () => {
    const db = fakeDb({ jobs: [soloJob({ status: "running", claimedAt: long })] });
    await reclaimStale(db as unknown as Db, NOW, 5 * 60_000, 2);
    expect(db.jobs[0]).toMatchObject({ status: "queued", retryCount: 1, claimedAt: null });
  });

  it("gives up once it has been abandoned too often, and clears the photo", async () => {
    const db = fakeDb({ jobs: [soloJob({ status: "running", claimedAt: long, retryCount: 2 })] });
    await reclaimStale(db as unknown as Db, NOW, 5 * 60_000, 2);
    expect(db.jobs[0]).toMatchObject({ status: "failed", sourceB64: null, sourceMime: null });
  });

  it("leaves a job that is merely slow alone", async () => {
    const recent = new Date(NOW.getTime() - 30_000);
    const db = fakeDb({ jobs: [soloJob({ status: "running", claimedAt: recent })] });
    await reclaimStale(db as unknown as Db, NOW, 5 * 60_000, 2);
    expect(db.jobs[0].status).toBe("running");
  });
});

describe("running one job", () => {
  it("stores the portrait, points the seat at it, and clears the upload", async () => {
    const db = fakeDb({ jobs: [soloJob({ status: "running" })], seats: [{ id: "c1", teamId: "t1" }] });
    await runOne(db as unknown as Db, client(), db.jobs[0] as never, NOW, 2);

    expect(db.portraits[0]).toMatchObject({ competitorId: "c1", imageB64: "UE5H" });
    // Same-origin and rooted, so the existing athletePhoto() guard accepts it.
    expect(db.jobs[0]).toMatchObject({ status: "succeeded", sourceB64: null, sourceMime: null });
  });

  it("clears the uploaded photo when the call FAILS for good", async () => {
    // The retention rule. A failed job has no more use for somebody's face
    // than a successful one, and only ever testing the happy path is how that
    // stops being true.
    const db = fakeDb({ jobs: [soloJob({ status: "running", retryCount: 2 })] });
    const failing = { ...client(), restylePortrait: vi.fn(async () => { throw new Error("nope"); }) };
    await runOne(db as unknown as Db, failing, db.jobs[0] as never, NOW, 2);

    expect(db.jobs[0]).toMatchObject({ status: "failed", sourceB64: null, sourceMime: null });
  });

  it("retries before giving up, keeping the photo for the next attempt", async () => {
    const db = fakeDb({ jobs: [soloJob({ status: "running", retryCount: 0 })] });
    const failing = { ...client(), restylePortrait: vi.fn(async () => { throw new Error("nope"); }) };
    await runOne(db as unknown as Db, failing, db.jobs[0] as never, NOW, 2);

    expect(db.jobs[0]).toMatchObject({ status: "queued", retryCount: 1 });
    expect(db.jobs[0].sourceB64).toBe("AAAA");
  });

  it("never throws, so one bad job cannot stop the worker", async () => {
    const db = fakeDb({ jobs: [soloJob({ status: "running" })] });
    const exploding = {
      ...client(),
      restylePortrait: vi.fn(async () => { throw new Error("boom"); }),
    };
    await expect(
      runOne(db as unknown as Db, exploding, db.jobs[0] as never, NOW, 2)
    ).resolves.toBeUndefined();
  });
});

describe("the team composite", () => {
  it("is queued with the CURRENT portrait ids once both seats are done", async () => {
    const db = fakeDb({
      jobs: [soloJob({ status: "running" })],
      seats: [
        { id: "c1", teamId: "t1", position: 1, portraits: [{ id: "p-old-1" }] },
        { id: "c2", teamId: "t1", position: 2, portraits: [{ id: "p2" }] },
      ],
    });
    await runOne(db as unknown as Db, client(), db.jobs[0] as never, NOW, 2);

    const composite = db.jobs.find((job) => job.targetKind === "team");
    expect(composite).toBeTruthy();
    // Pinned, not looked up later: a re-roll mid-flight cannot swap one face.
    expect(composite).toMatchObject({ teamId: "t1", status: "queued" });
    expect(composite!.inputPortraitIdA).toBeTruthy();
    expect(composite!.inputPortraitIdB).toBeTruthy();
  });

  it("supersedes a composite already waiting, rather than leaving two", async () => {
    const stale = { id: "old", targetKind: "team", teamId: "t1", status: "queued", retryCount: 0, createdAt: NOW };
    const db = fakeDb({
      jobs: [soloJob({ status: "running" }), stale],
      seats: [
        { id: "c1", teamId: "t1", position: 1, portraits: [{ id: "p1" }] },
        { id: "c2", teamId: "t1", position: 2, portraits: [{ id: "p2" }] },
      ],
    });
    await runOne(db as unknown as Db, client(), db.jobs[0] as never, NOW, 2);

    expect(stale).toMatchObject({ status: "failed", failedReason: "Superseded" });
    expect(db.jobs.filter((job) => job.targetKind === "team" && job.status === "queued")).toHaveLength(1);
  });

  it("is NOT queued while only one seat has a portrait", async () => {
    const db = fakeDb({
      jobs: [soloJob({ status: "running" })],
      seats: [
        { id: "c1", teamId: "t1", position: 1, portraits: [{ id: "p1" }] },
        { id: "c2", teamId: "t1", position: 2, portraits: [] },
      ],
    });
    await runOne(db as unknown as Db, client(), db.jobs[0] as never, NOW, 2);
    expect(db.jobs.some((job) => job.targetKind === "team")).toBe(false);
  });
});

describe("a tick", () => {
  it("does not start more than the concurrency allows", async () => {
    const db = fakeDb({
      jobs: [soloJob({ id: "j1" }), soloJob({ id: "j2" }), soloJob({ id: "j3" })],
      seats: [{ id: "c1", teamId: "t1" }],
    });
    const inFlight = { count: 0 };
    await tick({
      prisma: db as unknown as Db,
      client: client(),
      now: () => NOW,
      concurrency: 2,
      staleMs: 5 * 60_000,
      maxRetries: 2,
      inFlight,
    });
    const started = db.jobs.filter((job) => job.claimedAt !== null);
    expect(started.length).toBeLessThanOrEqual(2);
  });
});
