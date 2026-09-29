import { isCompeting } from "@/lib/team-status";

// ─────────────────────────────────────────────────────────────────────────────
// WHO REGISTERED A TEAM (plan v7 §4).
//
// The registrant is a PERSON — an email, and once they sign in an account —
// never a seat number. Position 1 is merely where a form put somebody: on
// CRM teams the payer sits at position 2 on some teams, and a pair formed by
// a request puts the acceptor first. So the registrant's seat is found at
// read time: the seat of `registrantUserId`, else the one seat carrying
// `registrantEmail`.
//
//   registrant — one person manages who is on the team.
//   joint      — two independent registrants, equal rights; nobody owns the
//                other's seat.
//   unknown    — BFT MENA has not confirmed it. Until they do, the team is
//                managed by an AUTOMATIC registrant (provisionalRegistrantSeat)
//                when one follows from the facts; BFT MENA can set it at any
//                time, and what they set wins.
//
// Pure functions only: safe on the server and in the browser.
// ─────────────────────────────────────────────────────────────────────────────

export type Ownership = "registrant" | "joint" | "unknown";

export type SeatRef = { id: string; userId: string | null; email: string | null };

export type OwnedTeam = {
  ownership: Ownership;
  registrantEmail: string | null;
  registrantUserId: string | null;
  /** The CRM payer's email (crmPayerEmail), when the team came from the CRM. */
  payerEmail?: string | null;
  competitors: SeatRef[];
};

const clean = (email: string | null | undefined) => (email ?? "").trim().toLowerCase() || null;

/** The payer's email on a CRM team: the contact the CRM sent with it. */
export function crmPayerEmail(team: { source: string; rawPayload: unknown }): string | null {
  if (team.source !== "ghl") return null;
  const raw = team.rawPayload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const email = (raw as Record<string, unknown>).email;
  return typeof email === "string" ? clean(email) : null;
}

/**
 * WHO MANAGES A TEAM BFT MENA HAS NOT CONFIRMED (`unknown`) — decided the same
 * way every time, from facts nobody on the team can fake:
 *
 *   1. the CRM payer, when the payer's email is on exactly one seat (the
 *      rule the CRM sync and the backfill use: ownershipFromContact);
 *   2. otherwise the ONE member who has signed in, while the other seat has
 *      nobody signed in (or there is no other seat).
 *
 * Nobody when both have signed in and the CRM does not say who paid: that is
 * BFT MENA's to choose. So a person who has signed in is never taken off the
 * team by a partner BFT MENA has not confirmed — unless that partner paid.
 */
export function provisionalRegistrantSeat<T extends SeatRef>(team: Omit<OwnedTeam, "competitors"> & { competitors: T[] }): T | null {
  if (team.ownership !== "unknown") return null;
  const payer = clean(team.payerEmail);
  if (payer) {
    const paid = team.competitors.filter((seat) => clean(seat.email) === payer);
    if (paid.length === 1) return paid[0];
  }
  const signedIn = team.competitors.filter((seat) => seat.userId);
  return signedIn.length === 1 ? signedIn[0] : null;
}

/** Who manages the team now: the confirmed registrant, or — unconfirmed — the automatic one. */
export function managingSeat<T extends SeatRef>(team: Omit<OwnedTeam, "competitors"> & { competitors: T[] }): T | null {
  return team.ownership === "unknown" ? provisionalRegistrantSeat(team) : registrantSeat(team);
}

/** The registrant's seat, or null (unknown or joint ownership, or no match). */
export function registrantSeat<T extends SeatRef>(team: Omit<OwnedTeam, "competitors"> & { competitors: T[] }): T | null {
  if (team.ownership !== "registrant") return null;
  if (team.registrantUserId) {
    const byAccount = team.competitors.find((seat) => seat.userId === team.registrantUserId);
    if (byAccount) return byAccount;
  }
  const email = clean(team.registrantEmail);
  if (!email) return null;
  const byEmail = team.competitors.filter((seat) => clean(seat.email) === email);
  return byEmail.length === 1 ? byEmail[0] : null;
}

/**
 * Ownership of a team created or adopted from a CRM contact: the contact is
 * the payer, and when the payer's email is on one of the seats that person
 * registered the team. Anything else is `unknown` — for BFT MENA to confirm.
 */
export function ownershipFromContact(contactEmail: string | null | undefined, seatEmails: (string | null | undefined)[]): {
  ownership: Ownership;
  registrantEmail: string | null;
} {
  const payer = clean(contactEmail);
  const seats = seatEmails.map(clean);
  if (payer && seats.filter((email) => email === payer).length === 1) return { ownership: "registrant", registrantEmail: payer };
  return { ownership: "unknown", registrantEmail: null };
}

/** Two seats — whatever their positions. */
export function isComplete(team: { competitors: readonly unknown[] }): boolean {
  return team.competitors.length === 2;
}

/**
 * A place in the field AND a full pair. Payment facts alone (isCompeting)
 * stay what approval and accounting read; this is what competing needs.
 * Where it applies — board, waves, results — is decision D3b, not yet made.
 */
export function isEligibleToCompete(team: Parameters<typeof isCompeting>[0] & { competitors: readonly unknown[] }): boolean {
  return isCompeting(team) && isComplete(team);
}

/**
 * Athlete-initiated membership changes (replace, fill, leave). OFF unless
 * explicitly turned on — R2a ships the model with this off (plan §12).
 */
export function membershipChangesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ATHLETE_MEMBERSHIP_CHANGES === "on";
}

// ─────────────────────────────────────────────────────────────────────────────
// WHO MAY CHANGE A TEAM'S MEMBERSHIP (plan v7 §4, release R2b).
//
//   registrant (the person, in seat 1 or 2) — replace the other member, or
//                fill the empty seat; cannot leave (BFT MENA withdraws).
//   the other member of a registrant's team — leave; nothing else.
//   joint     — nobody replaces or fills alone; leaving is a split (R4b).
//   unknown   — the automatic registrant (provisionalRegistrantSeat) acts as
//               the registrant, the other member as the other member; when
//               there is none, nothing for anybody until BFT MENA chooses.
// ─────────────────────────────────────────────────────────────────────────────

export type RightsTeam = OwnedTeam & { competitors: (SeatRef & { position: number })[] };

export type MembershipRights = {
  mySeatId: string | null;
  role: "registrant" | "member" | "none";
  /** Why this person can do nothing (null when they can do something). */
  reason: null | "NOT_ON_TEAM" | "OWNERSHIP_UNKNOWN" | "JOINT_TEAM" | "REGISTRANT_UNRESOLVED";
  /** The seat the registrant may replace — the OTHER one — or null. */
  canReplace: string | null;
  canFill: boolean;
  canLeave: boolean;
  /** The registrant is the automatic one: BFT MENA has not confirmed it. */
  provisional: boolean;
};

export function membershipRights(team: RightsTeam, userId: string): MembershipRights {
  const mine = team.competitors.find((seat) => seat.userId === userId) ?? null;
  const nothing = (reason: MembershipRights["reason"]): MembershipRights => ({
    mySeatId: mine?.id ?? null, role: "none", reason, canReplace: null, canFill: false, canLeave: false, provisional: false,
  });
  if (!mine) return nothing("NOT_ON_TEAM");
  if (team.ownership === "joint") return nothing("JOINT_TEAM");
  const provisional = team.ownership === "unknown";
  const registrant = managingSeat(team);
  if (!registrant) return nothing(provisional ? "OWNERSHIP_UNKNOWN" : "REGISTRANT_UNRESOLVED");
  if (registrant.id === mine.id) {
    const other = team.competitors.find((seat) => seat.id !== mine.id) ?? null;
    return { mySeatId: mine.id, role: "registrant", reason: null, canReplace: other?.id ?? null, canFill: team.competitors.length < 2, canLeave: false, provisional };
  }
  return { mySeatId: mine.id, role: "member", reason: null, canReplace: null, canFill: false, canLeave: true, provisional };
}

// ─────────────────────────────────────────────────────────────────────────────
// WHEN A TEAM MAY CHANGE (decision D3a).
//
// Until 24 hours before the competition starts, the changes each person is
// allowed (by ownership and permissions) are open. From that moment — the
// competition's stored start, minus 24 hours, on the SERVER's clock — the
// athletes' and gyms' changes close, and so do BFT MENA Partial access's:
// only BFT MENA Full access (the never-grantable key
// `registrations.changeAfterClose`) may still change a team. The window
// grants nobody anybody else's rights: it only says WHEN.
//
// The floor's own barriers — a started wave, a score, a finished
// competition — are not the window: they stop everybody, Full access too.
// ─────────────────────────────────────────────────────────────────────────────

/** Hours before the competition at which team changes close (D3a). */
export const TEAM_CHANGES_CLOSE_HOURS = 24;

/** The moment team changes close for everyone without Full access. */
export function teamChangesCloseAt(competitionDate: Date): Date {
  return new Date(competitionDate.getTime() - TEAM_CHANGES_CLOSE_HOURS * 3_600_000);
}

/** The cutoff as people read it: the competition's own time zone, their language. */
export function teamChangesCloseLabel(competitionDate: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    timeZone: "Asia/Qatar", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(teamChangesCloseAt(competitionDate));
}

/** Before the cutoff: open. At it and after: only with Full access. */
export function teamChangeWindow(competitionDate: Date, now: Date, fullAccess: boolean): { open: true; late: boolean } | { open: false; reason: "TEAM_EDIT_CLOSED" } {
  if (now.getTime() < teamChangesCloseAt(competitionDate).getTime()) return { open: true, late: false };
  return fullAccess ? { open: true, late: true } : { open: false, reason: "TEAM_EDIT_CLOSED" };
}

export type DoorTeam = {
  archivedAt: Date | null;
  waveId: string | null;
  waveStatus: string | null;
  scored: boolean;
  seriesStatus: string;
  seriesArchived: boolean;
  competitionDate: Date;
};

export type MembershipDoor =
  | { open: true }
  | { open: false; reason: "NOT_FOUND" | "SERIES_FINISHED" | "TEAM_ALREADY_SCORED" | "WAVE_STARTED" | "TEAM_EDIT_CLOSED" };

/**
 * The floor's barriers, which stop everybody. Membership (who is on the
 * team) cannot change once the competition is finished, the team has a
 * score, or its wave has started.
 */
export function membershipBarrier(team: Omit<DoorTeam, "competitionDate">): MembershipDoor {
  if (team.archivedAt) return { open: false, reason: "NOT_FOUND" };
  if (team.seriesStatus === "final" || team.seriesArchived) return { open: false, reason: "SERIES_FINISHED" };
  if (team.scored) return { open: false, reason: "TEAM_ALREADY_SCORED" };
  if (team.waveId && team.waveStatus !== "pending") return { open: false, reason: "WAVE_STARTED" };
  return { open: true };
}

/**
 * Whether membership may change right now: the barriers, then the window —
 * which, after the cutoff, only Full access passes.
 */
export function membershipDoor(team: DoorTeam, now: Date, fullAccess = false): MembershipDoor {
  const barrier = membershipBarrier(team);
  if (!barrier.open) return barrier;
  const window = teamChangeWindow(team.competitionDate, now, fullAccess);
  return window.open ? { open: true } : window;
}

/**
 * What an incomplete team (one seat) may do on the day — decision D3b. OFF
 * until that decision is made: today's behaviour (payment facts alone) holds,
 * and an athlete cannot LEAVE a team, since leaving is what makes one.
 * "hold" = the proposed policy: the place is kept, the money unchanged, but
 * the team is not on the board, results or floor sheets, and its wave will
 * not start with it.
 */
export function incompleteTeamPolicyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INCOMPLETE_TEAM_POLICY === "hold";
}

/**
 * Who stands on the floor — the board, the results, the judge's sheet,
 * marshalling. Payment facts alone (isCompeting) until the incomplete-team
 * policy is switched on (decision D3b); then a full pair as well. Payment
 * facts stay what approval, accounting and the reports read.
 */
export function onTheFloor(
  team: Parameters<typeof isCompeting>[0] & { competitors: readonly unknown[] },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return incompleteTeamPolicyEnabled(env) ? isEligibleToCompete(team) : isCompeting(team);
}
