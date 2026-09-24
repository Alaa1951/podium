"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { sendPartnerRequestEmail } from "@/lib/email";
import { partnerCandidateExists } from "@/lib/partner-directory";
import { enterPairIfReady } from "@/lib/enter-pair";
import { alreadyEntered } from "@/lib/one-entry";
import { linkPair } from "@/lib/partners";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { prisma } from "@/lib/prisma";
import { resolveMySeries, meHref } from "@/lib/participation";
import { checkRate, MINUTE_MS } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/security";
import { can, requireRole } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// PARTNER REQUESTS.
//
// One athlete asks another. The other one answers, and nobody else can answer
// for them — every action below puts the asker's or the answerer's own id in
// the `where` of the statement that writes, so the authorisation and the write
// are the same statement and cannot drift apart.
//
// ACCEPTING IS THE ONLY THING THAT LINKS. It claims both profiles with
// conditional writes inside one transaction, so two people accepting different
// requests at the same instant cannot both win.
// ─────────────────────────────────────────────────────────────────────────────

export type PartnerRequestResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "TRY_LATER"
        | "NOT_FOUND"
        | "PROFILE_INCOMPLETE"
        | "ALREADY_LINKED"
        | "ALREADY_REQUESTED"
        | "THEY_ASKED_YOU"
        | "DECLINED_BEFORE"
        | "TOO_MANY_PENDING"
        | "ALREADY_DECIDED"
        | "FAILED";
    };

/** At most this many asks may be outstanding at once. */
const MAX_PENDING = 5;

/** Sorted and joined, so a pair reads the same whichever way round it is. */
const pairKeyOf = (a: string, b: string) => [a, b].sort().join(":");

const idSchema = z.object({ seriesId: z.string().min(1), requestId: z.string().min(1).max(191) });

function revalidate() {
  revalidatePath("/me");
  revalidatePath("/me/partner");
  revalidatePath("/me/partner/requests");
}

// ── Asking ───────────────────────────────────────────────────────────────────

export async function sendPartnerRequest(input: unknown): Promise<PartnerRequestResult> {
  const user = await requireRole("competitor");
  if (user.viewAs || !can(user, "partner.request")) return { ok: false, error: "FORBIDDEN" };

  const parsed = z.object({ seriesId: z.string().min(1), toUserId: z.string().min(1).max(191) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const toUserId = parsed.data.toUserId;
  const series = await resolveMySeries(user.id, parsed.data.seriesId);
  if (!series || series.status === "final") return { ok: false, error: "FORBIDDEN" };
  const seriesId = series.id;
  if (toUserId === user.id) return { ok: false, error: "INVALID_INPUT" };

  // Two axes: one person cannot spray, and one popular athlete cannot be
  // buried by many senders.
  if (!checkRate(`partner-ask:from:${user.id}`, 10, 15 * MINUTE_MS).ok) {
    return { ok: false, error: "TRY_LATER" };
  }
  if (!checkRate(`partner-ask:to:${toUserId}`, 20, 15 * MINUTE_MS).ok) {
    return { ok: false, error: "TRY_LATER" };
  }

  const mine = await prisma.seriesParticipant.findUnique({
    where: { seriesId_userId: { seriesId, userId: user.id } },
    select: { division: true, category: true, partnerUserId: true },
  });
  if (!mine || !mine.division || !mine.category) return { ok: false, error: "PROFILE_INCOMPLETE" };
  if (mine.partnerUserId) return { ok: false, error: "ALREADY_LINKED" };

  const me = { id: user.id, seriesId, division: mine.division, category: mine.category };

  const pending = await prisma.partnerRequest.count({
    where: { seriesId, fromUserId: user.id, status: "pending" },
  });
  if (pending >= MAX_PENDING) return { ok: false, error: "TOO_MANY_PENDING" };

  // They said no once. They may still ask me — but I do not get to ask again.
  const refused = await prisma.partnerRequest.findFirst({
    where: { seriesId, fromUserId: user.id, toUserId, status: "declined" },
    select: { id: true },
  });
  if (refused) return { ok: false, error: "DECLINED_BEFORE" };

  // The candidate rules are re-checked here for this one id, so an id learned
  // anywhere else is worth nothing: you may only ask somebody who is looking,
  // unlinked, approved, active, and in your own bracket.
  if (!(await partnerCandidateExists({ me, toUserId }))) return { ok: false, error: "NOT_FOUND" };

  const theirs = await prisma.seriesParticipant.findUnique({
    where: { seriesId_userId: { seriesId, userId: toUserId } },
    select: { division: true, category: true, user: { select: { email: true, name: true } } },
  });
  if (!theirs) return { ok: false, error: "NOT_FOUND" };

  const key = pairKeyOf(user.id, toUserId);
  try {
    await prisma.partnerRequest.create({
      data: {
        seriesId,
        fromUserId: user.id,
        toUserId,
        pairKey: key,
        openPairKey: key,
        division: mine.division,
        category: mine.category,
        toDivision: theirs.division,
        toCategory: theirs.category,
      },
    });
  } catch {
    // The unique index on openPairKey is the "one open request per pair" rule.
    // Which way round it is decides what the sender is told.
    const open = await prisma.partnerRequest.findFirst({
      where: { seriesId, openPairKey: key },
      select: { fromUserId: true },
    });
    if (!open) return { ok: false, error: "FAILED" };
    return { ok: false, error: open.fromUserId === user.id ? "ALREADY_REQUESTED" : "THEY_ASKED_YOU" };
  }

  try {
    await sendPartnerRequestEmail({
      email: theirs.user.email,
      fromName: user.name ?? "",
      division: mine.division,
      category: mine.category,
      url: `${getBaseUrl()}${meHref(seriesId, "/partner/requests")}`,
    });
  } catch {
    // The request stands whether or not the email went out.
  }

  await recordAudit({
    actorId: user.id,
    action: AUDIT.partnerRequestSent,
    targetType: "user",
    targetId: toUserId,
    targetLabel: theirs.user.email,
  });

  revalidate();
  return { ok: true };
}

// ── Answering ────────────────────────────────────────────────────────────────

export async function acceptPartnerRequest(input: unknown): Promise<PartnerRequestResult> {
  const user = await requireRole("competitor");
  if (user.viewAs || !can(user, "partner.edit")) return { ok: false, error: "FORBIDDEN" };

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const series = await resolveMySeries(user.id, parsed.data.seriesId);
  if (!series || series.status === "final") return { ok: false, error: "FORBIDDEN" };
  const seriesId = series.id;
  if (!checkRate(`partner-answer:${user.id}`, 30, MINUTE_MS).ok) {
    return { ok: false, error: "TRY_LATER" };
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Series WHERE id = ${seriesId} FOR UPDATE`;
      const request = await tx.partnerRequest.findFirst({
        where: { seriesId, id: parsed.data.requestId, toUserId: user.id },
        select: { id: true, fromUserId: true, toUserId: true },
      });
      if (!request) throw new Error("NOT_FOUND");

      const entries = await tx.seriesParticipant.findMany({
        where: { seriesId, userId: { in: [request.fromUserId, request.toUserId] }, archivedAt: null },
        include: { user: { select: { status: true, archivedAt: true, approvalStatus: true } } },
      });
      if (entries.length !== 2 || entries.some(p => p.user.status !== "active" || p.user.archivedAt || p.user.approvalStatus !== "approved")) throw new Error("NOT_FOUND");
      if (!entries[0].division || !entries[0].category || entries.some(p => p.division !== entries[0].division || p.category !== entries[0].category)) throw new Error("PROFILE_INCOMPLETE");
      if (await alreadyEntered({ seriesId, userIds: [request.fromUserId, request.toUserId] }, tx)) throw new Error("ALREADY_LINKED");

      // Whoever answers first decides; a second answer finds nothing pending.
      const claimed = await tx.partnerRequest.updateMany({
        where: { id: request.id, status: "pending" },
        data: { status: "accepted", openPairKey: null, respondedAt: now },
      });
      if (claimed.count === 0) throw new Error("ALREADY_DECIDED");

      // THE RACE GUARD. Both sides must still be unpartnered at this instant.
      // Two people accepting different requests at once both get past the read
      // above; only one gets past these, because they are conditional writes.
      const pair = [request.fromUserId, request.toUserId];
      for (const [self, other] of [
        [request.fromUserId, request.toUserId],
        [request.toUserId, request.fromUserId],
      ]) {
        const locked = await tx.seriesParticipant.updateMany({
          where: { seriesId, userId: self, archivedAt: null, partnerUserId: null },
          data: { partnerUserId: other },
        });
        if (locked.count === 0) throw new Error("ALREADY_LINKED");
      }

      await linkPair(request.fromUserId, request.toUserId, seriesId, tx);

      // Every other open ask either of them had is moot now.
      await tx.partnerRequest.updateMany({
        where: {
          seriesId,
          status: "pending",
          id: { not: request.id },
          OR: [{ fromUserId: { in: pair } }, { toUserId: { in: pair } }],
        },
        data: { status: "cancelled", openPairKey: null, respondedAt: now },
      });

      await recordAudit({
        actorId: user.id,
        action: AUDIT.partnerRequestAccepted,
        targetType: "user",
        targetId: request.fromUserId,
        targetLabel: user.email,
      });
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PROFILE_INCOMPLETE" || code === "NOT_FOUND" || code === "ALREADY_DECIDED" || code === "ALREADY_LINKED") {
      return { ok: false, error: code };
    }
    console.error("[PARTNER:accept]", code || error);
    return { ok: false, error: "FAILED" };
  }

  // Becoming a pair may be the last thing that was missing. If both of them are
  // approved and both chose the same competition, this is what enters them —
  // the other end of the same bridge approval uses (enter-pair.ts).
  //
  // OUTSIDE the transaction, and best-effort: accepting a partner request has
  // already succeeded and must not be undone because an entry could not be
  // made. It is a no-op in every case but the complete one.
  await enterPairIfReady(user.id, seriesId).catch((error: unknown) => {
    console.error("[PARTNER:accept:enter]", error);
  });

  revalidate();
  revalidatePath("/studio/people");
  revalidateCompetitionViews();
  return { ok: true };
}

export async function declinePartnerRequest(input: unknown): Promise<PartnerRequestResult> {
  const user = await requireRole("competitor");
  if (user.viewAs || !can(user, "partner.edit")) return { ok: false, error: "FORBIDDEN" };

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const series = await resolveMySeries(user.id, parsed.data.seriesId);
  if (!series || series.status === "final") return { ok: false, error: "FORBIDDEN" };
  const seriesId = series.id;

  // `toUserId: user.id` IS the authorisation, checked by the same statement
  // that writes — only the person asked can say no.
  const done = await prisma.partnerRequest.updateMany({
    where: { seriesId, id: parsed.data.requestId, toUserId: user.id, status: "pending" },
    data: { status: "declined", openPairKey: null, respondedAt: new Date() },
  });
  if (done.count === 0) return { ok: false, error: "ALREADY_DECIDED" };

  await recordAudit({
    actorId: user.id,
    action: AUDIT.partnerRequestDeclined,
    targetType: "user",
    targetId: user.id,
    targetLabel: user.email,
  });

  revalidate();
  return { ok: true };
}

export async function withdrawPartnerRequest(input: unknown): Promise<PartnerRequestResult> {
  const user = await requireRole("competitor");
  if (user.viewAs || !can(user, "partner.edit")) return { ok: false, error: "FORBIDDEN" };

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const series = await resolveMySeries(user.id, parsed.data.seriesId);
  if (!series || series.status === "final") return { ok: false, error: "FORBIDDEN" };
  const seriesId = series.id;

  const done = await prisma.partnerRequest.updateMany({
    where: { seriesId, id: parsed.data.requestId, fromUserId: user.id, status: "pending" },
    data: { status: "withdrawn", openPairKey: null, respondedAt: new Date() },
  });
  if (done.count === 0) return { ok: false, error: "ALREADY_DECIDED" };

  await recordAudit({
    actorId: user.id,
    action: AUDIT.partnerRequestWithdrawn,
    targetType: "user",
    targetId: user.id,
    targetLabel: user.email,
  });

  revalidate();
  return { ok: true };
}
