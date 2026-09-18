"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireRole } from "@/lib/session";
import { seriesArchiveGuard } from "@/lib/series-guard";
import { DEFAULT_ZONES } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────────────────────
// THE COMPETITION, AND ITS RUNNING ORDER.
//
// A Series IS a competition: one row with a date, a venue, a field, waves and
// a board. BFT MENA only — a studio registers and (if it is opened for them)
// scores its own teams, but never touches the schedule.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** "PODIUM Series 4" → "podium-series-4". Stable, readable, URL-safe. */
function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

async function uniqueSlug(name: string, ignoreId?: string) {
  const base = slugify(name) || "series";
  let slug = base;

  for (let attempt = 2; attempt < 50; attempt++) {
    const clash = await prisma.series.findFirst({
      where: { slug, ...(ignoreId ? { NOT: { id: ignoreId } } : {}) },
      select: { id: true },
    });
    if (!clash) return slug;
    slug = `${base}-${attempt}`;
  }

  return `${base}-${Date.now().toString(36)}`;
}

const seriesSchema = z.object({
  name: z.string().trim().min(2).max(120),
  competitionDate: z.string().min(1),
  venue: z.string().trim().min(1).max(120).default("All studios"),
  firstWaveTime: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  waveMinutes: z.coerce.number().int().min(1).max(180).default(20),
  waveCapacity: z.coerce.number().int().min(1).max(99).default(9),
});

/**
 * Create a competition.
 *
 * It is given the Series 1 zone definition to start from, because a series
 * with no zones cannot be scored and starting from a blank scoring table is
 * nobody's intention. It is edited in Settings like everything else.
 */
export async function createSeries(formData: FormData): Promise<void> {
  const actor = await requireRole("admin");

  const parsed = seriesSchema.safeParse({
    name: formData.get("name"),
    competitionDate: formData.get("competitionDate"),
    venue: formData.get("venue") || "All studios",
    firstWaveTime: formData.get("firstWaveTime") || "09:00",
    waveMinutes: formData.get("waveMinutes") || 20,
    waveCapacity: formData.get("waveCapacity") || 9,
  });
  if (!parsed.success) redirect("/series/new?error=details");

  const date = new Date(parsed.data.competitionDate);
  if (Number.isNaN(date.getTime())) redirect("/series/new?error=date");

  const series = await prisma.series.create({
    data: {
      name: parsed.data.name,
      slug: await uniqueSlug(parsed.data.name),
      competitionDate: date,
      venue: parsed.data.venue,
      firstWaveTime: parsed.data.firstWaveTime,
      waveMinutes: parsed.data.waveMinutes,
      waveCapacity: parsed.data.waveCapacity,
      // The board unlocks when the competition starts, unless told otherwise.
      boardOpensAt: date,
      zones: {
        create: DEFAULT_ZONES.map((zone) => ({
          number: zone.number,
          name: zone.name,
          inputs: { create: zone.inputs.map((movement) => ({ ...movement })) },
        })),
      },
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesCreated,
    targetType: "event",
    targetId: series.id,
    targetLabel: series.name,
    detail: `${date.toISOString().slice(0, 10)} · ${parsed.data.venue}`,
  });

  revalidateCompetitionViews();
  redirect(`/series/${series.slug}/studios`);
}

const settingsSchema = z.object({
  seriesId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  competitionDate: z.string().min(1),
  venue: z.string().trim().min(1).max(120),
  firstWaveTime: z.string().regex(/^\d{2}:\d{2}$/),
  waveMinutes: z.coerce.number().int().min(1).max(180),
  waveCapacity: z.coerce.number().int().min(1).max(99),
  boardOpensAt: z.string().optional(),
  registrationClosesAt: z.string().optional(),
  registrationsFinalAt: z.string().optional(),
  scoreEntryClosesAt: z.string().optional(),
  resultsPublicAt: z.string().optional(),
  championsAnnouncedAt: z.string().optional(),
  studiosMayEnterScores: z.coerce.boolean().default(false),
  studioScoreCorrections: z.coerce.number().int().min(0).max(5),
  teamEditCloseHours: z.coerce.number().int().min(0).max(720),
  showTeamName: z.coerce.boolean().default(true),
  showCompetitorNames: z.coerce.boolean().default(true),
  showStudioColumn: z.coerce.boolean().default(true),
});

const whenever = (value: string | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Everything about a competition that is a setting rather than a fact. */
export async function updateSeriesSettings(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, ...data } = parsed.data;

  const before = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { name: true, studiosMayEnterScores: true },
  });
  if (!before) return { ok: false, error: "NOT_FOUND" };

  const date = whenever(data.competitionDate);
  if (!date) return { ok: false, error: "SERIES_DATE_INVALID" };

  await prisma.series.update({
    where: { id: seriesId },
    data: {
      name: data.name,
      slug: await uniqueSlug(data.name, seriesId),
      competitionDate: date,
      venue: data.venue,
      firstWaveTime: data.firstWaveTime,
      waveMinutes: data.waveMinutes,
      waveCapacity: data.waveCapacity,
      boardOpensAt: whenever(data.boardOpensAt),
      registrationClosesAt: whenever(data.registrationClosesAt),
      registrationsFinalAt: whenever(data.registrationsFinalAt),
      scoreEntryClosesAt: whenever(data.scoreEntryClosesAt),
      resultsPublicAt: whenever(data.resultsPublicAt),
      championsAnnouncedAt: whenever(data.championsAnnouncedAt),
      studiosMayEnterScores: data.studiosMayEnterScores,
      studioScoreCorrections: data.studioScoreCorrections,
      teamEditCloseHours: data.teamEditCloseHours,
      showTeamName: data.showTeamName,
      showCompetitorNames: data.showCompetitorNames,
      showStudioColumn: data.showStudioColumn,
    },
  });

  // Length and capacity belong to the competition, not to each wave —
  // changing them here restamps every wave in the running order at once.
  await prisma.wave.updateMany({
    where: { seriesId },
    data: { durationMinutes: data.waveMinutes, capacity: data.waveCapacity },
  });

  // Who may write a score is the setting worth naming in the log by itself.
  if (before.studiosMayEnterScores !== data.studiosMayEnterScores) {
    await recordAudit({
      actorId: actor.id,
      action: AUDIT.seriesSettingsChanged,
      targetType: "event",
      targetId: seriesId,
      targetLabel: data.name,
      detail: data.studiosMayEnterScores
        ? "studios may now enter scores"
        : "score entry closed to studios",
    });
  }

  revalidateCompetitionViews();
  return { ok: true };
}

const statusSchema = z.object({
  seriesId: z.string().min(1),
  status: z.enum(["scheduled", "live", "final"]),
});

/** Scheduled → live → final. What the board shows follows from it. */
export async function setSeriesStatus(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  await prisma.series.update({
    where: { id: parsed.data.seriesId },
    data: { status: parsed.data.status },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesStatusChanged,
    targetType: "event",
    targetId: parsed.data.seriesId,
    detail: `status=${parsed.data.status}`,
  });

  revalidateCompetitionViews();
  return { ok: true };
}

/**
 * Publish — or unpublish — a finished competition's results to the public site
 * at /results.
 *
 * ON makes the results public immediately, unless they already are. OFF clears
 * the publication moment entirely, so the competition drops out of the public
 * list even though it is finished — the results go back to being the
 * competitors' own business. The date field on Settings remains the precise
 * scheduler for "publish at"; this is the switch for "publish now".
 */
export async function setSeriesPublished(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = z
    .object({ seriesId: z.string().min(1), published: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const series = await prisma.series.findUnique({
    where: { id: parsed.data.seriesId },
    select: { id: true, resultsPublicAt: true },
  });
  if (!series) return { ok: false, error: "NOT_FOUND" };

  const now = new Date();
  const resultsPublicAt = parsed.data.published
    ? series.resultsPublicAt && series.resultsPublicAt <= now
      ? series.resultsPublicAt // already live publicly — leave its moment
      : now
    : null;

  if (
    (series.resultsPublicAt === null) === (resultsPublicAt === null) &&
    (resultsPublicAt === null || series.resultsPublicAt?.getTime() === resultsPublicAt.getTime())
  ) {
    return { ok: true }; // nothing to change
  }

  await prisma.series.update({ where: { id: series.id }, data: { resultsPublicAt } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesPublishedChanged,
    targetType: "event",
    targetId: series.id,
    detail: resultsPublicAt
      ? `published to /results at ${resultsPublicAt.toISOString()}`
      : "unpublished — removed from /results",
  });

  revalidateCompetitionViews();
  return { ok: true, message: resultsPublicAt ? "Results are public." : "Results are private." };
}

// ── Who is taking part ───────────────────────────────────────────────────────

const studioSchema = z.object({
  seriesId: z.string().min(1),
  studioId: z.string().min(1),
  taking: z.coerce.boolean(),
});

/**
 * Add or remove a studio from a competition.
 *
 * Being on this list is what lets that studio's people register their teams
 * and follow their own entries. A studio with teams already registered cannot
 * simply be dropped — the entries would have nowhere to belong.
 */
export async function setSeriesStudio(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = studioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, studioId, taking } = parsed.data;

  const studio = await prisma.studio.findUnique({
    where: { id: studioId },
    select: { name: true },
  });
  if (!studio) return { ok: false, error: "NOT_FOUND" };

  if (taking) {
    await prisma.seriesStudio.upsert({
      where: { seriesId_studioId: { seriesId, studioId } },
      create: { seriesId, studioId },
      update: {},
    });
  } else {
    const registered = await prisma.team.count({ where: { seriesId, studioId } });
    if (registered > 0) return { ok: false, error: "HAS_TEAMS" };

    await prisma.seriesStudio.deleteMany({ where: { seriesId, studioId } });
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesStudioChanged,
    targetType: "studio",
    targetId: studioId,
    targetLabel: studio.name,
    detail: taking ? "added to the competition" : "removed from the competition",
  });

  revalidateCompetitionViews();
  return { ok: true };
}

// ── Removing a competition ───────────────────────────────────────────────────

/**
 * Archive a competition that was created by mistake and never ran. Soft by
 * design: it disappears from the series list and can be restored. A live event
 * is locked and a finished one is the record — neither is ever removable.
 */
export async function archiveSeries(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = z.object({ seriesId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const series = await prisma.series.findUnique({
    where: { id: parsed.data.seriesId },
    select: { id: true, name: true, status: true, archivedAt: true },
  });
  if (!series || series.archivedAt) return { ok: false, error: "NOT_FOUND" };

  const phase = seriesArchiveGuard(series.status);
  if (!phase.allowed) return { ok: false, error: phase.reason };

  await prisma.series.update({
    where: { id: series.id },
    data: { archivedAt: new Date(), isActive: false },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesArchived,
    targetType: "event",
    targetId: series.id,
    targetLabel: series.name,
    detail: "archived — restorable",
  });

  revalidateCompetitionViews();
  return { ok: true, message: "Competition archived." };
}

/** Bring an archived competition back onto the series list. Admin only. */
export async function restoreSeries(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = z.object({ seriesId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const series = await prisma.series.findFirst({
    where: { id: parsed.data.seriesId, NOT: { archivedAt: null } },
    select: { id: true, name: true },
  });
  if (!series) return { ok: false, error: "NOT_FOUND" };

  await prisma.series.update({
    where: { id: series.id },
    data: { archivedAt: null, isActive: true },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.seriesRestored,
    targetType: "event",
    targetId: series.id,
    targetLabel: series.name,
  });

  revalidateCompetitionViews();
  return { ok: true, message: "Competition restored." };
}
