"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { notifyBoardChanged } from "@/lib/board-events";
import { waveOnDuty, zoneArrival, zoneScoreEntryClosesAt } from "@/lib/floor";
import { loadPermissions } from "@/lib/permissions/load";
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
  .transform((value, ctx) => {
    if (value === null || value === "" || value === undefined) return null;
    const n = Number(value);
    if (!Number.isSafeInteger(n) || (typeof value === "string" && !value.trim())) {
      ctx.addIssue({ code: "custom", message: "Expected a whole number" });
      return z.NEVER;
    }
    return n;
  });

export type SaveScoreResult =
  | { ok: true; revision?: string }
  | { ok: false; error: string; fields?: { inputId: string; code: string }[] };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

class ScoreWriteRefused extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Serialize every score write and unlock on the team row, including a team's
 * first score. Read locks, values and completeness only after that lock: a
 * counter request waiting behind a submission must never rewrite its zone.
 * `complete` submits each complete open zone; an explicit zone must be complete.
 */
async function writeEntries(
  tx: Tx,
  params: {
    teamId: string;
    userId: string;
    zones: ZoneDef[];
    next: Record<string, number | null>;
    canCorrect: boolean;
    targetZoneId?: string;
    submitZones: string[] | "complete";
    /** Floor permissions and clocks must be checked after waiting for Team. */
    authorize?: () => Promise<void>;
  }
) {
  await tx.$queryRaw`SELECT id FROM Team WHERE id = ${params.teamId} FOR UPDATE`;
  await params.authorize?.();
  const current = await tx.score.findUnique({
    where: { teamId: params.teamId },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      entries: { select: { inputId: true, value: true } },
      zones: { select: { zoneId: true, status: true } },
    },
  });
  const previous = new Map((current?.entries ?? []).map((entry) => [entry.inputId, entry.value]));
  const lockedZones = new Set((current?.zones ?? []).filter((zone) => zone.status === "submitted").map((zone) => zone.zoneId));
  const next = { ...params.next };
  if (!params.canCorrect) {
    if (current?.status === "submitted" || (params.targetZoneId && lockedZones.has(params.targetZoneId))) {
      throw new ScoreWriteRefused("SCORE_LOCKED");
    }
    // The desktop grid sends unchanged locked fields too. Keep those zones'
    // original submitter and values; reject any attempt to change them.
    for (const zone of params.zones) {
      if (!lockedZones.has(zone.id)) continue;
      for (const inputDef of zone.inputs) {
        if (!(inputDef.id in next)) continue;
        if ((next[inputDef.id] ?? null) !== (previous.get(inputDef.id) ?? null)) throw new ScoreWriteRefused("SCORE_LOCKED");
        delete next[inputDef.id];
      }
    }
  }

  const merged = Object.fromEntries(
    allInputs(params.zones).map((inputDef) => [inputDef.id, inputDef.id in next ? next[inputDef.id] : previous.get(inputDef.id) ?? null])
  );
  const submitZones = params.submitZones === "complete"
    ? params.zones.filter((zone) => !lockedZones.has(zone.id) && isComplete([zone], merged)).map((zone) => zone.id)
    : params.submitZones;
  for (const zoneId of submitZones) {
    const zone = params.zones.find((zone) => zone.id === zoneId);
    if (!zone || !isComplete([zone], merged)) throw new ScoreWriteRefused("INCOMPLETE");
  }

  const known = new Map(allInputs(params.zones).map((input) => [input.id, input]));
  // One strictly increasing revision for the whole transaction. A delayed
  // sheet refresh must never replace values acknowledged by a newer save.
  const revision = new Date(Math.max(Date.now(), (current?.updatedAt?.getTime() ?? 0) + 1));
  const score = await tx.score.upsert({
    where: { teamId: params.teamId },
    create: { teamId: params.teamId, status: "draft", updatedAt: revision },
    update: { updatedAt: revision },
  });

  for (const [inputId, value] of Object.entries(next)) {
    await tx.zoneEntry.upsert({
      where: { scoreId_inputId: { scoreId: score.id, inputId } },
      create: { scoreId: score.id, inputId, value },
      update: { value },
    });
  }

  const changed = Object.keys(next).filter(
    (inputId) => (previous.get(inputId) ?? null) !== (next[inputId] ?? null)
  );
  if (changed.length) {
    await tx.scoreAudit.createMany({
      data: changed.map((inputId) => ({
        scoreId: score.id,
        // The movement's label, not its id — an audit line has to be readable
        // a year later, when the id means nothing to anyone.
        field: known.get(inputId)?.label ?? inputId,
        oldValue: previous.get(inputId) == null ? null : String(previous.get(inputId)),
        newValue: next[inputId] === null ? null : String(next[inputId]),
        operatorId: params.userId,
      })),
    });
  }

  const now = new Date();
  for (const zoneId of submitZones) {
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
      data: { status: "submitted", submittedAt: now, submittedById: params.userId, updatedAt: revision },
    });
  }
  return { changed: changed.length, revision: revision.toISOString() };
}

// ── One zone, from the judge sheet ───────────────────────────────────────────

const saveZoneSchema = z.object({
  teamId: z.string().min(1),
  zoneId: z.string().min(1),
  /** Keyed by ZoneInput id; only this zone's inputs are kept. */
  values: z.record(z.string(), optionalInt),
  /** Submit locks the zone. A zone can only be submitted complete. */
  submit: z.boolean().default(false),
  /** A live counter write needs no refresh of the judge's whole sheet. */
  autosave: z.boolean().default(false),
  /** A card from a previous Reset/start must not score the new run. */
  waveStartedAt: z.string().datetime().optional(),
});

/**
 * A judge's write: one zone of one team. Everything that decides it is
 * re-read from the database — the judge's post on this zone, the team's
 * station, whether its wave has reached the zone and is the wave the zone is
 * on (floor.ts › zoneArrival, waveOnDuty — the same rules the judge sheet
 * shows by), whether the zone is already locked — and handed to
 * canWriteZoneScore (zone-score-rules.ts).
 */
export async function saveZoneScore(input: unknown): Promise<SaveScoreResult> {
  const user = await requireUser();
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = saveZoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { teamId, zoneId, values, submit, autosave, waveStartedAt } = parsed.data;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      seriesId: true,
      station: true,
      archivedAt: true,
      series: { select: { status: true, scoreEntryClosesAt: true } },
      waveId: true,
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

  const [post, timing, inScope, started] = await Promise.all([
    prisma.zoneStaff.findUnique({
      where: { zoneId_userId: { zoneId, userId: user.id } },
      select: { position: true, station: true },
    }),
    floorTimingFor(team.seriesId),
    prisma.team.count({ where: { id: team.id, ...teamScope(user) } }),
    // Every wave that has been on the floor: which one this zone is ON is a
    // question about all of them, not only this team's.
    prisma.wave.findMany({
      where: { seriesId: team.seriesId, NOT: { startedAt: null } },
      select: { id: true, status: true, startedAt: true, endsAt: true },
    }),
  ]);

  const now = new Date();
  const wave = started.find((row) => row.id === team.waveId) ?? null;
  const reached = !!wave && zoneArrival(wave, zoneIndex, timing, now) !== null;
  const onDuty = !!wave && waveOnDuty(started, zoneIndex, timing, now)?.id === wave.id;

  const decision = canWriteZoneScore({
    user,
    post,
    team: { station: team.station },
    seriesStatus: team.series.status,
    reached,
    onDuty,
    zoneSubmitted: team.score?.zones.some((row) => row.zoneId === zoneId && row.status === "submitted") ?? false,
    entryClosed: !!team.series.scoreEntryClosesAt && now >= team.series.scoreEntryClosesAt,
    waveEnded: !!wave?.endsAt && wave.endsAt <= now,
    zoneEntryClosed: !!wave && (wave.status === "complete" || (zoneScoreEntryClosesAt(wave, zoneIndex, timing)?.getTime() ?? Infinity) <= now.getTime()),
  });
  if (!decision.allowed) return { ok: false, error: decision.reason };
  if (decision.as === "console" && !inScope) return { ok: false, error: "FORBIDDEN" };
  if ((decision.as === "leader" || decision.as === "judge") && waveStartedAt && wave?.startedAt?.toISOString() !== waveStartedAt) {
    return { ok: false, error: "WAVE_RESTARTED" };
  }

  // Only this zone's inputs; anything else in the request is dropped.
  const next: Record<string, number | null> = {};
  for (const inputDef of zone.inputs) {
    if (inputDef.id in values) next[inputDef.id] = values[inputDef.id] ?? null;
  }
  const errors = validateEntries([zone], next);
  if (errors.length) return { ok: false, error: "INVALID_SCORE", fields: errors };

  let revision: string | undefined;
  try {
    const written = await prisma.$transaction(async (tx) => {
      const floorWriter = decision.as === "leader" || decision.as === "judge";
      // Wave transitions lock Wave before Team. Use the same order; once
      // those locks are held, an End now or Reset cannot cross this write.
      if (floorWriter && team.waveId) await tx.$queryRaw`SELECT id FROM Wave WHERE id = ${team.waveId} FOR UPDATE`;
      return writeEntries(tx, {
        teamId, userId: user.id, zones, next,
        canCorrect: can(user, "scores.correct"), targetZoneId: zoneId, submitZones: submit ? [zoneId] : [],
        authorize: floorWriter ? async () => {
          const fresh = await tx.team.findUnique({
            where: { id: teamId },
            select: { waveId: true, seriesId: true, station: true, archivedAt: true,
              series: { select: { status: true, archivedAt: true, scoreEntryClosesAt: true } } },
          });
          if (!fresh || fresh.archivedAt || fresh.series.archivedAt) throw new ScoreWriteRefused("NOT_FOUND");
          if (fresh.waveId !== team.waveId || fresh.seriesId !== team.seriesId) throw new ScoreWriteRefused("FORBIDDEN");
          const [permissions, freshPost, freshTiming, freshWaves] = await Promise.all([
            loadPermissions(user.id, user.role, tx),
            tx.zoneStaff.findUnique({ where: { zoneId_userId: { zoneId, userId: user.id } }, select: { position: true, station: true } }),
            floorTimingFor(fresh.seriesId, tx),
            tx.wave.findMany({ where: { seriesId: fresh.seriesId, NOT: { startedAt: null } }, select: { id: true, status: true, startedAt: true, endsAt: true } }),
          ]);
          const checkedAt = new Date();
          const freshWave = freshWaves.find((row) => row.id === fresh.waveId);
          if (freshWave?.startedAt?.getTime() !== wave?.startedAt?.getTime()) throw new ScoreWriteRefused("WAVE_RESTARTED");
          const closesAt = freshWave ? zoneScoreEntryClosesAt(freshWave, zoneIndex, freshTiming) : null;
          const freshDecision = canWriteZoneScore({
            user: { ...user, permissions }, post: freshPost, team: fresh,
            seriesStatus: fresh.series.status,
            reached: !!freshWave && zoneArrival(freshWave, zoneIndex, freshTiming, checkedAt) !== null,
            onDuty: !!freshWave && waveOnDuty(freshWaves, zoneIndex, freshTiming, checkedAt)?.id === freshWave.id,
            zoneSubmitted: false, // writeEntries reads the submit locks next.
            entryClosed: !!fresh.series.scoreEntryClosesAt && checkedAt >= fresh.series.scoreEntryClosesAt,
            waveEnded: !!freshWave?.endsAt && freshWave.endsAt <= checkedAt,
            zoneEntryClosed: !!freshWave && (freshWave.status === "complete" || !!closesAt && checkedAt >= closesAt),
          });
          if (!freshDecision.allowed) throw new ScoreWriteRefused(freshDecision.reason);
        } : undefined,
      });
    }, { isolationLevel: "ReadCommitted" });
    revision = written.revision;
  } catch (error) {
    if (error instanceof ScoreWriteRefused) return { ok: false, error: error.code };
    throw error;
  }
  notifyBoardChanged(team.seriesId);

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

  if (!autosave || submit) revalidateCompetitionViews();
  return autosave ? { ok: true, revision } : { ok: true };
}

// ── A whole team, from the console ───────────────────────────────────────────

const saveScoreSchema = z.object({
  teamId: z.string().min(1),
  /** Keyed by ZoneInput id — the form is built from the series' definition,
   *  so this action has no idea what the movements are and does not need one. */
  values: z.record(z.string(), optionalInt),
  /** Keep counting after a complete zone: only an explicit submit locks it. */
  autosave: z.boolean().default(false),
});

/**
 * BFT MENA's console write: a whole team at once. Every zone the write leaves
 * COMPLETE is submitted and locked; a zone still missing a value stays open
 * for its judges. Judges score zone by zone from their own sheet
 * (saveZoneScore); studios, organisers and athletes do not write here at all.
 *
 *   * only BFT MENA holding `scores.enter` (canWriteScore, access.ts);
 *   * a zone a judge has submitted is not rewritten (Full access corrects);
 *   * only before the score-entry cut-off and the wave's clock;
 *   * a submitted score is corrected by BFT MENA Full access only;
 *   * every changed movement is written to the audit log with who changed it.
 */
export async function saveScore(input: unknown): Promise<SaveScoreResult> {
  const user = await requireUser();
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = saveScoreSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { teamId, values, autosave } = parsed.data;

  const team = await prisma.team.findFirst({
    where: { id: teamId, ...teamScope(user) },
    include: {
      score: { include: { entries: true, zones: { select: { zoneId: true, status: true } } } },
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

  try {
    await prisma.$transaction((tx) => writeEntries(tx, {
      teamId, userId: user.id, zones, next,
      canCorrect: can(user, "scores.correct"), submitZones: autosave ? [] : "complete",
    }));
  } catch (error) {
    if (error instanceof ScoreWriteRefused) return { ok: false, error: error.code };
    throw error;
  }

  notifyBoardChanged(team.seriesId);
  if (!autosave) revalidateCompetitionViews();
  return { ok: true };
}

/**
 * BFT MENA Full access only (`scores.unlock`, never grantable): returns a
 * submitted score — and every one of its zones — to draft for correction.
 * The team STAYS on the board: each zone keeps the time it was first submitted
 * (`submittedAt`), which is what the board reads (board-score.ts), so the
 * ranking holds while the correction is made and moves the moment it is saved.
 */
export async function unlockScore(teamId: string): Promise<SaveScoreResult> {
  const user = await requireUser();
  if (user.viewAs || !can(user, "scores.unlock")) return { ok: false, error: "FORBIDDEN" };

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { score: true },
  });
  if (!team?.score) return { ok: false, error: "NOT_FOUND" };

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Team WHERE id = ${teamId} FOR UPDATE`;
    const current = await tx.score.findUnique({ where: { teamId }, select: { updatedAt: true } });
    const revision = new Date(Math.max(Date.now(), (current?.updatedAt?.getTime() ?? 0) + 1));
    await tx.score.update({ where: { teamId }, data: { status: "draft", updatedAt: revision } });
    await tx.zoneScore.updateMany({ where: { scoreId: team.score!.id }, data: { status: "draft" } });
    await tx.scoreAudit.create({
      data: {
        scoreId: team.score!.id,
        field: "status",
        oldValue: "submitted",
        newValue: "draft",
        reason: "unlocked for correction",
        operatorId: user.id,
      },
    });
  });

  await recordAudit({
    actorId: user.id,
    action: AUDIT.scoreUnlocked,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: "returned to draft, every zone reopened",
  });

  notifyBoardChanged(team.seriesId);
  revalidateCompetitionViews();
  return { ok: true };
}
