"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, DIVISIONS, normalizeName } from "@/lib/scoring";
import { canRegisterTeams, requireRole, requireUser, teamScope } from "@/lib/session";
import { deletionGuard } from "@/lib/series-guard";
import { registrationOpen } from "@/lib/visibility";
import { nextTeamNumber } from "@/lib/actions/teams";
import { resolveOwningStudio } from "@/lib/team-scope";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { message?: string } : { message?: string; data: T }))
  | { ok: false; error: string };

// Who is on a team, and which studio each of them belongs to.

const athleteStudioSchema = z.object({
  competitorId: z.string().min(1),
  studioId: z.string().nullable(),
});

export async function setAthleteStudio(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (!canRegisterTeams(user)) return { ok: false, error: "FORBIDDEN" };

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
  revalidatePath(`/e/${competitor.team.seriesId}`, "layout");
  return { ok: true };
}

const studioSchema = z.object({ name: z.string().trim().min(2).max(80) });

export async function addStudio(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role !== "admin") return { ok: false, error: "FORBIDDEN" };

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

const importSchema = z.object({
  seriesId: z.string().min(1),
  text: z.string().max(200_000),
});

/**
 * Bulk import from the registration export, one team per line:
 *   Team name, Competitor 1, Competitor 2, Category, Division, Studio 1, Studio 2
 * A line with an unknown category or division is skipped and counted rather
 * than guessed at.
 */
export async function importTeams(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (!canRegisterTeams(user)) return { ok: false, error: "FORBIDDEN" };

  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const studios = await prisma.studio.findMany({ select: { id: true, name: true } });
  const studioByName = new Map(studios.map((s) => [s.name.toLowerCase(), s.id]));

  const lines = parsed.data.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let number = await nextTeamNumber(parsed.data.seriesId);
  let added = 0;
  let skipped = 0;

  for (const line of lines) {
    const cells = line.split(",").map((c) => c.trim());
    const category = CATEGORIES.find((c) => c.toLowerCase() === (cells[3] || "").toLowerCase());
    const division = DIVISIONS.find((d) => d.toLowerCase() === (cells[4] || "").toLowerCase());

    if (!cells[0] || !category || !division) {
      skipped++;
      continue;
    }

    const studioFor = (value: string | undefined) =>
      user.role === "studio"
        ? value && value.toLowerCase() !== "non-member"
          ? user.studioId
          : null
        : (studioByName.get((value || "").toLowerCase()) ?? null);

    const competitorNames = [cells[1] || "TBC", cells[2] || "TBC"];
    const competitorStudios = [studioFor(cells[5]), studioFor(cells[6])];

    await prisma.team.create({
      data: {
        seriesId: parsed.data.seriesId,
        number: number++,
        name: cells[0].toUpperCase(),
        category,
        division,
        studioId: resolveOwningStudio(user, competitorStudios[0] ?? competitorStudios[1] ?? null),
        competitors: {
          create: competitorNames.map((fullName, index) => ({
            fullName,
            position: index + 1,
            normalizedName: normalizeName(fullName),
            studioId: competitorStudios[index],
          })),
        },
      },
    });
    added++;
  }

  revalidatePath(`/e/${parsed.data.seriesId}`, "layout");
  return {
    ok: true,
    message:
      `${added} team(s) imported` +
      (skipped ? `, ${skipped} line(s) skipped — check category and division spelling.` : "."),
  };
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
  const user = await requireUser();
  if (!canRegisterTeams(user)) return { ok: false, error: "FORBIDDEN" };

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
  if (team.score?.status === "submitted" && user.role !== "admin") {
    return { ok: false, error: "TEAM_ALREADY_SCORED" };
  }

  await prisma.team.update({
    where: { id: team.id },
    data: { archivedAt: new Date() },
  });

  await recordAudit({
    actorId: user.id,
    action: AUDIT.teamArchived,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: "archived (withdrawn) — restorable",
  });

  revalidatePath(`/e/${team.seriesId}`, "layout");
  return { ok: true, message: "Registration archived." };
}

/** Bring an archived registration back — admin only. */
export async function restoreTeam(seriesId: string, teamId: string): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const team = await prisma.team.findFirst({
    where: { id: teamId, seriesId, NOT: { archivedAt: null } },
    select: { id: true, seriesId: true, number: true, name: true },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  await prisma.team.update({ where: { id: team.id }, data: { archivedAt: null } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.teamRestored,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: "restored from the archive",
  });

  revalidatePath(`/e/${team.seriesId}`, "layout");
  return { ok: true, message: "Registration restored." };
}
