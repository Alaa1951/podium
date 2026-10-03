"use server";

import { z } from "zod";

import { can, isFloorAccount } from "@/lib/access";
import { AUDIT, recordAudit } from "@/lib/audit";
import { MAX_STATIONS } from "@/lib/floor";
import { loadPermissions } from "@/lib/permissions/load";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireUser } from "@/lib/session";
import { canAssignZoneScorePost } from "@/lib/zone-sheet-access";

// ─────────────────────────────────────────────────────────────────────────────
// PUTTING PEOPLE ON ZONES.
//
//   • zoneStaff.assign (supervisor / organiser / BFT MENA) puts people on a
//     zone, picks its leaders, and moves or removes anyone.
//   • zoneStaff.assignJudges (the Zone Leaders role) staffs only the zones
//     the person LEADS — judges and reserves on, judges and reserves off;
//     leaders stay out of their reach.
//   • A zone's LEADER places the judges and reserves of their own zone on
//     stations 1–9 — and nothing else.
//   • Judge/reserve posts need the judge sheet. Leaders may instead carry
//     leader-only sheet access. Either kind also needs score entry.
// ─────────────────────────────────────────────────────────────────────────────

export type ZoneStaffResult = { ok: true; message?: string } | { ok: false; error: string };

const POSITIONS = ["leader", "judge", "reserve"] as const;

const addSchema = z.object({
  zoneId: z.string().min(1),
  userId: z.string().min(1),
  position: z.enum(POSITIONS).default("judge"),
});

/** Put a person on a zone (or change their position there). */
export async function addZoneStaff(input: unknown): Promise<ZoneStaffResult> {
  const actor = await requireUser();
  if (actor.viewAs || !isFloorAccount(actor)) return { ok: false, error: "FORBIDDEN" };

  const full = can(actor, "zoneStaff.assign");
  if (!full && !can(actor, "zoneStaff.assignJudges")) return { ok: false, error: "FORBIDDEN" };

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { zoneId, userId, position } = parsed.data;

  const [zone, person] = await Promise.all([
    prisma.zone.findUnique({ where: { id: zoneId }, select: { id: true, number: true, seriesId: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, status: true, archivedAt: true },
    }),
  ]);
  if (!zone || !person || person.status !== "active" || person.archivedAt) return { ok: false, error: "NOT_FOUND" };

  // A judges-only assigner staffs the zones they lead, and never appoints
  // leaders — that stays with zoneStaff.assign.
  if (!full) {
    if (position === "leader") return { ok: false, error: "FORBIDDEN" };
    const leads = await prisma.zoneStaff.count({ where: { zoneId, userId: actor.id, position: "leader" } });
    if (leads === 0) return { ok: false, error: "FORBIDDEN" };
    const existing = await prisma.zoneStaff.findUnique({
      where: { zoneId_userId: { zoneId, userId } },
      select: { position: true },
    });
    if (existing?.position === "leader") return { ok: false, error: "FORBIDDEN" };
  }

  // Leader-only sheet access qualifies for leader posts only.
  const theirs = await loadPermissions(person.id, person.role);
  if (!canAssignZoneScorePost({ role: person.role, permissions: theirs }, position)) {
    return { ok: false, error: "NOT_A_JUDGE" };
  }

  await prisma.zoneStaff.upsert({
    where: { zoneId_userId: { zoneId, userId } },
    create: { seriesId: zone.seriesId, zoneId, userId, position, assignedById: actor.id },
    update: { position, assignedById: actor.id },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.zoneStaffChanged,
    targetType: "event",
    targetId: zone.seriesId,
    targetLabel: `Zone ${zone.number}`,
    detail: `${person.email} → ${position}`,
  });
  revalidateCompetitionViews();
  return { ok: true };
}

const stationSchema = z.object({
  staffId: z.string().min(1),
  station: z.union([z.coerce.number().int().min(1).max(MAX_STATIONS), z.null()]),
});

/**
 * Place a judge or reserve on a station — the zone's leader does this for
 * their own zone; whoever assigns zone staff may do it anywhere. Several
 * people on one station is allowed (the screen warns).
 */
export async function setZoneStaffStation(input: unknown): Promise<ZoneStaffResult> {
  const actor = await requireUser();
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = stationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const row = await prisma.zoneStaff.findUnique({
    where: { id: parsed.data.staffId },
    select: { id: true, zoneId: true, seriesId: true, userId: true, position: true, zone: { select: { number: true } } },
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };

  let allowed = isFloorAccount(actor) && can(actor, "zoneStaff.assign");
  // A leader places their own zone's judges — while they still hold the sheet.
  if (!allowed && can(actor, "judgeSheet.view")) {
    const leads = await prisma.zoneStaff.count({
      where: { zoneId: row.zoneId, userId: actor.id, position: "leader" },
    });
    allowed = leads > 0;
  }
  if (!allowed) return { ok: false, error: "FORBIDDEN" };

  await prisma.zoneStaff.update({ where: { id: row.id }, data: { station: parsed.data.station } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.zoneStaffChanged,
    targetType: "event",
    targetId: row.seriesId,
    targetLabel: `Zone ${row.zone.number}`,
    detail: `staff ${row.userId} → station ${parsed.data.station ?? "none"}`,
  });
  revalidateCompetitionViews();
  return { ok: true };
}

/** Take a person off a zone. */
export async function removeZoneStaff(input: unknown): Promise<ZoneStaffResult> {
  const actor = await requireUser();
  if (actor.viewAs || !isFloorAccount(actor)) return { ok: false, error: "FORBIDDEN" };

  const full = can(actor, "zoneStaff.assign");
  if (!full && !can(actor, "zoneStaff.assignJudges")) return { ok: false, error: "FORBIDDEN" };

  const parsed = z.object({ staffId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const row = await prisma.zoneStaff.findUnique({
    where: { id: parsed.data.staffId },
    select: {
      id: true,
      seriesId: true,
      position: true,
      zoneId: true,
      zone: { select: { number: true } },
      user: { select: { email: true } },
    },
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };

  // Same reach as putting someone on: a judges-only assigner removes judges
  // and reserves from the zones they lead, and never a leader.
  if (!full) {
    if (row.position === "leader") return { ok: false, error: "FORBIDDEN" };
    const leads = await prisma.zoneStaff.count({ where: { zoneId: row.zoneId, userId: actor.id, position: "leader" } });
    if (leads === 0) return { ok: false, error: "FORBIDDEN" };
  }

  await prisma.zoneStaff.delete({ where: { id: row.id } });
  await recordAudit({
    actorId: actor.id,
    action: AUDIT.zoneStaffChanged,
    targetType: "event",
    targetId: row.seriesId,
    targetLabel: `Zone ${row.zone.number}`,
    detail: `${row.user.email} removed`,
  });
  revalidateCompetitionViews();
  return { ok: true };
}
