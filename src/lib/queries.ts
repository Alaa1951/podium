import "server-only";
import { competitionChoices } from "@/lib/competition-choice";
import { cache } from "react";

import type {
  Category,
  Division,
  PaymentStatus,
  RegistrationSource,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { teamScope, type CurrentUser } from "@/lib/session";
import { totalPoints, zoneBreakdown, type EntryValues, type ZoneDef } from "@/lib/zones";

// Reads for the competition side. Every function that returns teams either
// serves the public board (submitted scores only, which is what the board is)
// or takes a CurrentUser and applies `teamScope` — scoping is never left to the
// caller.

const rosterInclude = {
  score: { select: { status: true } },
  studio: { select: { id: true, name: true } },
  competitors: {
    orderBy: { position: "asc" },
    include: { studio: { select: { id: true, name: true } }, user: { select: { name: true, phone: true, email: true } } },
  },
} as const;

const teamInclude = {
  ...rosterInclude,
  score: {
    include: {
      entries: { select: { inputId: true, value: true } },
      zones: { where: { status: "submitted" }, select: { zoneId: true } },
    },
  },
} as const;

/** One of the two people on a team, as every screen wants them. */
export type CompetitorRow = {
  id: string;
  position: number;
  fullName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: Date | null;
  /** BFT studio membership — null means this person is not a member anywhere. */
  studioId: string | null;
  studioName: string | null;
  userId: string | null;
  /** Stored portrait path, or null for the shared default (athlete-photo.ts). */
  photoPath: string | null;
};

/**
 * A team, which is also a registration, which is also a score.
 *
 * One row answers "who registered", "did they pay", "which wave are they in"
 * and "what did they do" — because in the real world it is one thing, and
 * splitting it across three shapes is what made the screens disagree.
 */
export type TeamRow = {
  id: string;
  number: number;
  name: string;
  category: Category;
  division: Division;
  wave: number;
  waveId: string | null;
  /** The station (1–9) this team stands on in every zone of its wave. */
  station: number | null;
  studioId: string | null;
  studioName: string | null;
  scoreEdits: number;
  competitors: CompetitorRow[];

  // ── Registration and payment ──────────────────────────────────────────
  paymentStatus: PaymentStatus;
  /** Set when the entry arrived after registration closed. Null = in the field. */
  waitlistedAt: Date | null;
  /** The pair's own photograph, or null before one is made. */
  groupPortraitPath: string | null;
  source: RegistrationSource;
  registeredAt: Date;
  paidAt: Date | null;
  amountMinor: number | null;
  currency: string;
  billingNumber: string | null;
  externalId: string | null;
  attendedAt: Date | null;

  // ── The score ─────────────────────────────────────────────────────────
  /** Raw values keyed by ZoneInput id. Absent means not recorded. */
  values: EntryValues;
  /** Points per zone, in board order, derived from the series definition. */
  zones: { id: string; number: number; name: string; points: number }[];
  /** Zones whose judge has submitted them — locked. */
  lockedZones: string[];
  submitted: boolean;
  total: number;
};

type TeamWithRelations = Awaited<ReturnType<typeof loadTeams>>[number];
type RosterWithRelations = Awaited<ReturnType<typeof loadRoster>>[number];
export type RosterRow = Omit<TeamRow, "values" | "zones" | "total" | "lockedZones">;

function loadRoster(args: Parameters<typeof prisma.team.findMany>[0]) {
  return prisma.team.findMany({ ...args, include: rosterInclude });
}

function loadTeams(args: Parameters<typeof prisma.team.findMany>[0]) {
  return prisma.team.findMany({ ...args, include: teamInclude });
}

function toRosterRow(team: RosterWithRelations): RosterRow {
  return {
    id: team.id,
    number: team.number,
    name: team.name,
    category: team.category,
    division: team.division,
    wave: team.wave,
    waveId: team.waveId,
    station: team.station,
    studioId: team.studioId,
    studioName: team.studio?.name ?? null,
    scoreEdits: team.scoreEdits,
    competitors: team.competitors.map((c) => ({
      id: c.id,
      position: c.position,
      fullName: c.user?.name ?? c.fullName,
      phone: c.user ? c.user.phone : c.phone,
      email: c.user?.email ?? c.email,
      dateOfBirth: c.dateOfBirth,
      studioId: c.studioId,
      studioName: c.studio?.name ?? null,
      userId: c.userId,
      photoPath: c.photoPath,
    })),

    paymentStatus: team.paymentStatus,
    waitlistedAt: team.waitlistedAt,
    groupPortraitPath: team.groupPortraitPath,
    source: team.source,
    registeredAt: team.registeredAt,
    paidAt: team.paidAt,
    amountMinor: team.amountMinor,
    currency: team.currency,
    billingNumber: team.billingNumber,
    externalId: team.externalId,
    attendedAt: team.attendedAt,

    submitted: team.score?.status === "submitted",
  };
}

function toTeamRow(team: TeamWithRelations, zones: ZoneDef[]): TeamRow {
  const values: EntryValues = {};
  for (const entry of team.score?.entries ?? []) values[entry.inputId] = entry.value;

  return {
    ...toRosterRow(team),
    values,
    zones: zoneBreakdown(zones, values),
    lockedZones: team.score?.zones.map((zone) => zone.zoneId) ?? [],
    total: totalPoints(zones, values),
  };
}

// ── The scoring definition ───────────────────────────────────────────────────

/** A series' zones and their movements, in board order. */
// Request-local deduplication: score screens and their team query need the same
// definition. The next request still reads changes made to the scoring setup.
export const getSeriesZones = cache(async (seriesId: string): Promise<ZoneDef[]> => {
  const zones = await prisma.zone.findMany({
    where: { seriesId },
    orderBy: { number: "asc" },
    include: { inputs: { orderBy: { position: "asc" } } },
  });

  return zones.map((zone) => ({
    id: zone.id,
    number: zone.number,
    name: zone.name,
    inputs: zone.inputs.map((input) => ({
      id: input.id,
      position: input.position,
      label: input.label,
      unit: input.unit,
      multiplyBy: input.multiplyBy,
      divideBy: input.divideBy,
      maxValue: input.maxValue,
      inputMode: input.inputMode,
    })),
  }));
});

/** The same, reached through an event — which is how every screen asks. */
// ── Series: the competition itself ───────────────────────────────────────────

/** A competition, by id or by the slug in its URL. */
export async function getSeries(idOrSlug: string) {
  return prisma.series.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: { _count: { select: { teams: true, waves: true, zones: true, studios: true } } },
  });
}

/** Every competition, soonest first — the Series list. */
export async function listSeries() {
  // Archived competitions were mistakes that never ran — restorable from the
  // series screen's archived strip, and out of everyone's way until then.
  return prisma.series.findMany({
    where: { archivedAt: null },
    orderBy: [{ competitionDate: "desc" }],
    include: { _count: { select: { teams: true, waves: true, zones: true, studios: true } } },
  });
}

/** Mistake competitions, kept restorable. Admin-only screen. */
export async function listArchivedSeries() {
  return prisma.series.findMany({
    where: { NOT: { archivedAt: null } },
    orderBy: [{ archivedAt: "desc" }],
    include: { _count: { select: { teams: true, waves: true, zones: true, studios: true } } },
  });
}

/**
 * The competitions offered on the PUBLIC sign-up form.
 *
 * This is read by an unauthenticated page, so it is deliberately the poster
 * and nothing else: a name and a date. Not the venue, not the slug, not how
 * many teams are in — those belong to people who are already inside.
 *
 * `signupOpen` is the whole gate, and it is off by default. A competition
 * being `scheduled` is not the same as being ready to advertise, and the
 * status alone would have put a competition called "test" in front of
 * strangers.
 *
 * Note it does NOT apply `registrationClosesAt`. That deadline governs a
 * studio entering a paid team; somebody asking for an ACCOUNT is a different
 * act, and applying it would silently empty this list and block sign-up.
 */
export async function listOpenSignupSeries() {
  const rows = await prisma.series.findMany({
    where: {
      signupOpen: true,
      isTraining: false,
      status: { in: ["scheduled", "live"] },
      archivedAt: null,
      isActive: true,
    },
    orderBy: { competitionDate: "asc" },
    // `registrationClosesAt` is included deliberately: it is not a leak — it is
    // the one fact somebody needs BEFORE they commit, so the form can tell them
    // they would be joining a waiting list rather than letting them find out
    // afterwards. Still no venue, no slug and no team count.
    select: { id: true, name: true, competitionDate: true, registrationClosesAt: true, status: true },
  });
  return competitionChoices(rows).slice(0, 12);
}

/**
 * Where somebody lands with no competition chosen: the one running now, else
 * the next one scheduled. Finished competitions are never a default.
 */
export async function getDefaultSeries() {
  return competitionChoices(await prisma.series.findMany({ where: { archivedAt: null, isActive: true, isTraining: false, status: { in: ["scheduled", "live"] } } }))[0] ?? null;
}

/** The studios taking part in a competition. */
export async function getSeriesStudios(seriesId: string) {
  const rows = await prisma.seriesStudio.findMany({
    where: { seriesId },
    include: { studio: { select: { id: true, name: true, isActive: true } } },
    orderBy: { studio: { name: "asc" } },
  });
  return rows.map((row) => ({ ...row.studio, addedAt: row.addedAt }));
}

// ── Teams ────────────────────────────────────────────────────────────────────

/** Every team in the competition, unscoped — for the public board and podiums. */
export async function getSeriesTeams(seriesId: string): Promise<TeamRow[]> {
  // Archived registrations are withdrawn ones — kept for the record, shown
  // nowhere by default. The registrations screen fetches them on demand.
  const [teams, zones] = await Promise.all([
    loadTeams({ where: { seriesId, archivedAt: null }, orderBy: { number: "asc" } }),
    getSeriesZones(seriesId),
  ]);
  return teams.map((team) => toTeamRow(team, zones));
}

/** Withdrawn registrations, for the registrations screen's archived view. */
export async function getArchivedTeams(seriesId: string): Promise<TeamRow[]> {
  const [teams, zones] = await Promise.all([
    loadTeams({ where: { seriesId, NOT: { archivedAt: null } }, orderBy: { archivedAt: "desc" } }),
    getSeriesZones(seriesId),
  ]);
  return teams.map((team) => toTeamRow(team, zones));
}

/** Only the teams this user may work on — a studio sees its own. */
export async function getScopedTeams(seriesId: string, user: CurrentUser): Promise<TeamRow[]> {
  const [teams, zones] = await Promise.all([
    loadTeams({ where: { seriesId, archivedAt: null, ...teamScope(user) }, orderBy: { number: "asc" } }),
    getSeriesZones(seriesId),
  ]);
  return teams.map((team) => toTeamRow(team, zones));
}

/** Registration screens need identities and status, not every scoring input. */
export async function getScopedRoster(seriesId: string, user: CurrentUser, teamId?: string): Promise<RosterRow[]> {
  const teams = await loadRoster({
    where: { seriesId, archivedAt: null, ...teamScope(user), ...(teamId ? { id: teamId } : {}) },
    orderBy: { number: "asc" },
  });
  return teams.map(toRosterRow);
}

/**
 * The entries on the waiting list — those that came in after registration
 * closed and hold no place yet.
 *
 * Scoped like every other roster query, so a studio sees its own and nobody
 * else's. Ordered by when they started waiting, which is the useful order on
 * a list whose whole purpose is deciding who gets let in next.
 */
export async function getWaitingRoster(seriesId: string, user: CurrentUser): Promise<RosterRow[]> {
  const teams = await loadRoster({
    where: { seriesId, archivedAt: null, NOT: { waitlistedAt: null }, ...teamScope(user) },
    orderBy: { waitlistedAt: "asc" },
  });
  return teams.map(toRosterRow);
}

export async function getArchivedRoster(seriesId: string, user: CurrentUser): Promise<RosterRow[]> {
  const teams = await loadRoster({
    where: { seriesId, NOT: { archivedAt: null }, ...teamScope(user) },
    orderBy: { archivedAt: "desc" },
  });
  return teams.map(toRosterRow);
}

export async function getTeamForUser(teamId: string, user: CurrentUser) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, ...teamScope(user) },
    include: teamInclude,
  });
  if (!team) return null;
  const zones = await getSeriesZones(team.seriesId);
  return { ...toTeamRow(team, zones), seriesId: team.seriesId, zoneDefs: zones };
}

/** The competitor's own team for this competition, matched by account. */
export async function getMyTeam(seriesId: string, user: CurrentUser) {
  const zones = await getSeriesZones(seriesId);

  const byAccount = await prisma.team.findFirst({
    where: { seriesId, archivedAt: null, competitors: { some: { userId: user.id } } },
    include: teamInclude,
  });
  if (byAccount) return toTeamRow(byAccount, zones);

  return null;
}

export { lastWave, podiums, rankBracket, rankOverall, rankWave } from "@/lib/rankings";
export type { RankedTeam } from "@/lib/rankings";

export {
  getLoadStandards,
  getSeriesWaves,
  listAccounts,
  listStudios,
} from "@/lib/queries-people";
