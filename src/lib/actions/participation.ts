"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { competitionChoices } from "@/lib/competition-choice";
import { prisma } from "@/lib/prisma";
import { ensureParticipation } from "@/lib/participation";

export async function joinSeries(seriesId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireRole("competitor");
  if (user.viewAs || typeof seriesId !== "string") return { ok: false, error: "FORBIDDEN" };
  const series = await prisma.series.findFirst({ where: { id: seriesId, signupOpen: true, isTraining: false, isActive: true, archivedAt: null, status: { in: ["scheduled", "live"] } } });
  if (!series || !competitionChoices([series]).length) return { ok: false, error: "COMPETITION_CLOSED" };
  const entry = await ensureParticipation(user.id, series.id);
  if (entry.archivedAt) return { ok: false, error: "ENTRY_WITHDRAWN" };
  revalidatePath("/me");
  return { ok: true };
}

/** A deliberate account edit, separate from all competition registration forms. */
export async function updateAthleteIdentity(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await requireRole("competitor");
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(6).max(30) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  await prisma.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true };
}
