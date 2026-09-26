"use server";

import { z } from "zod";

import { can } from "@/lib/access";
import { AUDIT, recordAudit } from "@/lib/audit";
import { MAX_STATIONS } from "@/lib/floor";
import { loadPermissions } from "@/lib/permissions/load";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireUser } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// PUTTING PEOPLE ON ZONES.
//
//   • zoneStaff.assign (supervisor / organiser / BFT MENA) puts people on a
//     zone, picks its leader, and moves or removes anyone.
//   • A zone's LEADER places the judges and reserves of their own zone on
//     stations 1–9 — and nothing else.
//   • Only people whose roles carry the judge sheet can be put on a zone.
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
  if (actor.viewAs || !can(actor, "zoneStaff.assign")) return { ok: false, error: "FORBIDDEN" };

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

  // Only a judge can judge: the role has to carry the sheet and score entry.
  const theirs = await loadPermissions(person.id, person.role);
  const judges = person.role === "admin" || (theirs.includes("judgeSheet.view") && theirs.includes("scores.enter"));
  if (!judges) return { ok: false, error: "NOT_A_JUDGE" };

  await prisma.$transaction(async (tx) => {
    // One leader per zone: appointing a new one makes the old one a judge.
    if (position === "leader") {
      await tx.zoneStaff.updateMany({
        where: { zoneId, position: "leader", NOT: { userId } },
        data: { position: "judge" },
      });
    }
    await tx.zoneStaff.upsert({
      where: { zoneId_userId: { zoneId, userId } },
      create: { seriesId: zone.seriesId, zoneId, userId, position, assignedById: actor.id },
      update: { position, assignedById: actor.id },
    });
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

  let allowed = can(actor, "zoneStaff.assign");
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
  if (actor.viewAs || !can(actor, "zoneStaff.assign")) return { ok: false, error: "FORBIDDEN" };

  const parsed = z.object({ staffId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const row = await prisma.zoneStaff.findUnique({
    where: { id: parsed.data.staffId },
    select: { id: true, seriesId: true, zone: { select: { number: true } }, user: { select: { email: true } } },
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };

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
