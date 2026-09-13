"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { issueAuthToken } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { isValidEmail, normalizeEmail } from "@/lib/security";
import { requireRole } from "@/lib/session";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// CORRECTING AN ACCOUNT, AND GETTING SOMEBODY BACK IN.
//
// Inviting, enabling and disabling live in accounts.ts. This is the rest: the
// name that was typed wrong, the email that changed, the studio somebody was
// put under by mistake, and the reset link for the person who cannot get in.
//
// BFT MENA only. Nobody edits their own row here — a person changing their own
// role is the one change this screen must never make — and the checks are all
// re-derived from the database rather than trusted from the form.
// ─────────────────────────────────────────────────────────────────────────────

const editSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(200),
  role: z.enum(["admin", "studio", "competitor"]),
  studioId: z.union([z.string(), z.null()]).optional(),
  /** Optional access profile: when set, its permission list governs this
   *  account's screens and actions instead of the role defaults. */
  accessRoleId: z.union([z.string(), z.null()]).optional(),
});

/** Correct a person's name, email, role, studio or access role. */
export async function updateAccount(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { userId, name, role } = parsed.data;

  // Changing your own role or email is how somebody locks themselves out, or
  // quietly promotes themselves. Another admin does it, or nobody does.
  if (userId === actor.id) return { ok: false, error: "CANNOT_CHANGE_OWN_ACCOUNT" };

  const email = normalizeEmail(parsed.data.email);
  if (!isValidEmail(email)) return { ok: false, error: "EMAIL_INVALID" };

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, studioId: true, accessRoleId: true },
  });
  if (!before) return { ok: false, error: "NOT_FOUND" };

  if (email !== before.email) {
    const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (taken) return { ok: false, error: "EMAIL_ALREADY_REGISTERED" };
  }

  // A studio account without a studio can see nothing, which looks like a bug
  // rather than a setting. Anyone else is simply not scoped to one.
  const studioId = parsed.data.studioId || null;
  if (role === "studio" && !studioId) return { ok: false, error: "STUDIO_REQUIRED" };

  // An access role must exist if one is named; null clears the assignment.
  const accessRoleId = parsed.data.accessRoleId === undefined
    ? before.accessRoleId
    : parsed.data.accessRoleId || null;
  if (accessRoleId) {
    const known = await prisma.accessRole.findUnique({
      where: { id: accessRoleId },
      select: { id: true },
    });
    if (!known) return { ok: false, error: "INVALID_INPUT" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      name,
      email,
      role,
      studioId: role === "admin" ? null : studioId,
      accessRoleId,
    },
  });

  // What actually changed, in words — an audit line has to be readable a year
  // later by somebody who was not in the room.
  const changes = [
    before.name !== name && `name "${before.name ?? "—"}" → "${name}"`,
    before.email !== email && `email ${before.email} → ${email}`,
    before.role !== role && `role ${before.role} → ${role}`,
    before.studioId !== studioId && `studio changed`,
    before.accessRoleId !== accessRoleId && `access role changed`,
  ].filter(Boolean);

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accountUpdated,
    targetType: "user",
    targetId: userId,
    targetLabel: email,
    detail: changes.length ? changes.join(" · ") : "no change",
  });

  revalidatePath("/users");
  return { ok: true, message: changes.length ? "Saved." : "Nothing changed." };
}

/**
 * Email somebody a link to set a new password.
 *
 * The link is single-use and short-lived, and issuing one spends any earlier
 * link of the same kind — so a second "send" cannot leave two valid ways in.
 * It is never shown on screen: the point is that it reaches the inbox of the
 * person who owns the account, and nobody else.
 */
export async function sendResetLink(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = z.object({ userId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, email: true, status: true },
  });
  if (!user) return { ok: false, error: "NOT_FOUND" };
  if (user.status === "disabled") return { ok: false, error: "ACCOUNT_DISABLED" };

  const { url } = await issueAuthToken({ userId: user.id, purpose: "reset" });
  await sendPasswordResetEmail({ email: user.email, url });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.resetLinkSent,
    targetType: "user",
    targetId: user.id,
    targetLabel: user.email,
    detail: "password reset link emailed",
  });

  revalidatePath("/users");
  return { ok: true, message: `Reset link sent to ${user.email}.` };
}

const studioSchema = z.object({
  studioId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
});

/** Rename a studio. Everything that points at it follows, because it is a row. */
export async function renameStudio(input: unknown): Promise<ActionResult> {
  const actor = await requireRole("admin");

  const parsed = studioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const { studioId, name } = parsed.data;

  const before = await prisma.studio.findUnique({
    where: { id: studioId },
    select: { name: true },
  });
  if (!before) return { ok: false, error: "NOT_FOUND" };
  if (before.name === name) return { ok: true, message: "Nothing changed." };

  const taken = await prisma.studio.findUnique({ where: { name }, select: { id: true } });
  if (taken) return { ok: false, error: "DUPLICATE" };

  await prisma.studio.update({ where: { id: studioId }, data: { name } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.studioRenamed,
    targetType: "studio",
    targetId: studioId,
    targetLabel: name,
    detail: `was "${before.name}"`,
  });

  revalidatePath("/studios");
  revalidatePath("/series", "layout");
  return { ok: true, message: "Saved." };
}
