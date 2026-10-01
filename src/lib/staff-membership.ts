import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can, isBft, isStudio, teamScope, type CurrentUser } from "@/lib/access";
import { forgetAddressProof, PROOF_TX } from "@/lib/auth-proof";
import { AUDIT, recordAuditIn } from "@/lib/audit";
import { syncAfterMembershipChange } from "@/lib/membership-sync";
import { findEntryInSeries } from "@/lib/one-entry";
import { membershipBarrier, registrantSeat, teamChangeWindow } from "@/lib/ownership";
import { ensureParticipation } from "@/lib/participation";
import { normalizeName } from "@/lib/scoring";
import { putPersonInSeat } from "@/lib/seat-identity";
import { registrationOpen } from "@/lib/visibility";

// ─────────────────────────────────────────────────────────────────────────────
// STAFF AND GYMS CHANGING A TEAM — the same discipline as the athlete's own
// changes (membership-change.ts):
//
//   · everything is decided INSIDE one transaction, AFTER the competition
//     lock, on the team as re-read there — the scope, the window, the
//     registration deadline, the floor's barriers, the registrant rules;
//   · the page's membership version, when it sends one, must still be the
//     team's (STALE_MEMBERSHIP otherwise); every membership change bumps it;
//   · the audit line is written in the same transaction — no line, no change.
//
// WHEN (decision D3a): until 24 hours before the competition, whoever holds
// the permission may; from then on, only BFT MENA Full access
// (\`registrations.changeAfterClose\`, never grantable) — not a gym, not BFT
// MENA Partial access, whatever roles they hold. The floor's barriers (a
// finished competition, a score, a started wave) stop Full access too, for
// any change of WHO is on the team.
//
// WHAT counts as a change of who is on the team: a new seat, or a seat's
// EMAIL changing — the email is who the seat is (seat-identity.ts), with or
// without a new name, in one request or two. Those go through the same
// protections as a swap: the barriers, the duplicate check by email and by
// account, a seat cleared of the previous person, the links re-synced, the
// version moved. A NAME, phone or date of birth on its own is a correction.
// A seat somebody has signed in to keeps its email (LINKED_SEAT_EMAIL): the
// person's address is their account's, and giving the seat to somebody else
// is a swap. No account's email is ever changed to move a seat.
//
// BFT MENA FULL ACCESS CORRECTS: for them an email on this form is the SAME
// athlete's address put right — the seat, its account link, signature,
// check-in and details stay, and no barrier applies, because nobody new is on
// the team (somebody new is still a Swap). On a signed-in seat the account's
// own email follows, as Users would change it: on a tick that says so
// (CONFIRM_ACCOUNT_EMAIL), never onto another account's address, never the
// actor's own, every open code and link spent. A name on a signed-in seat is
// the account's name, so Full access corrects that too.
//
// What the form showed is what a change is measured against: a signed-in
// seat reads as its account (queries.ts › toRosterRow), so an account whose
// email or name differs from the seat's is not a change nobody typed.
// ─────────────────────────────────────────────────────────────────────────────

export type StaffActor = Pick<CurrentUser, "id" | "role" | "studioId" | "permissions">;

export type StaffError =
  | "NOT_FOUND" | "SERIES_FINISHED" | "TEAM_ALREADY_SCORED" | "WAVE_STARTED" | "REGISTRATION_CLOSED" | "TEAM_EDIT_CLOSED"
  | "STALE_MEMBERSHIP" | "REGISTRANT_SEAT" | "TRANSFER_REQUIRED" | "REGISTRANT_EMAIL_LOCKED"
  | "SAME_ATHLETE" | "ATHLETE_NOT_FOUND" | "ALREADY_ENTERED" | "EMAIL_INVALID"
  | "LINKED_SEAT_EMAIL" | "DIVISION_LOCKED" | "INVALID_INPUT"
  | "CONFIRM_ACCOUNT_EMAIL" | "ACCOUNT_EMAIL_TAKEN" | "OWN_ACCOUNT";

class Refused extends Error {
  constructor(readonly code: StaffError) {
    super(code);
  }
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

/** BFT MENA Full access — the only one who changes a team after the cutoff. */
export const hasFullAccess = (actor: StaffActor) => can(actor, "registrations.changeAfterClose");

async function lockSeriesOf(tx: Prisma.TransactionClient, seriesId: string) {
  await tx.$queryRaw`SELECT id FROM Series WHERE id = ${seriesId} FOR UPDATE`;
}

async function assertNotEntered(tx: Prisma.TransactionClient, seriesId: string, email: string | null, userId: string | null, exceptCompetitorId: string | null) {
  const account = email ? await tx.user.findUnique({ where: { email }, select: { id: true } }) : null;
  const entry = await findEntryInSeries({ seriesId, emails: [email], userIds: [userId, account?.id], ...(exceptCompetitorId ? { exceptCompetitorId } : {}) }, tx);
  if (entry) throw new Refused("ALREADY_ENTERED");
}

function barrierOrThrow(team: { archivedAt: Date | null; waveId: string | null; waveRef: { status: string } | null; score: { id: string } | null; series: { status: string; archivedAt: Date | null } }) {
  const barrier = membershipBarrier({
    archivedAt: team.archivedAt, waveId: team.waveId, waveStatus: team.waveRef?.status ?? null,
    scored: Boolean(team.score), seriesStatus: team.series.status, seriesArchived: Boolean(team.series.archivedAt),
  });
  if (!barrier.open) throw new Refused(barrier.reason);
}

function run<T>(work: () => Promise<T>): Promise<T | { ok: false; error: StaffError }> {
  return work().catch((error) => {
    if (error instanceof Refused) return { ok: false as const, error: error.code };
    if (error instanceof Error && error.message === "ATHLETE_NOT_FOUND") return { ok: false as const, error: "ATHLETE_NOT_FOUND" as const };
    throw error;
  });
}

// ── swap ─────────────────────────────────────────────────────────────────────

export type SwapInput = {
  competitorId: string;
  replacementUserId?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  transferOwnership?: boolean;
  /** The team's membership version the page was showing, when it sends one. */
  expectedVersion?: number;
};

export type SwapOutcome = { ok: true; message: string; changed: boolean } | { ok: false; error: StaffError };

export async function swapSeat(db: PrismaClient, actor: StaffActor, input: SwapInput, now = new Date()): Promise<SwapOutcome> {
  if (!input.replacementUserId && !input.fullName?.trim()) return { ok: false, error: "INVALID_INPUT" };
  const scope = teamScope(actor);
  const where = { id: input.competitorId, team: { archivedAt: null, ...scope } };
  const located = await db.competitor.findFirst({ where, select: { team: { select: { seriesId: true } } } });
  if (!located) return { ok: false, error: "NOT_FOUND" };

  return run(() =>
    db.$transaction(async (tx): Promise<SwapOutcome> => {
      await lockSeriesOf(tx, located.team.seriesId);
      const seat = await tx.competitor.findFirst({
        where,
        select: {
          id: true, position: true, fullName: true, email: true, userId: true,
          team: {
            select: {
              id: true, seriesId: true, number: true, name: true, archivedAt: true, waveId: true, membershipVersion: true,
              ownership: true, registrantEmail: true, registrantUserId: true,
              waveRef: { select: { status: true } }, score: { select: { id: true } },
              series: { select: { status: true, archivedAt: true, registrationClosesAt: true, competitionDate: true } },
              competitors: { select: { id: true, userId: true, email: true } },
            },
          },
        },
      });
      if (!seat) throw new Refused("NOT_FOUND");
      const team = seat.team;
      barrierOrThrow(team);
      if (!teamChangeWindow(team.series.competitionDate, now, hasFullAccess(actor)).open) throw new Refused("TEAM_EDIT_CLOSED");
      const deadline = registrationOpen({ role: actor.role, registrationClosesAt: team.series.registrationClosesAt, now });
      if (!deadline.open) throw new Refused("REGISTRATION_CLOSED");
      if (input.expectedVersion !== undefined && input.expectedVersion !== team.membershipVersion) throw new Refused("STALE_MEMBERSHIP");

      const onRegistrantSeat = registrantSeat(team)?.id === seat.id;
      if (onRegistrantSeat && !isBft(actor)) throw new Refused("REGISTRANT_SEAT");
      if (onRegistrantSeat && !input.transferOwnership) throw new Refused("TRANSFER_REQUIRED");
      const otherUserId = team.competitors.find((one) => one.id !== seat.id)?.userId ?? null;

      let replacement: { userId: string | null; fullName: string; email: string | null; phone: string | null; dateOfBirth: Date | null; shirtSize: string | null; bftMember: boolean; studioId: string | null };
      if (input.replacementUserId) {
        if (input.replacementUserId === seat.userId) return { ok: true, message: "No change.", changed: false };
        if (input.replacementUserId === otherUserId) throw new Refused("SAME_ATHLETE");
        const account = await tx.user.findFirst({
          where: {
            id: input.replacementUserId, role: "competitor", approvalStatus: "approved", archivedAt: null, status: { not: "disabled" },
            // A gym brings in its own athlete; BFT MENA may bring in anyone.
            ...(isStudio(actor) && actor.studioId ? { studioId: actor.studioId } : {}),
          },
          select: { id: true, name: true, email: true, phone: true, studioId: true, athleteProfile: { select: { dateOfBirth: true } } },
        });
        if (!account) throw new Refused("ATHLETE_NOT_FOUND");
        await assertNotEntered(tx, team.seriesId, clean(account.email), account.id, seat.id);
        const entry = await ensureParticipation(account.id, team.seriesId, tx);
        replacement = {
          userId: account.id, fullName: account.name ?? account.email, email: clean(account.email), phone: account.phone,
          dateOfBirth: account.athleteProfile?.dateOfBirth ?? null, shirtSize: entry.shirtSize, bftMember: entry.bftMember, studioId: account.studioId,
        };
      } else {
        const email = input.email?.trim() ? clean(input.email) : null;
        if (email && !EMAIL.test(email)) throw new Refused("EMAIL_INVALID");
        await assertNotEntered(tx, team.seriesId, email, null, seat.id);
        // A typed-in substitute takes the seat as a name on the roster; their
        // seat becomes their account's the first time they prove that email.
        replacement = {
          userId: null, fullName: input.fullName!.trim(), email, phone: input.phone?.trim() || null,
          dateOfBirth: null, shirtSize: null, bftMember: false, studioId: isStudio(actor) ? actor.studioId ?? null : null,
        };
      }

      await putPersonInSeat(tx, seat.id, replacement);
      await syncAfterMembershipChange(tx, { teamId: team.id, seriesId: team.seriesId, departedUserIds: [seat.userId !== replacement.userId ? seat.userId : null] });

      const label = `${team.number} ${team.name}`;
      const version = team.membershipVersion + 1;
      await tx.team.update({
        where: { id: team.id },
        data: {
          membershipVersion: { increment: 1 },
          groupPortraitPath: null,
          ...(onRegistrantSeat
            ? replacement.email
              ? { ownership: "registrant", registrantEmail: replacement.email, registrantUserId: replacement.userId }
              : { ownership: "unknown", registrantEmail: null, registrantUserId: null }
            : {}),
        },
      });
      await recordAuditIn(tx, {
        actorId: actor.id, action: AUDIT.teamMemberSwapped, targetType: "team", targetId: team.id, targetLabel: label,
        detail: `position ${seat.position}: ${seat.fullName} → ${replacement.fullName} · version ${team.membershipVersion} → ${version}`,
      });
      if (onRegistrantSeat) {
        await recordAuditIn(tx, {
          actorId: actor.id, action: AUDIT.teamOwnershipChanged, targetType: "team", targetId: team.id, targetLabel: label,
          detail: `registrant ${team.registrantEmail ?? "—"} → ${replacement.email ?? "unknown (no email)"} (swap)`,
        });
      }
      return { ok: true, message: `${replacement.fullName} now stands on team ${team.number}.`, changed: true };
    }, PROOF_TX)
  );
}

// ── correcting a registration ────────────────────────────────────────────────

/**
 * Full access puts the SAME athlete's address right. Not already entered
 * elsewhere in this competition; on a signed-in seat, the account's email
 * too — on the confirming tick, never another account's address, never the
 * actor's own — with every open code and link spent, as in Users. Returns the
 * audit line.
 */
async function correctEmail(
  tx: Prisma.TransactionClient,
  actor: StaffActor,
  { seriesId, target, email, confirmed }: {
    seriesId: string;
    target: { id: string; position: number; email: string | null; userId: string | null; user: { email: string } | null };
    email: string | null;
    confirmed: boolean;
  }
): Promise<string> {
  const before = target.user?.email ?? target.email;
  await assertNotEntered(tx, seriesId, email, target.userId, target.id);
  if (target.userId && target.user) {
    if (!email) throw new Refused("EMAIL_INVALID");
    if (target.userId === actor.id) throw new Refused("OWN_ACCOUNT");
    if (!confirmed) throw new Refused("CONFIRM_ACCOUNT_EMAIL");
    const other = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (other && other.id !== target.userId) throw new Refused("ACCOUNT_EMAIL_TAKEN");
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${target.userId} FOR UPDATE`;
    await tx.user.update({ where: { id: target.userId }, data: { email } });
    await forgetAddressProof(tx, target.userId);
    await recordAuditIn(tx, {
      actorId: actor.id, action: AUDIT.accountUpdated, targetType: "user", targetId: target.userId, targetLabel: email,
      detail: `email ${before} → ${email} (corrected on the team's registration)`,
    });
  }
  return `position ${target.position}: email ${before ?? "—"} → ${email ?? "—"} (corrected, same athlete)`;
}

export type EditPerson = { id?: string; fullName: string; email: string | null; phone: string | null; dateOfBirth: Date | null; studioId: string | null };
export type EditInput = {
  teamId: string;
  teamName: string;
  category: "Womens" | "Mens" | "Mixed";
  division: "Rookie" | "Open" | "Pro";
  one: EditPerson;
  two?: EditPerson;
  expectedVersion?: number;
  /** Full access confirmed that a signed-in athlete's sign-in email changes. */
  confirmAccountEmail?: boolean;
};

export type EditOutcome = { ok: true } | { ok: false; error: StaffError };

const sameDay = (a: Date | null, b: Date | null) => (a ? a.toISOString().slice(0, 10) : null) === (b ? b.toISOString().slice(0, 10) : null);

export async function editRegistration(db: PrismaClient, actor: StaffActor, input: EditInput, now = new Date()): Promise<EditOutcome> {
  const scope = teamScope(actor);
  const located = await db.team.findFirst({ where: { id: input.teamId, ...scope }, select: { seriesId: true } });
  if (!located) return { ok: false, error: "NOT_FOUND" };

  return run(() =>
    db.$transaction(async (tx): Promise<EditOutcome> => {
      await lockSeriesOf(tx, located.seriesId);
      const team = await tx.team.findFirst({
        where: { id: input.teamId, ...scope },
        select: {
          id: true, seriesId: true, number: true, name: true, category: true, division: true, archivedAt: true, waveId: true, membershipVersion: true,
          ownership: true, registrantEmail: true, registrantUserId: true,
          waveRef: { select: { status: true } }, score: { select: { id: true } },
          series: { select: { status: true, archivedAt: true, registrationClosesAt: true, competitionDate: true } },
          competitors: { orderBy: { position: "asc" }, select: { id: true, position: true, email: true, userId: true, fullName: true, phone: true, dateOfBirth: true, studioId: true, user: { select: { email: true, name: true } } } },
        },
      });
      if (!team) throw new Refused("NOT_FOUND");
      // Any change to a team, correction or not, closes at the cutoff for
      // everybody but Full access (D3a).
      if (!teamChangeWindow(team.series.competitionDate, now, hasFullAccess(actor)).open) throw new Refused("TEAM_EDIT_CLOSED");
      const deadline = registrationOpen({ role: actor.role, registrationClosesAt: team.series.registrationClosesAt, now });
      if (!deadline.open) throw new Refused("REGISTRATION_CLOSED");
      if (!isBft(actor) && input.division !== team.division) throw new Refused("DIVISION_LOCKED");
      if (input.expectedVersion !== undefined && input.expectedVersion !== team.membershipVersion) throw new Refused("STALE_MEMBERSHIP");

      // Which seat each person is: by id when the form sends them (a person
      // without one is a NEW seat); by position order for an older form.
      const people = [input.one, input.two].filter((person): person is EditPerson => Boolean(person));
      const seats = team.competitors;
      const byId = people.some((person) => person.id);
      const targets = people.map((person, index) => (byId ? (person.id ? seats.find((seat) => seat.id === person.id) ?? "unknown" : null) : seats[index] ?? null));
      if (targets.includes("unknown")) throw new Refused("INVALID_INPUT");
      const held = targets.filter((target): target is (typeof seats)[number] => Boolean(target) && target !== "unknown");
      if (new Set(held.map((seat) => seat.id)).size !== held.length) throw new Refused("INVALID_INPUT");
      if (seats.length + targets.filter((target) => target === null).length > 2) throw new Refused("INVALID_INPUT");
      for (const person of people) {
        if (person.email && !EMAIL.test(clean(person.email))) throw new Refused("EMAIL_INVALID");
      }

      // Measured against what the form showed: a signed-in seat reads as its account.
      const full = hasFullAccess(actor);
      const emailChanged = targets.map((target, index) => Boolean(target) && target !== "unknown" && clean(target!.user?.email ?? target!.email) !== clean(people[index].email));
      // Does this touch WHO is on the team? A new seat — or, for anybody but
      // Full access (who corrects the same athlete's address), a seat's email.
      const newPerson = targets.map((target, index) => target === null || (!full && emailChanged[index]));
      if (newPerson.some(Boolean)) barrierOrThrow(team);

      const registrant = registrantSeat(team);
      let registrantEmailAfter: string | null | undefined;
      /** Full access corrected the registrant's address: the same person, still the registrant. */
      let registrantCorrected: string | null | undefined;
      const lines: string[] = [];
      const taken = new Set(seats.map((seat) => seat.position));

      for (const [index, person] of people.entries()) {
        const email = person.email ? clean(person.email) : null;
        const target = targets[index];
        if (target && target !== "unknown") {
          if (newPerson[index]) {
            // A seat somebody signed in to keeps its email: that is their account's.
            if (target.userId) throw new Refused("LINKED_SEAT_EMAIL");
            await assertNotEntered(tx, team.seriesId, email, null, target.id);
            if (registrant?.id === target.id) {
              if (!isBft(actor)) throw new Refused("REGISTRANT_EMAIL_LOCKED");
              registrantEmailAfter = email;
            }
            // A different person: what the form carried over from the previous
            // one (phone, date of birth, studio unchanged) does not stay.
            await putPersonInSeat(tx, target.id, {
              fullName: person.fullName,
              email,
              phone: person.phone !== target.phone ? person.phone : null,
              dateOfBirth: !sameDay(person.dateOfBirth, target.dateOfBirth) ? person.dateOfBirth : null,
              studioId: person.studioId !== target.studioId ? person.studioId : null,
            });
            lines.push(`position ${target.position}: ${target.fullName} <${target.email ?? "—"}> → ${person.fullName.trim()} <${email ?? "—"}>`);
          } else {
            if (emailChanged[index]) {
              lines.push(await correctEmail(tx, actor, { seriesId: team.seriesId, target, email, confirmed: Boolean(input.confirmAccountEmail) }));
              if (registrant?.id === target.id) registrantCorrected = email;
            }
            await tx.competitor.update({
              where: { id: target.id },
              data: { fullName: person.fullName.trim(), normalizedName: normalizeName(person.fullName), phone: person.phone, dateOfBirth: person.dateOfBirth, studioId: person.studioId, ...(emailChanged[index] ? { email } : {}) },
            });
            const shownName = target.user?.name ?? target.fullName;
            if (normalizeName(shownName) !== normalizeName(person.fullName)) {
              // A signed-in seat shows its account's name: Full access corrects that name.
              if (full && target.userId && target.user) await tx.user.update({ where: { id: target.userId }, data: { name: person.fullName.trim() } });
              lines.push(`position ${target.position}: name ${shownName} → ${person.fullName.trim()}`);
            }
          }
        } else {
          await assertNotEntered(tx, team.seriesId, email, null, null);
          const position = [1, 2].find((free) => !taken.has(free))!;
          taken.add(position);
          await tx.competitor.create({ data: { teamId: team.id, position, fullName: person.fullName.trim(), normalizedName: normalizeName(person.fullName), email, phone: person.phone, dateOfBirth: person.dateOfBirth, studioId: person.studioId } });
          lines.push(`position ${position}: ${person.fullName.trim()} <${email ?? "—"}> added`);
        }
      }

      const membershipChanged = newPerson.some(Boolean);
      await tx.team.update({
        where: { id: team.id },
        data: {
          name: input.teamName.toUpperCase(),
          category: input.category,
          division: input.division,
          // Which studio owns the entry is what scopes it: only BFT MENA moves it.
          ...(isBft(actor) ? { studioId: input.one.studioId } : {}),
          ...(membershipChanged ? { membershipVersion: { increment: 1 }, groupPortraitPath: null } : {}),
          ...(registrantEmailAfter !== undefined
            ? registrantEmailAfter
              ? { registrantEmail: registrantEmailAfter, registrantUserId: null }
              : { ownership: "unknown" as const, registrantEmail: null, registrantUserId: null }
            : {}),
          // Corrected, not replaced: the registrant keeps their account link.
          ...(registrantCorrected !== undefined
            ? registrantCorrected
              ? { registrantEmail: registrantCorrected }
              : { ownership: "unknown" as const, registrantEmail: null, registrantUserId: null }
            : {}),
        },
      });
      // Names and emails feed the partner snapshots: bring them in step.
      await syncAfterMembershipChange(tx, { teamId: team.id, seriesId: team.seriesId, departedUserIds: [] });
      // A bracket corrected on this form is the same fact as one changed at
      // the athlete's request (bracket-change.ts): the members' own entries
      // follow it, and the audit line says from what to what.
      if (team.category !== input.category || team.division !== input.division) {
        // A seat given to somebody new on this form never had an account (LINKED_SEAT_EMAIL).
        const members = team.competitors.map((seat) => seat.userId).filter((id): id is string => Boolean(id));
        if (members.length) await tx.seriesParticipant.updateMany({ where: { seriesId: team.seriesId, userId: { in: members } }, data: { category: input.category, division: input.division } });
        if (team.category !== input.category) lines.push(`category ${team.category} → ${input.category}`);
        if (team.division !== input.division) lines.push(`level ${team.division} → ${input.division}`);
      }

      const label = `${team.number} ${input.teamName.toUpperCase()}`;
      await recordAuditIn(tx, {
        actorId: actor.id, action: AUDIT.registrationUpdated, targetType: "team", targetId: team.id, targetLabel: label,
        detail: [team.name === input.teamName.toUpperCase() ? "details corrected" : `renamed from ${team.name}`, ...lines, ...(membershipChanged ? [`version ${team.membershipVersion} → ${team.membershipVersion + 1}`] : [])].join(" · "),
      });
      if (registrantEmailAfter !== undefined) {
        await recordAuditIn(tx, {
          actorId: actor.id, action: AUDIT.teamOwnershipChanged, targetType: "team", targetId: team.id, targetLabel: label,
          detail: `registrant ${registrant?.email ?? "—"} → ${registrantEmailAfter ?? "unknown (no email)"} (registration edited)`,
        });
      }
      return { ok: true };
    }, PROOF_TX)
  );
}
