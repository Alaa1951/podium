"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { hasReachedZone } from "@/lib/floor";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { getSeriesZones } from "@/lib/queries";
import { can, canWriteScore, requireUser, teamScope } from "@/lib/session";
import { floorTimingFor } from "@/lib/wave-clock";
import { canWriteZoneScore } from "@/lib/zone-score-rules";
import { allInputs, isComplete, validateEntries, type ZoneDef } from "@/lib/zones";

const optionalInt = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === "" || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  });

export type SaveScoreResult =
  | { ok: true }
  | { ok: false; error: string; fields?: { inputId: string; code: string }[] };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Write values for one team, audit what changed, and settle the per-zone
 * locks. `submitZones` are the zones this write submits; when every zone of
 * the competition is submitted the team's score becomes `submitted` — that is
 * what the board and the results count.
 */
async function writeEntries(
  tx: Tx,
  params: {
    teamId: string;
    userId: string;
    zones: ZoneDef[];
    next: Record<string, number | null>;
    previous: Map<string, number | null>;
    submitZones: string[];
  }
) {
  const known = new Map(allInputs(params.zones).map((input) => [input.id, input]));
  const score = await tx.score.upsert({
    where: { teamId: params.teamId },
    create: { teamId: params.teamId, status: "draft" },
    update: {},
  });

  for (const [inputId, value] of Object.entries(params.next)) {
    await tx.zoneEntry.upsert({
      where: { scoreId_inputId: { scoreId: score.id, inputId } },
      create: { scoreId: score.id, inputId, value },
      update: { value },
    });
  }

  const changed = Object.keys(params.next).filter(
    (inputId) => (params.previous.get(inputId) ?? null) !== (params.next[inputId] ?? null)
  );
  if (changed.length) {
    await tx.scoreAudit.createMany({
      data: changed.map((inputId) => ({
        scoreId: score.id,
        // The movement's label, not its id — an audit line has to be readable
        // a year later, when the id means nothing to anyone.
        field: known.get(inputId)?.label ?? inputId,
        oldValue: params.previous.get(inputId) == null ? null : String(params.previous.get(inputId)),
        newValue: params.next[inputId] === null ? null : String(params.next[inputId]),
        operatorId: params.userId,
      })),
    });
  }

  const now = new Date();
  for (const zoneId of params.submitZones) {
    await tx.zoneScore.upsert({
      where: { scoreId_zoneId: { scoreId: score.id, zoneId } },
      create: { scoreId: score.id, zoneId, status: "submitted", submittedAt: now, submittedById: params.userId },
      update: { status: "submitted", submittedAt: now, submittedById: params.userId },
    });
  }

  // The team's score is submitted once its last zone is.
  const submittedZones = await tx.zoneScore.count({ where: { scoreId: score.id, status: "submitted" } });
  if (params.zones.length > 0 && submittedZones >= params.zones.length && score.status !== "submitted") {
    await tx.score.update({
      where: { id: score.id },
      data: { status: "submitted", submittedAt: now, submittedById: params.userId },
    });
  }
  return changed.length;
}

// ── One zone, from the judge sheet ───────────────────────────────────────────

const saveZoneSchema = z.object({
  teamId: z.string().min(1),
  zoneId: z.string().min(1),
  /** Keyed by ZoneInput id; only this zone's inputs are kept. */
  values: z.record(z.string(), optionalInt),
  /** Submit locks the zone. A zone can only be submitted complete. */
  submit: z.boolean().default(false),
});

/**
 * A judge's write: one zone of one team. Everything that decides it is
 * re-read from the database — the judge's post on this zone, the team's
 * station, whether its wave has reached the zone, whether the zone is
 * already locked — and handed to canWriteZoneScore (zone-score-rules.ts).
 */
export async function saveZoneScore(input: unknown): Promise<SaveScoreResult> {
  const user = await requireUser();
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = saveZoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { teamId, zoneId, values, submit } = parsed.data;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      seriesId: true,
      station: true,
      archivedAt: true,
      series: { select: { status: true } },
      waveRef: { select: { startedAt: true, status: true } },
      score: {
        select: {
          entries: { select: { inputId: true, value: true } },
          zones: { select: { zoneId: true, status: true } },
        },
      },
    },
  });
  if (!team || team.archivedAt) return { ok: false, error: "NOT_FOUND" };

  const zones = await getSeriesZones(team.seriesId);
  const ordered = [...zones].sort((a, b) => a.number - b.number);
  const zoneIndex = ordered.findIndex((zone) => zone.id === zoneId);
  if (zoneIndex < 0) return { ok: false, error: "NOT_FOUND" };
  const zone = ordered[zoneIndex];

  const [post, timing, inScope] = await Promise.all([
    prisma.zoneStaff.findUnique({
      where: { zoneId_userId: { zoneId, userId: user.id } },
      select: { position: true, station: true },
    }),
    floorTimingFor(team.seriesId),
    prisma.team.count({ where: { id: team.id, ...teamScope(user) } }),
  ]);

  const wave = team.waveRef;
  const reached =
    !!wave?.startedAt &&
    (wave.status === "complete" || hasReachedZone({ startedAt: wave.startedAt }, zoneIndex, timing, new Date()));

  const decision = canWriteZoneScore({
    user,
    post,
    team: { station: team.station },
    seriesStatus: team.series.status,
    reached,
    zoneSubmitted: team.score?.zones.some((row) => row.zoneId === zoneId && row.status === "submitted") ?? false,
  });
  if (!decision.allowed) return { ok: false, error: decision.reason };
  if (decision.as === "console" && !inScope) return { ok: false, error: "FORBIDDEN" };

  // Only this zone's inputs; anything else in the request is dropped.
  const next: Record<string, number | null> = {};
  for (const inputDef of zone.inputs) {
    if (inputDef.id in values) next[inputDef.id] = values[inputDef.id] ?? null;
  }
  const errors = validateEntries([zone], next);
  if (errors.length) return { ok: false, error: "INVALID_SCORE", fields: errors };

  const previous = new Map((team.score?.entries ?? []).map((entry) => [entry.inputId, entry.value]));
  if (submit) {
    const merged = Object.fromEntries(zone.inputs.map((inputDef) => [inputDef.id, inputDef.id in next ? next[inputDef.id] : previous.get(inputDef.id) ?? null]));
    if (!isComplete([zone], merged)) return { ok: false, error: "INCOMPLETE" };
  }

  await prisma.$transaction((tx) =>
    writeEntries(tx, { teamId, userId: user.id, zones, next, previous, submitZones: submit ? [zoneId] : [] })
  );

  if (submit) {
    await recordAudit({
      actorId: user.id,
      action: AUDIT.zoneScoreSaved,
      targetType: "team",
      targetId: team.id,
      targetLabel: `Zone ${zone.number}`,
      detail: `zone ${zone.number} submitted (${decision.as})`,
    });
  }

  revalidateCompetitionViews();
  return { ok: true };
}

// ── A whole team, from the console ───────────────────────────────────────────

const saveScoreSchema = z.object({
  teamId: z.string().min(1),
  /** Keyed by ZoneInput id — the form is built from the series' definition,
   *  so this action has no idea what the movements are and does not need one. */
  values: z.record(z.string(), optionalInt),
});

/**
 * BFT MENA's console write: a whole team, every zone at once, which submits
 * and locks every zone. Judges score zone by zone from their own sheet
 * (saveZoneScore); studios do not enter scores at all.
 *
 *   * only BFT MENA holding `scores.enter` (canWriteScore, access.ts);
 *   * only before the score-entry cut-off and the wave's clock;
 *   * a submitted score is corrected by BFT MENA Full access only;
 *   * every changed movement is written to the audit log with who changed it.
 */
export async function saveScore(input: unknown): Promise<SaveScoreResult> {
  const user = await requireUser();
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = saveScoreSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { teamId, values } = parsed.data;

  const team = await prisma.team.findFirst({
    where: { id: teamId, ...teamScope(user) },
    include: {
      score: { include: { entries: true } },
      series: { select: { scoreEntryClosesAt: true } },
      waveRef: { select: { endsAt: true } },
    },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  const waveEnded = !!team.waveRef?.endsAt && team.waveRef.endsAt.getTime() <= Date.now();
  const permission = canWriteScore(user, team.series, new Date(), { ended: waveEnded });
  if (!permission.allowed) return { ok: false, error: permission.reason };
  if (team.score?.status === "submitted" && !can(user, "scores.correct")) {
    return { ok: false, error: "SCORE_LOCKED" };
  }

  // The definition is the authority on which movements exist and what each one
  // accepts. A value for an input that is not in this series is not a
  // validation failure — it is a value with nowhere to go, and is dropped.
  const zones = await getSeriesZones(team.seriesId);
  const known = new Set(allInputs(zones).map((inputDef) => inputDef.id));
  const next: Record<string, number | null> = {};
  for (const [inputId, value] of Object.entries(values)) {
    if (known.has(inputId)) next[inputId] = value;
  }

  const errors = validateEntries(zones, next);
  if (errors.length) return { ok: false, error: "INVALID_SCORE", fields: errors };

  const previous = new Map((team.score?.entries ?? []).map((entry) => [entry.inputId, entry.value]));

  await prisma.$transaction((tx) =>
    writeEntries(tx, {
      teamId,
      userId: user.id,
      zones,
      next,
      previous,
      submitZones: zones.map((zone) => zone.id),
    })
  );

  revalidateCompetitionViews();
  return { ok: true };
}

/**
 * BFT MENA Full access only (`scores.unlock`, never grantable): returns a
 * submitted score — and every one of its zones — to draft, so it leaves the
 * public board while a judging dispute is settled.
 */
export async function unlockScore(teamId: string): Promise<SaveScoreResult> {
  const user = await requireUser();
  if (user.viewAs || !can(user, "scores.unlock")) return { ok: false, error: "FORBIDDEN" };

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { score: true },
  });
  if (!team?.score) return { ok: false, error: "NOT_FOUND" };

  await prisma.$transaction([
    prisma.score.update({ where: { teamId }, data: { status: "draft" } }),
    prisma.zoneScore.updateMany({ where: { scoreId: team.score.id }, data: { status: "draft" } }),
    prisma.scoreAudit.create({
      data: {
        scoreId: team.score.id,
        field: "status",
        oldValue: "submitted",
        newValue: "draft",
        reason: "unlocked for correction",
        operatorId: user.id,
      },
    }),
  ]);

  await recordAudit({
    actorId: user.id,
    action: AUDIT.scoreUnlocked,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: "returned to draft, every zone reopened",
  });

  revalidateCompetitionViews();
  return { ok: true };
}
