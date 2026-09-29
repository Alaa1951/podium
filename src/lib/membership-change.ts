import crypto from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PROOF_TX } from "@/lib/auth-proof";
import { AUDIT, recordAuditIn } from "@/lib/audit";
import { syncAfterMembershipChange } from "@/lib/membership-sync";
import { findEntryInSeries } from "@/lib/one-entry";
import { crmPayerEmail, incompleteTeamPolicyEnabled, managingSeat, membershipDoor, membershipRights } from "@/lib/ownership";
import { normalizeName } from "@/lib/scoring";
import { putPersonInSeat } from "@/lib/seat-identity";

// ─────────────────────────────────────────────────────────────────────────────
// AN ATHLETE CHANGING WHO IS ON THEIR TEAM (plan v7 §5–§6, release R2b).
//
//   replace — the registrant puts somebody new in the OTHER seat: a new name
//             and email, the seat cleared of the old person's details.
//   fill    — the registrant adds a partner to their team's empty seat.
//   leave   — the other member takes themselves off the team.
//
// ONE ORDER, INSIDE ONE TRANSACTION, UNDER THE COMPETITION LOCK (the lock
// every team writer takes):
//   1. the operation id: the same request again gets its first answer back;
//      the same id with anything different is OPERATION_MISMATCH;
//   2. the team as it is NOW (re-read after the lock), and STALENESS first:
//      the page's membership version must still be the team's — a page that
//      shows an older team is told so, whatever else is true;
//   3. who may do what (ownership.ts: a registrant, found by identity — or,
//      while BFT MENA has not confirmed one, the automatic registrant, who
//      becomes the registrant with their first change; never one side of a
//      `joint` team), and the door (finished, scored, wave started, the
//      edit window);
//   4. for a replacement, the identity of the person being replaced must be
//      what the page showed;
//   5. the input (name, a valid email, not yourself, not already entered);
//   6. the change, the derived links (membership-sync.ts), the version bump,
//      the operation record and the AUDIT LINE — all or nothing: a failed
//      audit write undoes the change.
//
// Nobody's account, password or payments are touched. The newcomer is not
// linked here: their seat carries their email, and it becomes theirs the
// first time they prove that address (a code sign-in; link-seats.ts). The
// person who left keeps their account and their entry history; nothing will
// link them back (their seat is gone or carries someone else's email, and
// their partner email is cleared).
// ─────────────────────────────────────────────────────────────────────────────

export type MembershipActor = { id: string; email: string };

export type MembershipInput =
  | { kind: "replace"; operationId: string; teamId: string; expectedVersion: number; targetSeatId: string; expected: { userId: string | null; email: string | null }; fullName: string; email: string }
  | { kind: "fill"; operationId: string; teamId: string; expectedVersion: number; fullName: string; email: string }
  | { kind: "leave"; operationId: string; teamId: string; expectedVersion: number; mySeatId: string };

export type MembershipError =
  | "NOT_FOUND" | "NOT_ON_TEAM" | "OWNERSHIP_UNKNOWN" | "JOINT_TEAM" | "REGISTRANT_UNRESOLVED" | "NOT_ALLOWED"
  | "SERIES_FINISHED" | "TEAM_ALREADY_SCORED" | "WAVE_STARTED" | "TEAM_EDIT_CLOSED"
  | "STALE_MEMBERSHIP" | "OPERATION_MISMATCH" | "LEAVE_NOT_AVAILABLE"
  | "NAME_REQUIRED" | "EMAIL_INVALID" | "PARTNER_IS_YOU" | "ALREADY_ENTERED";

/** Somebody to tell, once the change has committed. */
export type MembershipNotice =
  | { kind: "removed"; to: string; teamName: string; teamNumber: number }
  | { kind: "added"; to: string; teamName: string; teamNumber: number; byName: string }
  | { kind: "left"; to: string; teamName: string; teamNumber: number; leaverName: string };

export type MembershipOutcome =
  | { ok: true; code: "REPLACED" | "FILLED" | "LEFT" | "NO_CHANGE"; version: number; replayed: boolean; notices: MembershipNotice[] }
  | { ok: false; error: MembershipError };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

/** SHA-256 of the request minus its id: what "the same request" means. */
export function membershipInputHash(input: MembershipInput): string {
  const rest = input;
  const canonical =
    rest.kind === "leave"
      ? { kind: rest.kind, teamId: rest.teamId, expectedVersion: rest.expectedVersion, mySeatId: rest.mySeatId }
      : rest.kind === "fill"
        ? { kind: rest.kind, teamId: rest.teamId, expectedVersion: rest.expectedVersion, fullName: rest.fullName.trim(), email: clean(rest.email) }
        : { kind: rest.kind, teamId: rest.teamId, expectedVersion: rest.expectedVersion, targetSeatId: rest.targetSeatId, expected: { userId: rest.expected.userId, email: clean(rest.expected.email) || null }, fullName: rest.fullName.trim(), email: clean(rest.email) };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

class Refused extends Error {
  constructor(readonly code: MembershipError) {
    super(code);
  }
}

export async function changeMembership(
  db: PrismaClient,
  actor: MembershipActor,
  input: MembershipInput,
  options: { now?: Date; env?: NodeJS.ProcessEnv } = {}
): Promise<MembershipOutcome> {
  const now = options.now ?? new Date();
  const inputHash = membershipInputHash(input);
  const found = await db.team.findUnique({ where: { id: input.teamId }, select: { seriesId: true } });
  if (!found) return { ok: false, error: "NOT_FOUND" };

  const run = () => db.$transaction((tx) => apply(tx, found.seriesId), PROOF_TX);

  async function replay(tx: Prisma.TransactionClient, seriesId: string): Promise<MembershipOutcome | null> {
    const previous = await tx.membershipOperation.findUnique({ where: { operationId: input.operationId } });
    if (!previous) return null;
    const same = previous.actorId === actor.id && previous.kind === input.kind && previous.seriesId === seriesId && previous.teamId === input.teamId && previous.inputHash === inputHash;
    if (!same) return { ok: false, error: "OPERATION_MISMATCH" };
    return { ok: true, code: previous.resultCode as "REPLACED" | "FILLED" | "LEFT" | "NO_CHANGE", version: previous.versionAfter ?? 0, replayed: true, notices: [] };
  }

  async function apply(tx: Prisma.TransactionClient, seriesId: string): Promise<MembershipOutcome> {
    await tx.$queryRaw`SELECT id FROM Series WHERE id = ${seriesId} FOR UPDATE`;
    const earlier = await replay(tx, seriesId);
    if (earlier) return earlier;

    const row = await tx.team.findUnique({
      where: { id: input.teamId },
      select: {
        id: true, seriesId: true, number: true, name: true, archivedAt: true, waveId: true,
        ownership: true, registrantEmail: true, registrantUserId: true, membershipVersion: true,
        source: true, rawPayload: true,
        waveRef: { select: { status: true } },
        score: { select: { id: true } },
        series: { select: { status: true, archivedAt: true, competitionDate: true } },
        competitors: { orderBy: { position: "asc" }, select: { id: true, position: true, userId: true, email: true, fullName: true } },
      },
    });
    if (!row || row.seriesId !== seriesId) throw new Refused("NOT_FOUND");
    const team = { ...row, payerEmail: crmPayerEmail(row) };

    // A page that no longer shows the team as it is gets one answer — "your
    // team changed, reload" — before any rule is applied to what it showed:
    // the partner it offers to replace may have left, or the person asking
    // may have just been replaced. The reload then shows the truth.
    if (team.membershipVersion !== input.expectedVersion) throw new Refused("STALE_MEMBERSHIP");
    const rights = membershipRights(team, actor.id);
    if (rights.reason) throw new Refused(rights.reason);
    const door = membershipDoor({
      archivedAt: team.archivedAt, waveId: team.waveId, waveStatus: team.waveRef?.status ?? null, scored: Boolean(team.score),
      seriesStatus: team.series.status, seriesArchived: Boolean(team.series.archivedAt),
      competitionDate: team.series.competitionDate,
    }, now); // an athlete is never Full access: the 24-hour cutoff closes it (D3a)
    if (!door.open) throw new Refused(door.reason);

    const label = `${team.number} ${team.name}`;
    const me = team.competitors.find((seat) => seat.id === rights.mySeatId)!;
    const notices: MembershipNotice[] = [];
    let departed: (string | null)[] = [];
    let code: "REPLACED" | "FILLED" | "LEFT" | "NO_CHANGE";
    let detail: string;
    let action: (typeof AUDIT)[keyof typeof AUDIT];

    if (input.kind === "leave") {
      if (!rights.canLeave) throw new Refused("NOT_ALLOWED");
      if (input.mySeatId !== me.id) throw new Refused("STALE_MEMBERSHIP");
      // Leaving makes a team of one: not possible until what such a team may
      // do on the day is decided and switched on (decision D3b).
      if (!incompleteTeamPolicyEnabled(options.env)) throw new Refused("LEAVE_NOT_AVAILABLE");
      await tx.competitor.delete({ where: { id: me.id } }); // portraits and jobs cascade
      departed = [actor.id];
      code = "LEFT";
      action = AUDIT.teamMemberLeft;
      detail = `${me.fullName} <${me.email ?? "no email"}> left (position ${me.position})`;
      const registrant = managingSeat(team);
      if (registrant?.email) notices.push({ kind: "left", to: registrant.email, teamName: team.name, teamNumber: team.number, leaverName: me.fullName });
    } else {
      const fullName = input.fullName.trim();
      const email = clean(input.email);
      if (fullName.length < 2 || fullName.length > 120) throw new Refused("NAME_REQUIRED");
      if (!EMAIL.test(email) || email.length > 200) throw new Refused("EMAIL_INVALID");
      if (email === clean(actor.email) || email === clean(me.email)) throw new Refused("PARTNER_IS_YOU");

      if (input.kind === "replace") {
        const target = team.competitors.find((seat) => seat.id === input.targetSeatId);
        if (!target || rights.canReplace !== target.id) throw new Refused("NOT_ALLOWED");
        // The person on the page must still be the person in the seat.
        if (target.userId !== input.expected.userId || (clean(target.email) || null) !== (clean(input.expected.email) || null)) throw new Refused("STALE_MEMBERSHIP");
        if (clean(target.email) === email && target.fullName.trim() === fullName) {
          code = "NO_CHANGE";
        } else {
          await assertNotEntered(tx, team.seriesId, email, target.id);
          // A different person: nothing of the previous one stays (seat-identity.ts).
          await putPersonInSeat(tx, target.id, { fullName, email });
          departed = [target.userId];
          code = "REPLACED";
        }
        action = AUDIT.teamPartnerReplaced;
        detail = `position ${target.position}: ${target.fullName} <${target.email ?? "no email"}> → ${fullName} <${email}>`;
        if (code === "REPLACED") {
          if (target.email) notices.push({ kind: "removed", to: target.email, teamName: team.name, teamNumber: team.number });
          notices.push({ kind: "added", to: email, teamName: team.name, teamNumber: team.number, byName: me.fullName });
        }
      } else {
        if (!rights.canFill) throw new Refused("NOT_ALLOWED");
        await assertNotEntered(tx, team.seriesId, email, null);
        const taken = new Set(team.competitors.map((seat) => seat.position));
        const position = [1, 2].find((free) => !taken.has(free))!;
        await tx.competitor.create({ data: { teamId: team.id, position, fullName, normalizedName: normalizeName(fullName), email } });
        code = "FILLED";
        action = AUDIT.teamPartnerAdded;
        detail = `position ${position}: ${fullName} <${email}> added`;
        notices.push({ kind: "added", to: email, teamName: team.name, teamNumber: team.number, byName: me.fullName });
      }
    }

    // The automatic registrant (not confirmed by BFT MENA) who changes the
    // team becomes its registrant: the partner they choose, once signed in,
    // must not take the team from them. BFT MENA can still change it.
    const claimed = code !== "NO_CHANGE" && rights.provisional && rights.role === "registrant" && input.kind !== "leave";
    const registrantEmail = clean(me.email) || clean(actor.email);

    let version = team.membershipVersion;
    if (code !== "NO_CHANGE") {
      await syncAfterMembershipChange(tx, { teamId: team.id, seriesId: team.seriesId, departedUserIds: departed });
      const updated = await tx.team.update({
        where: { id: team.id },
        // The pair's composite portrait shows somebody who may be gone.
        data: {
          membershipVersion: { increment: 1 }, groupPortraitPath: null,
          ...(claimed ? { ownership: "registrant" as const, registrantEmail, registrantUserId: actor.id } : {}),
        },
        select: { membershipVersion: true },
      });
      version = updated.membershipVersion;
    }
    if (claimed) {
      await recordAuditIn(tx, {
        actorId: actor.id, action: AUDIT.teamOwnershipChanged, targetType: "team", targetId: team.id, targetLabel: label,
        detail: `unknown → registrant ${registrantEmail} (automatic: ${team.payerEmail && clean(team.payerEmail) === registrantEmail ? "the CRM payer" : "the only member signed in"}, on their first change)`,
      });
    }

    await tx.membershipOperation.create({
      data: { operationId: input.operationId, actorId: actor.id, kind: input.kind, seriesId: team.seriesId, teamId: team.id, inputHash, resultCode: code, resultPayload: { version }, versionAfter: version },
    });
    if (code !== "NO_CHANGE") {
      await recordAuditIn(tx, { actorId: actor.id, action, targetType: "team", targetId: team.id, targetLabel: label, detail: `${detail} · version ${team.membershipVersion} → ${version}` });
    }
    return { ok: true, code, version, replayed: false, notices };
  }

  try {
    return await run();
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code };
    // Two copies of the SAME request at once: the second hits the unique
    // operation id — it gets the first one's answer.
    if (isUniqueViolation(error)) {
      try {
        const answer = await db.$transaction((tx) => replay(tx, found.seriesId), PROOF_TX);
        if (answer) return answer;
      } catch {
        /* fall through to the original error */
      }
    }
    throw error;
  }
}

async function assertNotEntered(tx: Prisma.TransactionClient, seriesId: string, email: string, exceptCompetitorId: string | null) {
  // By the address, and by the account that address belongs to (whose seat
  // may carry an older email): nobody competes twice in one competition.
  const account = await tx.user.findUnique({ where: { email }, select: { id: true } });
  const entry = await findEntryInSeries({ seriesId, emails: [email], userIds: [account?.id], ...(exceptCompetitorId ? { exceptCompetitorId } : {}) }, tx);
  if (entry) throw new Refused("ALREADY_ENTERED");
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "P2002" || /Unique constraint|Duplicate entry/i.test(error instanceof Error ? error.message : "");
}
