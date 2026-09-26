"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { alreadyEntered } from "@/lib/one-entry";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { isBft, requireAccess, teamScope } from "@/lib/session";
import { deletionGuard } from "@/lib/series-guard";
import { registrationOpen } from "@/lib/visibility";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { message?: string } : { message?: string; data: T }))
  | { ok: false; error: string };

// Who is on a team, and which studio each of them belongs to.

const athleteStudioSchema = z.object({
  competitorId: z.string().min(1),
  studioId: z.string().nullable(),
});

export async function setAthleteStudio(input: unknown): Promise<ActionResult> {
  const user = await requireAccess("registrations.edit");
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = athleteStudioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const competitor = await prisma.competitor.findFirst({
    where: { id: parsed.data.competitorId, team: teamScope(user) },
    select: { id: true, team: { select: { seriesId: true } } },
  });
  if (!competitor) return { ok: false, error: "NOT_FOUND" };

  // A studio can only mark someone as its own member or as a non-member.
  const studioId =
    user.role === "studio"
      ? parsed.data.studioId
        ? user.studioId
        : null
      : parsed.data.studioId;

  await prisma.competitor.update({ where: { id: competitor.id }, data: { studioId } });
  revalidateCompetitionViews();
  return { ok: true };
}

const studioSchema = z.object({ name: z.string().trim().min(2).max(80) });

export async function addStudio(formData: FormData): Promise<ActionResult> {
  const user = await requireAccess("studios.create");

  const parsed = studioSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { ok: false, error: "STUDIO_NAME_REQUIRED" };

  const existing = await prisma.studio.findFirst({
    where: { name: { equals: parsed.data.name } },
  });
  if (existing) return { ok: false, error: "STUDIO_EXISTS" };

  const studio = await prisma.studio.create({ data: { name: parsed.data.name } });

  await recordAudit({
    actorId: user.id,
    action: AUDIT.studioAdded,
    targetType: "studio",
    targetId: studio.id,
    targetLabel: studio.name,
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `${parsed.data.name} added to the studio list.` };
}

/**
 * Withdraw a registration — an ARCHIVE, never a hard delete.
 *
 * The row (and the money and score history behind it) stays restorable; every
 * board, list and report simply stops showing it. Deletions are allowed only
 * while the event is scheduled: once it is on the floor nothing may vanish
 * from a live board, and once it is finished the field is the record itself.
 */
export async function archiveTeam(teamId: string): Promise<ActionResult> {
  const user = await requireAccess("registrations.archive");
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const team = await prisma.team.findFirst({
    where: { id: teamId, archivedAt: null, ...teamScope(user) },
    include: {
      score: { select: { status: true } },
      series: { select: { registrationClosesAt: true, status: true } },
    },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  // A live or finished event is locked: nothing may be removed from it.
  const phase = deletionGuard(team.series.status);
  if (!phase.allowed) return { ok: false, error: phase.reason };

  // Once registrations close, a withdrawal is BFT MENA's to make — the field
  // and the wave plan are built on the entry list at that moment.
  const deadline = registrationOpen({
    role: user.role,
    registrationClosesAt: team.series.registrationClosesAt,
    now: new Date(),
  });
  if (!deadline.open) return { ok: false, error: deadline.reason };

  // A submitted score is a result; withdrawing a scored team is BFT MENA's call.
  if (team.score?.status === "submitted" && !isBft(user)) {
    return { ok: false, error: "TEAM_ALREADY_SCORED" };
  }

  // A withdrawn team gives its station back to the wave.
  await prisma.team.update({
    where: { id: team.id },
    data: { archivedAt: new Date(), station: null },
  });

  await recordAudit({
    actorId: user.id,
    action: AUDIT.teamArchived,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: "archived (withdrawn) — restorable",
  });

  revalidateCompetitionViews();
  return { ok: true, message: "Registration archived." };
}

/**
 * Bring an archived registration back — BFT MENA only, and only while the
 * competition has not started (the same window archiving has). A withdrawn
 * pair may have entered again since: restoring would then make them a
 * second entry, so that is refused.
 */
export async function restoreTeam(seriesId: string, teamId: string): Promise<ActionResult> {
  const actor = await requireAccess("registrations.archive");
  if (actor.viewAs || !isBft(actor)) return { ok: false, error: "FORBIDDEN" };

  const team = await prisma.team.findFirst({
    where: { id: teamId, seriesId, NOT: { archivedAt: null } },
    select: {
      id: true,
      seriesId: true,
      number: true,
      name: true,
      series: { select: { status: true } },
      competitors: { select: { userId: true, email: true } },
    },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  const phase = deletionGuard(team.series.status);
  if (!phase.allowed) return { ok: false, error: phase.reason };

  const again = await alreadyEntered({
    seriesId: team.seriesId,
    userIds: team.competitors.map((person) => person.userId),
    emails: team.competitors.map((person) => person.email),
  });
  if (again) return { ok: false, error: "ALREADY_ENTERED" };

  await prisma.team.update({ where: { id: team.id }, data: { archivedAt: null } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.teamRestored,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: "restored from the archive",
  });

  revalidateCompetitionViews();
  return { ok: true, message: "Registration restored." };
}
