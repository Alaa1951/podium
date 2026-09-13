import "server-only";

import type {
  Category,
  Division,
  PaymentStatus,
  RegistrationSource,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/scoring";
import { teamScope, type CurrentUser } from "@/lib/session";
import { totalPoints, zoneBreakdown, type EntryValues, type ZoneDef } from "@/lib/zones";

// Reads for the competition side. Every function that returns teams either
// serves the public board (submitted scores only, which is what the board is)
// or takes a CurrentUser and applies `teamScope` — scoping is never left to the
// caller.

const teamInclude = {
  score: { include: { entries: { select: { inputId: true, value: true } } } },
  studio: { select: { id: true, name: true } },
  competitors: {
    orderBy: { position: "asc" },
    include: { studio: { select: { id: true, name: true } } },
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
  studioId: string | null;
  studioName: string | null;
  scoreEdits: number;
  competitors: CompetitorRow[];

  // ── Registration and payment ──────────────────────────────────────────
  paymentStatus: PaymentStatus;
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
  submitted: boolean;
  total: number;
};

type TeamWithRelations = Awaited<ReturnType<typeof loadTeams>>[number];

function loadTeams(args: Parameters<typeof prisma.team.findMany>[0]) {
  return prisma.team.findMany({ ...args, include: teamInclude });
}

function toTeamRow(team: TeamWithRelations, zones: ZoneDef[]): TeamRow {
  const values: EntryValues = {};
  for (const entry of team.score?.entries ?? []) values[entry.inputId] = entry.value;

  return {
    id: team.id,
    number: team.number,
    name: team.name,
    category: team.category,
    division: team.division,
    wave: team.wave,
    waveId: team.waveId,
    studioId: team.studioId,
    studioName: team.studio?.name ?? null,
    scoreEdits: team.scoreEdits,
    competitors: team.competitors.map((c) => ({
      id: c.id,
      position: c.position,
      fullName: c.fullName,
      phone: c.phone,
      email: c.email,
      dateOfBirth: c.dateOfBirth,
      studioId: c.studioId,
      studioName: c.studio?.name ?? null,
      userId: c.userId,
    })),

    paymentStatus: team.paymentStatus,
    source: team.source,
    registeredAt: team.registeredAt,
    paidAt: team.paidAt,
    amountMinor: team.amountMinor,
    currency: team.currency,
    billingNumber: team.billingNumber,
    externalId: team.externalId,
    attendedAt: team.attendedAt,

    values,
    zones: zoneBreakdown(zones, values),
    submitted: team.score?.status === "submitted",
    total: totalPoints(zones, values),
  };
}

// ── The scoring definition ───────────────────────────────────────────────────

/** A series' zones and their movements, in board order. */
export async function getSeriesZones(seriesId: string): Promise<ZoneDef[]> {
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
}

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
 * Where somebody lands with no competition chosen: the one running now, else
 * the next one scheduled, else the most recent.
 */
export async function getDefaultSeries() {
  return (
    (await prisma.series.findFirst({
      where: { status: "live" },
      orderBy: { competitionDate: "desc" },
    })) ??
    (await prisma.series.findFirst({
      where: { status: "scheduled" },
      orderBy: { competitionDate: "asc" },
    })) ??
    (await prisma.series.findFirst({ orderBy: { competitionDate: "desc" } }))
  );
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

export async function getTeamForUser(teamId: string, user: CurrentUser) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, ...teamScope(user) },
    include: teamInclude,
  });
  if (!team) return null;
  const zones = await getSeriesZones(team.seriesId);
  return { ...toTeamRow(team, zones), seriesId: team.seriesId, zoneDefs: zones };
}

/** The competitor's own team for this competition, matched by account or by name. */
export async function getMyTeam(seriesId: string, user: CurrentUser) {
  const zones = await getSeriesZones(seriesId);

  const byAccount = await prisma.team.findFirst({
    where: { seriesId, competitors: { some: { userId: user.id } } },
    include: teamInclude,
  });
  if (byAccount) return toTeamRow(byAccount, zones);

  // A studio can register a competitor before that competitor has an account.
  // Falling back to the normalised name links the two without a second row.
  if (!user.name) return null;
  const byName = await prisma.team.findFirst({
    where: { seriesId, competitors: { some: { normalizedName: normalizeName(user.name) } } },
    include: teamInclude,
  });
  return byName ? toTeamRow(byName, zones) : null;
}

export { lastWave, podiums, rankBracket, rankOverall, rankWave } from "@/lib/rankings";
export type { RankedTeam } from "@/lib/rankings";

export {
  getLoadStandards,
  getSeriesWaves,
  listAccounts,
  listStudios,
} from "@/lib/queries-people";
