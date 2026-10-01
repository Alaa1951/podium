import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Category, Division } from "@/generated/prisma/enums";
import { editionContent, findWaiverDocument, SIGNING_TEXT, WAIVER_LANGUAGES, type WaiverLanguage } from "@/lib/waivers/document";
import { normaliseSignature, waiverState, type WaiverState } from "@/lib/waivers/status";

// ─────────────────────────────────────────────────────────────────────────────
// WAIVERS AGAINST THE DATABASE.
//
//   attach   BFT MENA makes a bundled document the competition's required
//            version. The previous one is retired, never deleted, and every
//            signature of it is kept.
//   sign     The athlete — the SESSION's account, never an id in the
//            request — signs the active version for their own seat: typed
//            name, ticked box, language. One row per release · account:
//            pressing twice, or two tabs at once, is one signature. Rows are
//            only ever inserted. The signature is the athlete's own consent
//            and covers them whatever category or level follows.
//   states   For a desk or the floor: each seat's waiver state, from its
//            account's own acceptances.
//
// Nothing here can create a signature for anybody but the account signing.
// ─────────────────────────────────────────────────────────────────────────────

type Db = PrismaClient | Prisma.TransactionClient;

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export async function activeRelease(db: Db, seriesId: string) {
  return db.waiverRelease.findFirst({
    where: { seriesId, status: "active" },
    orderBy: { version: "desc" },
    select: { id: true, version: true, documentKey: true, activatedAt: true, editions: { select: { id: true, language: true, contentHash: true } } },
  });
}

export type SeatForWaiver = { competitorId: string; userId: string | null };

/** Each seat's waiver state, from its account's acceptances in this competition. */
export async function waiverStates(db: Db, seriesId: string, seats: readonly SeatForWaiver[]): Promise<Map<string, WaiverState>> {
  const release = await activeRelease(db, seriesId);
  const userIds = [...new Set(seats.map((seat) => seat.userId).filter((id): id is string => Boolean(id)))];
  const acceptances = release && userIds.length
    ? await db.waiverAcceptance.findMany({ where: { seriesId, userId: { in: userIds } }, select: { userId: true, releaseId: true } })
    : [];
  return new Map(seats.map((seat) => [seat.competitorId, waiverState({
    release,
    userId: seat.userId,
    acceptances: acceptances.filter((one) => one.userId === seat.userId),
  })]));
}

/** The seats of these teams, as `waiverStates` needs them. */
export async function seatsOf(db: Db, teamIds: readonly string[]): Promise<(SeatForWaiver & { teamId: string; fullName: string; attendedAt: Date | null })[]> {
  const seats = await db.competitor.findMany({
    where: { teamId: { in: [...teamIds] } },
    orderBy: [{ teamId: "asc" }, { position: "asc" }],
    select: { id: true, teamId: true, fullName: true, attendedAt: true, userId: true, user: { select: { name: true } } },
  });
  return seats.map((seat) => ({
    // The name the desks show: the account's own, else the registration's.
    competitorId: seat.id, teamId: seat.teamId, fullName: seat.user?.name ?? seat.fullName, attendedAt: seat.attendedAt, userId: seat.userId,
  }));
}

export type AttachError = "UNKNOWN_DOCUMENT" | "ALREADY_ACTIVE";

/** Make a bundled document the competition's required version. Run inside the competition's lock. */
export async function attachRelease(tx: Prisma.TransactionClient, input: { seriesId: string; documentKey: string; version: number; actorId: string }) {
  const doc = findWaiverDocument(input.documentKey, input.version);
  if (!doc) return { ok: false as const, error: "UNKNOWN_DOCUMENT" as AttachError };
  const current = await activeRelease(tx, input.seriesId);
  if (current && current.documentKey === `${doc.key}@${doc.version}`) return { ok: false as const, error: "ALREADY_ACTIVE" as AttachError };
  const last = await tx.waiverRelease.findFirst({ where: { seriesId: input.seriesId }, orderBy: { version: "desc" }, select: { version: true } });
  const now = new Date();
  if (current) await tx.waiverRelease.update({ where: { id: current.id }, data: { status: "retired", retiredAt: now } });
  const release = await tx.waiverRelease.create({
    data: {
      seriesId: input.seriesId, version: (last?.version ?? 0) + 1, documentKey: `${doc.key}@${doc.version}`, activatedById: input.actorId,
      editions: {
        create: WAIVER_LANGUAGES.map((language) => {
          const content = editionContent(doc.editions[language]);
          return { language, content, contentHash: sha256(content), acknowledgement: SIGNING_TEXT[language].acknowledgement };
        }),
      },
    },
    select: { id: true, version: true },
  });
  return { ok: true as const, release, retired: current?.version ?? null };
}

export type SignError =
  | "NOT_REGISTERED" | "AMBIGUOUS_REGISTRATION" | "NO_WAIVER" | "STALE_VERSION" | "INVALID_LANGUAGE"
  | "ACKNOWLEDGEMENT_REQUIRED" | "NAME_REQUIRED" | "NAME_TOO_LONG";

export type SignResult =
  | { ok: true; acceptanceId: string; already: boolean; version: number; team: { id: string; label: string }; language: WaiverLanguage }
  | { ok: false; error: SignError; currentVersion?: number };

class Refused extends Error {
  constructor(readonly code: SignError, readonly currentVersion?: number) { super(code); }
}

/**
 * The athlete signs. `userId` is the session's account; the seat is found
 * from it — a request naming somebody else's seat or account has no way to
 * say so. The release row is locked while signing, so a new version cannot
 * be activated half-way through.
 */
export async function signWaiver(db: PrismaClient, userId: string, input: {
  seriesId: string; releaseId: string; language: WaiverLanguage; typedName: string; agreed: boolean;
}): Promise<SignResult> {
  try {
    return await db.$transaction(async (tx): Promise<SignResult> => {
      const seats = await tx.competitor.findMany({
        where: { userId, team: { seriesId: input.seriesId, archivedAt: null } },
        select: { id: true, team: { select: { id: true, number: true, name: true, category: true, division: true } } },
      });
      if (!seats.length) throw new Refused("NOT_REGISTERED");
      if (seats.length > 1) throw new Refused("AMBIGUOUS_REGISTRATION");
      const seat = seats[0];

      await tx.$queryRaw`SELECT id FROM WaiverRelease WHERE seriesId = ${input.seriesId} FOR UPDATE`;
      const release = await activeRelease(tx, input.seriesId);
      if (!release) throw new Refused("NO_WAIVER");
      if (release.id !== input.releaseId) throw new Refused("STALE_VERSION", release.version);
      const edition = release.editions.find((one) => one.language === input.language);
      if (!edition) throw new Refused("INVALID_LANGUAGE");

      if (input.agreed !== true) throw new Refused("ACKNOWLEDGEMENT_REQUIRED");
      const typedName = normaliseSignature(input.typedName);
      if (!typedName) throw new Refused("NAME_REQUIRED");
      if (typedName.length > 200) throw new Refused("NAME_TOO_LONG");

      // The athlete signs for themselves; one signature per version.
      const dedupeKey = `${release.id}:${userId}`;
      const team = { id: seat.team.id, label: `${seat.team.number} ${seat.team.name}` };
      const existing = await tx.waiverAcceptance.findUnique({ where: { dedupeKey }, select: { id: true } });
      if (existing) return { ok: true, acceptanceId: existing.id, already: true, version: release.version, team, language: input.language };
      const created = await tx.waiverAcceptance.create({
        data: {
          releaseId: release.id, editionId: edition.id, seriesId: input.seriesId, userId, teamId: seat.team.id, competitorId: seat.id,
          typedName, acknowledgement: SIGNING_TEXT[input.language].acknowledgement, language: input.language, contentHash: edition.contentHash,
          category: seat.team.category as Category, division: seat.team.division as Division, dedupeKey,
        },
        select: { id: true },
      });
      return { ok: true, acceptanceId: created.id, already: false, version: release.version, team, language: input.language };
    }, { isolationLevel: "ReadCommitted", timeout: 20_000 });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code, currentVersion: error.currentVersion };
    // Two submissions at the same instant: the unique key kept one; this is it.
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002") {
      const release = await activeRelease(db, input.seriesId);
      const one = await db.waiverAcceptance.findFirst({ where: { seriesId: input.seriesId, userId, releaseId: release?.id }, orderBy: { acceptedAt: "desc" }, select: { id: true, teamId: true } });
      if (one && release) return { ok: true, acceptanceId: one.id, already: true, version: release.version, team: { id: one.teamId, label: "" }, language: input.language };
    }
    throw error;
  }
}

/** A signed record, for its receipt: the athlete's own, or anybody's for `waivers.manage`. */
export async function loadReceipt(db: Db, acceptanceId: string, viewer: { id: string; mayReadAll: boolean }) {
  const record = await db.waiverAcceptance.findUnique({
    where: { id: acceptanceId },
    include: { edition: { select: { content: true, contentHash: true, language: true } }, release: { select: { version: true, seriesId: true, series: { select: { name: true } } } } },
  });
  if (!record || (record.userId !== viewer.id && !viewer.mayReadAll)) return null;
  return { ...record, contentIntact: sha256(record.edition.content) === record.contentHash };
}
