"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireAccess } from "@/lib/session";
import { deletionGuard } from "@/lib/series-guard";
import { DEFAULT_ZONES } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────────────────────
// EDITING THE SCORING DEFINITION.
//
// This is the part that used to be code. A zone, its movements and what each
// unit is worth are rows, and BFT MENA changes them here — which re-scores
// every team that ever recorded that movement, because points are derived and
// never stored.
//
// That is also why these are the most dangerous writes in the system: changing
// a factor mid-event changes a published total. Every one is audited with what
// it was and what it became.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const inputSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(16).default(""),
  multiplyBy: z.coerce.number().int().min(1).max(100_000),
  divideBy: z.coerce.number().int().min(1).max(100_000),
  maxValue: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === "" || value === undefined) return null;
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }),
  /** How the field is DRAWN. It changes no arithmetic — see ZoneInputMode. */
  inputMode: z.enum(["number", "minutes", "seconds"]).default("number"),
});

const zoneSchema = z.object({
  seriesId: z.string().min(1),
  zoneId: z.string().optional(),
  number: z.coerce.number().int().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  inputs: z.array(inputSchema).min(1).max(12),
});

/** Create or rewrite one zone and its movements. */
export async function saveZone(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("settings.edit");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = zoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId, zoneId, number, name, inputs } = parsed.data;

  const clash = await prisma.zone.findFirst({
    where: { seriesId, number, ...(zoneId ? { NOT: { id: zoneId } } : {}) },
    select: { id: true },
  });
  if (clash) return { ok: false, error: "ZONE_NUMBER_TAKEN" };

  const before = zoneId
    ? await prisma.zone.findUnique({
        where: { id: zoneId },
        include: { inputs: { orderBy: { position: "asc" } } },
      })
    : null;
  // The zone, and every movement being updated, must belong to THIS
  // competition's zone — ids from the request are not trusted to.
  if (zoneId && (!before || before.seriesId !== seriesId)) return { ok: false, error: "NOT_FOUND" };
  const own = new Set(before?.inputs.map((one) => one.id) ?? []);
  if (inputs.some((movement) => movement.id && !own.has(movement.id))) return { ok: false, error: "INVALID_INPUT" };

  // Once a competition has started, removing a movement would delete the
  // scores recorded against it — rewriting results, not correcting them.
  // Labels and factors may still change (that is recorded in the audit log).
  const series = await prisma.series.findUnique({ where: { id: seriesId }, select: { status: true, archivedAt: true } });
  if (!series || series.archivedAt) return { ok: false, error: "NOT_FOUND" };
  if (before && series.status !== "scheduled") {
    const keepIds = new Set(inputs.map((movement) => movement.id).filter(Boolean));
    const removed = before.inputs.filter((one) => !keepIds.has(one.id)).map((one) => one.id);
    if (removed.length && (await prisma.zoneEntry.count({ where: { inputId: { in: removed }, value: { not: null } } }))) {
      return { ok: false, error: "MOVEMENT_HAS_SCORES" };
    }
  }

  await prisma.$transaction(async (tx) => {
    const zone = zoneId
      ? await tx.zone.update({ where: { id: zoneId }, data: { number, name } })
      : await tx.zone.create({ data: { seriesId, number, name } });

    // Movements that were removed from the form are removed from the zone.
    // Their recorded values go with them — a movement nobody measured is not
    // a movement with a blank score, and leaving orphans would quietly keep
    // scoring a station that no longer exists.
    const keep = inputs.map((i) => i.id).filter(Boolean) as string[];
    await tx.zoneInput.deleteMany({
      where: { zoneId: zone.id, ...(keep.length ? { id: { notIn: keep } } : {}) },
    });

    for (const [index, movement] of inputs.entries()) {
      const fields = {
        position: index + 1,
        label: movement.label,
        unit: movement.unit,
        multiplyBy: movement.multiplyBy,
        divideBy: movement.divideBy,
        maxValue: movement.maxValue,
        inputMode: movement.inputMode,
      };

      if (movement.id) {
        await tx.zoneInput.update({ where: { id: movement.id }, data: fields });
      } else {
        await tx.zoneInput.create({ data: { zoneId: zone.id, ...fields } });
      }
    }
  });

  // What changed, in words — so a disputed total can be traced to the edit
  // that caused it rather than to a row of ids.
  const describe = (
    list: { label: string; multiplyBy: number; divideBy: number }[]
  ) => list.map((i) => `${i.label} ×${i.multiplyBy}÷${i.divideBy}`).join(", ");

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.zoneChanged,
    targetType: "event",
    targetId: seriesId,
    targetLabel: `Zone ${number} ${name}`,
    detail: before
      ? `${describe(before.inputs)} → ${describe(inputs)}`
      : `created: ${describe(inputs)}`,
  });

  revalidateCompetitionViews();
  return { ok: true };
}

/** Remove a zone. Its recorded values go with it. */
export async function deleteZone(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("settings.edit");

  const parsed = z.object({ zoneId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const zone = await prisma.zone.findUnique({
    where: { id: parsed.data.zoneId },
    select: {
      id: true,
      seriesId: true,
      number: true,
      name: true,
      series: { select: { status: true } },
      _count: { select: { inputs: true } },
    },
  });
  if (!zone) return { ok: false, error: "NOT_FOUND" };

  // The zone definition IS the scoring. Once an event has started, removing a
  // zone would rewrite history rather than correct it — locked like every
  // other deletion.
  const phase = deletionGuard(zone.series.status);
  if (!phase.allowed) return { ok: false, error: phase.reason };

  const recorded = await prisma.zoneEntry.count({ where: { input: { zoneId: zone.id } } });

  await prisma.zone.delete({ where: { id: zone.id } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.zoneChanged,
    targetType: "event",
    targetId: zone.seriesId,
    targetLabel: `Zone ${zone.number} ${zone.name}`,
    detail: `deleted, discarding ${recorded} recorded value(s)`,
  });

  revalidateCompetitionViews();
  return { ok: true, message: `Zone ${zone.number} removed.` };
}

/**
 * Give a series that has no zones the Series 1 table to start from. Refuses on
 * a series that already has one, so it can never wipe an edited definition.
 */
export async function seedDefaultZones(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("settings.edit");

  const parsed = z.object({ seriesId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { seriesId } = parsed.data;

  if ((await prisma.zone.count({ where: { seriesId } })) > 0) {
    return { ok: false, error: "ALREADY_DEFINED" };
  }

  for (const definition of DEFAULT_ZONES) {
    await prisma.zone.create({
      data: {
        seriesId,
        number: definition.number,
        name: definition.name,
        inputs: { create: definition.inputs.map((movement) => ({ ...movement })) },
      },
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.zoneChanged,
    targetType: "event",
    targetId: seriesId,
    targetLabel: "All zones",
    detail: `started from the Series 1 table (${DEFAULT_ZONES.length} zones)`,
  });

  revalidateCompetitionViews();
  return { ok: true, message: "Starting definition written." };
}
