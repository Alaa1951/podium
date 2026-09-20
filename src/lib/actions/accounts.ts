"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Role } from "@/generated/prisma/enums";
import { accountScope } from "@/lib/access";
import { AUDIT, recordAudit } from "@/lib/audit";
import { issueAuthToken } from "@/lib/auth-tokens";
import { sendInviteEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/scoring";
import { isValidEmail, normalizeEmail } from "@/lib/security";
import { revokeTrustedDevices } from "@/lib/trusted-device";
import { canManageTarget } from "@/lib/permissions/grant-policy";
import { canCreateAccount, requireAccess } from "@/lib/session";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Who may create whom (canCreateAccount, access.ts):
//
//   BFT MENA Full     →  any account type, any studio.
//   BFT MENA Partial  →  any account type but Full access.
//   A studio          →  athletes and organisers of its own studio only.
//
// Each action is gated by its own permission (users.invite, users.disable,
// users.delete), and every target is looked up inside the actor's account
// scope and checked with canManageTarget — never yourself, never above you.
//
// Nothing is ever self-created: an account starts as `invited` with no password
// hash, and only the emailed link can turn it into one that can sign in.
// ─────────────────────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().trim().max(200),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["admin", "staff", "studio", "competitor", "organiser"]),
  studioId: z.string().optional(),
});

const ROLE_LABEL: Record<Role, string> = {
  admin: "BFT MENA (full access)",
  staff: "BFT MENA",
  studio: "a studio account",
  organiser: "an organiser",
  competitor: "an athlete",
};

export async function inviteAccount(input: unknown): Promise<ActionResult> {
  const user = await requireAccess("users.invite");
  if (user.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "NAME_AND_EMAIL_REQUIRED" };

  const email = normalizeEmail(parsed.data.email);
  if (!isValidEmail(email)) return { ok: false, error: "EMAIL_INVALID" };

  const role = parsed.data.role as Role;
  const permission = canCreateAccount(user, role, parsed.data.studioId || null);
  if (!permission.allowed) return { ok: false, error: permission.reason };

  // A studio account without a studio would see nothing and manage nothing.
  if (role === "studio" && !permission.studioId) return { ok: false, error: "STUDIO_REQUIRED" };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "EMAIL_ALREADY_REGISTERED" };

  const created = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      role,
      status: "invited",
      studioId: role === "admin" || role === "staff" ? null : permission.studioId,
      createdById: user.id,
    },
  });

  // If a studio already registered this person as a competitor, link the
  // existing registration to the new account rather than creating a second one.
  if (role === "competitor") {
    await prisma.competitor.updateMany({
      where: { normalizedName: normalizeName(parsed.data.name), userId: null },
      data: { userId: created.id },
    });
  }

  const { url } = await issueAuthToken({ userId: created.id, purpose: "invite" });
  await sendInviteEmail({
    email,
    url,
    roleLabel: ROLE_LABEL[role],
    invitedBy: user.name || user.email,
  });

  await recordAudit({
    actorId: user.id,
    action: AUDIT.accountInvited,
    targetType: "user",
    targetId: created.id,
    targetLabel: email,
    detail: `role=${role}`,
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `Invitation sent to ${email}.` };
}

export async function resendInvite(userId: string): Promise<ActionResult> {
  const actor = await requireAccess("users.invite");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const target = await prisma.user.findFirst({
    where: { id: userId, archivedAt: null, ...accountScope(actor) },
  });
  if (!target) return { ok: false, error: "NOT_FOUND" };
  if (target.role === "admin" && actor.role !== "admin") return { ok: false, error: "FORBIDDEN" };

  const { url } = await issueAuthToken({ userId: target.id, purpose: "invite" });
  await sendInviteEmail({
    email: target.email,
    url,
    roleLabel: ROLE_LABEL[target.role],
    invitedBy: actor.name || actor.email,
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accountReinvited,
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
  });

  revalidatePath("/", "layout");
  return { ok: true, message: `Invitation re-sent to ${target.email}.` };
}

const statusSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(["active", "disabled"]),
});

export async function setAccountStatus(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("users.disable");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  // Locking yourself out of the only admin account is not a recoverable state.
  if (parsed.data.userId === actor.id) return { ok: false, error: "CANNOT_CHANGE_OWN_ACCOUNT" };

  const target = await prisma.user.findFirst({
    where: { id: parsed.data.userId, ...accountScope(actor) },
  });
  if (!target) return { ok: false, error: "NOT_FOUND" };
  const manage = canManageTarget(actor, target);
  if (!manage.allowed) return { ok: false, error: manage.reason };

  // An account that never set a password stays `invited` — enabling it would
  // create an account with no way to sign in.
  const nextStatus =
    parsed.data.status === "active" && !target.passwordHash ? "invited" : parsed.data.status;

  await prisma.user.update({
    where: { id: target.id },
    data: { status: nextStatus },
  });

  // Disabling has to take effect on devices that are already trusted, not at
  // the next token refresh.
  if (nextStatus === "disabled") {
    await revokeTrustedDevices({ userId: target.id, reason: "account_disabled" });
  }

  await recordAudit({
    actorId: actor.id,
    action: nextStatus === "disabled" ? AUDIT.accountDisabled : AUDIT.accountEnabled,
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

const assignStudioSchema = z.object({
  userId: z.string().min(1),
  studioId: z.string().nullable(),
});

/** BFT MENA only (users.edit): move an account to a different studio. */
export async function assignStudio(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("users.edit");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = assignStudioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const current = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, role: true, studioId: true },
  });
  if (!current) return { ok: false, error: "NOT_FOUND" };
  const manage = canManageTarget(actor, current);
  if (!manage.allowed) return { ok: false, error: manage.reason };

  const moved = await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { studioId: parsed.data.studioId },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.accountStudioAssigned,
    targetType: "user",
    targetId: moved.id,
    targetLabel: moved.email,
    detail: `studioId=${parsed.data.studioId ?? "none"}`,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

// ── The studio directory ─────────────────────────────────────────────────────

/**
 * Add a studio to the directory.
 *
 * Being here does not put a studio into any competition — that is chosen
 * inside each one. This is only the list they are chosen from.
 */
export async function addStudio(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("studios.create");

  const parsed = z.object({ name: z.string().trim().min(2).max(120) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const existing = await prisma.studio.findUnique({
    where: { name: parsed.data.name },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "DUPLICATE" };

  const studio = await prisma.studio.create({ data: { name: parsed.data.name } });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.studioAdded,
    targetType: "studio",
    targetId: studio.id,
    targetLabel: studio.name,
  });

  revalidatePath("/studios");
  return { ok: true };
}

/**
 * Retire a studio, or bring it back.
 *
 * Never a deletion: a studio that has run competitions keeps its history and
 * its results. Retiring only stops it being offered when the next one is set
 * up, and leaves the ones it is already in alone.
 */
export async function setStudioActive(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("studios.edit");

  const parsed = z
    .object({ studioId: z.string().min(1), isActive: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const studio = await prisma.studio.update({
    where: { id: parsed.data.studioId },
    data: { isActive: parsed.data.isActive },
    select: { id: true, name: true },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.studioAdded,
    targetType: "studio",
    targetId: studio.id,
    targetLabel: studio.name,
    detail: parsed.data.isActive ? "reactivated" : "retired",
  });

  revalidatePath("/studios");
  return { ok: true };
}

// ── Removing an account ──────────────────────────────────────────────────────

const archiveSchema = z.object({ userId: z.string().min(1) });

/**
 * ARCHIVE an account — "removed from the platform".
 *
 * The account can no longer sign in (login rejects it like a disabled one, and
 * its trusted devices die immediately) and it disappears from the working
 * users list — but nothing is hard-deleted: its audits, invitations and
 * competitor links stay answerable, and BFT MENA can restore it. Self-archival
 * is refused, exactly like self-disabling.
 */
export async function archiveAccount(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("users.delete");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  if (parsed.data.userId === actor.id) return { ok: false, error: "CANNOT_CHANGE_OWN_ACCOUNT" };

  const target = await prisma.user.findFirst({
    where: { id: parsed.data.userId, archivedAt: null, ...accountScope(actor) },
  });
  if (!target) return { ok: false, error: "NOT_FOUND" };
  const manage = canManageTarget(actor, target);
  if (!manage.allowed) return { ok: false, error: manage.reason };

  await prisma.user.update({
    where: { id: target.id },
    data: { archivedAt: new Date(), status: "disabled" },
  });
  await revokeTrustedDevices({ userId: target.id, reason: "account_archived" });

  // Same rule as a self-deletion: no unanswerable request left behind.
  await prisma.partnerRequest.updateMany({
    where: { status: "pending", OR: [{ fromUserId: target.id }, { toUserId: target.id }] },
    data: { status: "cancelled", openPairKey: null, respondedAt: new Date() },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.userArchived,
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Account archived." };
}

/** Bring a removed account back — it returns exactly as it was. */
export async function restoreAccount(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("users.delete");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  const target = await prisma.user.findFirst({
    where: { id: parsed.data.userId, NOT: { archivedAt: null }, ...accountScope(actor) },
  });
  if (!target) return { ok: false, error: "NOT_FOUND" };
  const manage = canManageTarget(actor, target);
  if (!manage.allowed) return { ok: false, error: manage.reason };

  await prisma.user.update({
    where: { id: target.id },
    // An account that never set a password goes back to `invited`, the same
    // rule setAccountStatus applies to re-enabling.
    data: { archivedAt: null, status: target.passwordHash ? "active" : "invited" },
  });

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.userRestored,
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
  });

  revalidatePath("/", "layout");
  return { ok: true, message: "Account restored." };
}
