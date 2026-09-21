/**
 * Taking a photo in.
 *
 * Two of these are load-bearing and the rest are their supporting cast.
 *
 * NO CONSENT, NO JOB. The disclosure on the upload screen is the only thing
 * telling somebody their photograph leaves this server; if a job could be
 * created without it, that sentence would be decoration. So the check runs
 * before anything else and is asserted to create nothing.
 *
 * NOT MY TEAM, NOT MY UPLOAD. The rule is membership of the team, not
 * ownership of a seat — deliberately, so a person can upload their partner's
 * photo. That is exactly the shape of rule that goes wrong in the permissive
 * direction, so the test that matters is the stranger being refused.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));
// A stand-in that behaves like sharp's chainable API for the one thing these
// tests need: `compressForStorage` producing smaller bytes than it was given.
vi.mock("sharp", () => ({
  default: () => {
    const chain = {
      rotate: () => chain,
      resize: () => chain,
      jpeg: () => chain,
      toBuffer: async () => Buffer.from("small"),
    };
    return chain;
  },
}));

import { compressForStorage, MAX_UPLOAD_BYTES, queuePortrait } from "@/lib/portraits/upload";

const NOW = new Date("2026-09-21T13:00:00.000Z");
const bytes = Buffer.from("pretend-this-is-a-jpeg");

/** Always says the bytes were a fine image, so the rules are what is tested. */
const normalise = async () => ({ b64: "QUJD", mime: "image/jpeg" });

function fakeDb({ seat = { id: "c1" } as { id: string } | null, jobsForSeat = 0 } = {}) {
  const created: Record<string, unknown>[] = [];
  const days = new Map<string, number>();
  return {
    created,
    days,
    competitor: { findFirst: async () => seat },
    portraitJob: {
      count: async () => jobsForSeat,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `job-${created.length}` };
      },
    },
    portraitSpendCounter: {
      upsert: async ({ where, create }: { where: { day: string }; create: { count: number } }) => {
        if (!days.has(where.day)) days.set(where.day, create.count);
        return {};
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { day: string; count?: { lt?: number; gt?: number } };
        data: { count: { increment?: number; decrement?: number } };
      }) => {
        const current = days.get(where.day);
        if (current === undefined) return { count: 0 };
        if (where.count?.lt !== undefined && !(current < where.count.lt)) return { count: 0 };
        if (where.count?.gt !== undefined && !(current > where.count.gt)) return { count: 0 };
        days.set(where.day, current + (data.count.increment ?? 0) - (data.count.decrement ?? 0));
        return { count: 1 };
      },
    },
  };
}

type Db = Parameters<typeof queuePortrait>[1];

const input = (over: Partial<Parameters<typeof queuePortrait>[0]> = {}) => ({
  userId: "u1",
  competitorId: "c1",
  consent: true,
  bytes,
  ip: "203.0.113.4",
  now: NOW,
  ...over,
});

let db: ReturnType<typeof fakeDb>;
beforeEach(() => {
  db = fakeDb();
});

describe("consent", () => {
  it("refuses without it, and creates nothing", async () => {
    const result = await queuePortrait(input({ consent: false }), db as unknown as Db, normalise);
    expect(result).toEqual({ ok: false, error: "CONSENT_REQUIRED" });
    expect(db.created).toHaveLength(0);
  });

  it("records WHEN and FROM WHERE it was given", async () => {
    await queuePortrait(input(), db as unknown as Db, normalise);
    expect(db.created[0]).toMatchObject({
      consentAt: NOW,
      consentIp: "203.0.113.4",
      uploadedById: "u1",
    });
  });

  it("is checked before the budget, so a refusal costs nobody a slot", async () => {
    await queuePortrait(input({ consent: false }), db as unknown as Db, normalise);
    expect(db.days.size).toBe(0);
  });
});

describe("whose seat it is", () => {
  it("refuses a seat on somebody else's team", async () => {
    // The lookup is scoped by membership, so a stranger's seat simply is not
    // found — the same shape of guard the rest of the app uses.
    const other = fakeDb({ seat: null });
    const result = await queuePortrait(input(), other as unknown as Db, normalise);
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(other.created).toHaveLength(0);
  });

  it("allows a seat that is not the uploader's own — the partner case", async () => {
    const result = await queuePortrait(
      input({ competitorId: "c2" }),
      fakeDb({ seat: { id: "c2" } }) as unknown as Db,
      normalise
    );
    expect(result).toMatchObject({ ok: true });
  });
});

describe("what arrives", () => {
  it("refuses an empty body", async () => {
    const result = await queuePortrait(
      input({ bytes: Buffer.alloc(0) }),
      db as unknown as Db,
      normalise
    );
    expect(result).toEqual({ ok: false, error: "NO_IMAGE" });
  });

  it("refuses something too big to be a photo somebody meant to send", async () => {
    const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    const result = await queuePortrait(input({ bytes: huge }), db as unknown as Db, normalise);
    expect(result).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("refuses bytes that are not an image, whatever they claimed to be", async () => {
    const notAnImage = async () => null;
    const result = await queuePortrait(input(), db as unknown as Db, notAnImage);
    expect(result).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    expect(db.created).toHaveLength(0);
  });

  it("stores the RE-ENCODED bytes, never what was sent", async () => {
    // EXIF carries GPS. What is stored and sent onward is sharp's output, so a
    // photo taken at somebody's home does not arrive with their address on it.
    await queuePortrait(input(), db as unknown as Db, normalise);
    expect(db.created[0]).toMatchObject({ sourceB64: "QUJD", sourceMime: "image/jpeg" });
    expect(db.created[0].sourceB64).not.toBe(bytes.toString("base64"));
  });
});

describe("the budget", () => {
  it("refuses a seat that has used its attempts", async () => {
    const spent = fakeDb({ jobsForSeat: 99 });
    const result = await queuePortrait(input(), spent as unknown as Db, normalise);
    expect(result).toEqual({ ok: false, error: "SEAT_LIMIT" });
    expect(spent.created).toHaveLength(0);
  });

  it("takes exactly one slot for a job it creates", async () => {
    await queuePortrait(input(), db as unknown as Db, normalise);
    expect(db.days.get("2026-09-21")).toBe(1);
    expect(db.created).toHaveLength(1);
  });
});

describe("what is stored after generation", () => {
  it("re-encodes the API's PNG, because the raw one is enormous", async () => {
    // Measured against a real call: 1024x1024 came back as a 1.4MB PNG, which
    // is ~1.9MB of base64 per face — in the database and in every nightly
    // mysqldump. Storing the JPEG instead is the difference between half a
    // gigabyte and twenty megabytes at a hundred teams.
    const huge = { imageB64: Buffer.alloc(200_000).toString("base64"), mimeType: "image/png" };
    const stored = await compressForStorage(huge);
    expect(stored.mimeType).toBe("image/jpeg");
    expect(stored.imageB64.length).toBeLessThan(huge.imageB64.length);
  });
});
