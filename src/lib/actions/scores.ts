"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { getSeriesZones } from "@/lib/queries";
import { canWriteScore, requireUser } from "@/lib/session";
import { allInputs, validateEntries } from "@/lib/zones";

const optionalInt = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === "" || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  });

const saveScoreSchema = z.object({
  teamId: z.string().min(1),
  /** Keyed by ZoneInput id — the form is built from the series' definition,
   *  so this action has no idea what the movements are and does not need one. */
  values: z.record(z.string(), optionalInt),
});

export type SaveScoreResult =
  | { ok: true }
  | { ok: false; error: string; fields?: { inputId: string; code: string }[] };

/**
 * Writes a score. Authorization is re-derived here from the database — the
 * client's idea of who it is and what it may edit is never trusted:
 *
 *   * a studio may only touch its own teams, and only while this series lets
 *     studios enter scores at all;
 *   * only before the series' score-entry cut-off, and only within its edit
 *     budget (the BFT manual's default is that a saved score is final);
 *   * BFT MENA may correct anything, at any time;
 *   * every changed movement is written to the audit log with who changed it.
 *
 * The movements themselves come from the series' zone definition, so adding a
 * zone changes nothing in this file.
 */
export async function saveScore(input: unknown): Promise<SaveScoreResult> {
  const user = await requireUser();

  const parsed = saveScoreSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const { teamId, values } = parsed.data;

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      score: { include: { entries: true } },
      // The series carries all three rules that gate this write, so they are
      // read from the row being written rather than from anything the client
      // sent or the page happened to render with.
      series: {
        select: {
          studiosMayEnterScores: true,
          studioScoreCorrections: true,
          scoreEntryClosesAt: true,
        },
      },
      waveRef: { select: { endsAt: true } },
    },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  // A wave whose clock has run out is closed: judges and studios are locked
  // out of its scores, and the wave-scorer grant below does not rescue them —
  // only the after-close permission (or a full admin) gets past this.
  const waveEnded =
    !!team.waveRef?.endsAt && team.waveRef.endsAt.getTime() <= Date.now();

  const permission = canWriteScore(user, team, team.series, new Date(), {
    ended: waveEnded,
  });
  if (!permission.allowed) {
    if (permission.reason === "WAVE_CLOCK_ENDED") {
      return { ok: false, error: permission.reason };
    }
    // Fall through to the wave-scorer grant: an explicit, per-wave staff
    // permission that outranks the studio rules — it is how judges and
    // recorders are put on the floor at all. It covers exactly the teams of
    // the granted wave, and nothing else.
    const granted = await prisma.waveAccess.findFirst({
      where: {
        userId: user.id,
        wave: { seriesId: team.seriesId, number: team.wave },
      },
      select: { id: true },
    });
    if (!granted) return { ok: false, error: permission.reason };
  }

  // The definition is the authority on which movements exist and what each one
  // accepts. A value for an input that is not in this series is not a
  // validation failure — it is a value with nowhere to go, and is dropped.
  const zones = await getSeriesZones(team.seriesId);
  const known = new Map(allInputs(zones).map((input) => [input.id, input]));

  const next: Record<string, number | null> = {};
  for (const [inputId, value] of Object.entries(values)) {
    if (known.has(inputId)) next[inputId] = value;
  }

  const errors = validateEntries(zones, next);
  if (errors.length) return { ok: false, error: "INVALID_SCORE", fields: errors };

  const previous = new Map(
    (team.score?.entries ?? []).map((entry) => [entry.inputId, entry.value])
  );

  const changed = Object.keys(next).filter(
    (inputId) => (previous.get(inputId) ?? null) !== (next[inputId] ?? null)
  );

  // Saving with nothing changed still counts as nothing — it must not burn a
  // studio's one correction.
  if (!changed.length && team.score?.status === "submitted") {
    return { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    const score = await tx.score.upsert({
      where: { teamId },
      create: {
        teamId,
        status: "submitted",
        submittedAt: new Date(),
        submittedById: user.id,
      },
      update: {
        status: "submitted",
        submittedAt: team.score?.submittedAt ?? new Date(),
        submittedById: user.id,
      },
    });

    for (const [inputId, value] of Object.entries(next)) {
      await tx.zoneEntry.upsert({
        where: { scoreId_inputId: { scoreId: score.id, inputId } },
        create: { scoreId: score.id, inputId, value },
        update: { value },
      });
    }

    if (changed.length) {
      await tx.scoreAudit.createMany({
        data: changed.map((inputId) => ({
          scoreId: score.id,
          // The movement's label, not its id — an audit line has to be
          // readable a year later, when the id means nothing to anyone.
          field: known.get(inputId)?.label ?? inputId,
          oldValue: previous.get(inputId) === null || previous.get(inputId) === undefined
            ? null
            : String(previous.get(inputId)),
          newValue: next[inputId] === null ? null : String(next[inputId]),
          operatorId: user.id,
        })),
      });
    }

    // The edit budget is a stored counter, so the limit survives a reload,
    // a second tab, or a request that skips the UI entirely.
    await tx.team.update({
      where: { id: teamId },
      data: { scoreEdits: { increment: 1 } },
    });
  });

  revalidateCompetitionViews();
  return { ok: true };
}

/**
 * BFT MENA only: returns a submitted score to draft so it leaves the public
 * board while a judging dispute is settled.
 */
export async function unlockScore(teamId: string): Promise<SaveScoreResult> {
  const user = await requireUser();
  if (user.role !== "admin") return { ok: false, error: "FORBIDDEN" };

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { score: true },
  });
  if (!team?.score) return { ok: false, error: "NOT_FOUND" };

  await prisma.$transaction([
    prisma.score.update({ where: { teamId }, data: { status: "draft" } }),
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
    prisma.team.update({ where: { id: teamId }, data: { scoreEdits: 0 } }),
  ]);

  await recordAudit({
    actorId: user.id,
    action: AUDIT.scoreUnlocked,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: "returned to draft; edit budget reset",
  });

  revalidateCompetitionViews();
  return { ok: true };
}
