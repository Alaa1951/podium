"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireRole } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// WAVE SCORER GRANTS.
//
// A judge or recorder sits at one location with one laptop and scores one
// wave. The grant is the whole permission: with it, the account's home becomes
// that wave's score sheet; without it, they see nothing of the console. Grants
// are per account and per wave — several waves may run at once, in different
// locations, and each gets its own people.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const grantSchema = z.object({
  userId: z.string().min(1),
  waveId: z.string().min(1),
});

/** Give an account the score sheet of one wave. */
export async function grantWaveAccess(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const wave = await prisma.wave.findUnique({
    where: { id: parsed.data.waveId },
    select: { id: true, number: true, seriesId: true },
  });
  if (!wave) return { ok: false, error: "NOT_FOUND" };

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, email: true },
  });
  if (!user) return { ok: false, error: "NOT_FOUND" };

  await prisma.waveAccess.upsert({
    where: { userId_waveId: { userId: user.id, waveId: wave.id } },
    create: { userId: user.id, waveId: wave.id },
    update: {},
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.waveAccessGranted,
    targetType: "event",
    targetId: wave.seriesId,
    targetLabel: user.email,
    detail: `granted score entry for wave ${wave.number}`,
  });

  revalidateCompetitionViews();
  return { ok: true, message: "Access granted." };
}

/** Take a wave score sheet away again. */
export async function revokeWaveAccess(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = z.object({ accessId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const access = await prisma.waveAccess.findUnique({
    where: { id: parsed.data.accessId },
    select: { id: true, wave: { select: { number: true, seriesId: true } }, user: { select: { email: true } } },
  });
  if (!access) return { ok: false, error: "NOT_FOUND" };

  await prisma.waveAccess.delete({ where: { id: access.id } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.waveAccessRevoked,
    targetType: "event",
    targetId: access.wave.seriesId,
    targetLabel: access.user.email,
    detail: `revoked score entry for wave ${access.wave.number}`,
  });

  revalidateCompetitionViews();
  return { ok: true, message: "Access revoked." };
}
