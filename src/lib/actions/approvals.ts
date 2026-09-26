"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { can, isBft, isStudio } from "@/lib/access";
import { approvalScope } from "@/lib/approvals";
import { AUDIT, recordAudit } from "@/lib/audit";
import { sendSignupDecisionEmail } from "@/lib/email";
import { enterApprovedPairs, type EnterPairOutcome } from "@/lib/enter-pair";
import { canGiveRole } from "@/lib/permissions/grant-policy";
import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/security";
import { requireAccess } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// DECIDING A SIGN-UP.
//
// Approve: the account gets its type, its studio and the roles picked — each
// role checked by the same anti-escalation rules as the Access panel, so a
// studio can only give Athlete, Organiser or Judge, and only into itself.
// A Gym/Studio request is BFT MENA's alone: approving it links an existing
// studio or creates one, and the account becomes that studio's login.
//
// Reject: with a reason, which is emailed. Nobody decides their own request,
// and a request already decided by someone else is not decided twice.
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalResult = { ok: true; message?: string } | { ok: false; error: string; keys?: string[] };

const approveSchema = z.object({
  userId: z.string().min(1),
  roleIds: z.array(z.string().min(1)).max(10),
  studioId: z.string().min(1).nullable().optional(),
  newStudioName: z.string().trim().min(2).max(120).optional(),
});

const rejectSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

async function loadRequest(actorScope: NonNullable<ReturnType<typeof approvalScope>>, userId: string) {
  return prisma.user.findFirst({
    where: { AND: [actorScope, { id: userId }] },
    select: {
      id: true,
      email: true,
      role: true,
      signupType: true,
      requestedRoleKey: true,
      requestedStudioId: true,
    },
  });
}

function revalidateApprovals() {
  revalidatePath("/approvals");
  revalidatePath("/users");
  revalidatePath("/studio/people");
  revalidatePath("/(app)", "layout");
}

/** Approve a waiting sign-up with the roles picked. */
export async function approveSignup(input: unknown): Promise<ApprovalResult> {
  const actor = await requireAccess("approvals.decide");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;
  if (data.userId === actor.id) return { ok: false, error: "CANNOT_CHANGE_OWN_ACCESS" };

  const scope = approvalScope(actor);
  if (!scope) return { ok: false, error: "FORBIDDEN" };
  const request = await loadRequest(scope, data.userId);
  if (!request) return { ok: false, error: "NOT_FOUND" };

  // ── Account type and studio ───────────────────────────────────────────────
  const gymRequest = request.requestedRoleKey === "gym-studio";
  let accountType = request.role;
  let studioId: string | null;
  let newStudioName: string | null = null;

  if (isStudio(actor)) {
    // A studio approves into itself, and never approves a new studio.
    if (gymRequest || !actor.studioId) return { ok: false, error: "FORBIDDEN" };
    studioId = actor.studioId;
  } else if (isBft(actor)) {
    studioId = data.studioId === undefined ? request.requestedStudioId : data.studioId;
    if (studioId) {
      const exists = await prisma.studio.findFirst({ where: { id: studioId, isActive: true }, select: { id: true } });
      if (!exists) return { ok: false, error: "STUDIO_NOT_FOUND" };
    }
    if (gymRequest) {
      accountType = "studio";
      if (!studioId) {
        if (!data.newStudioName) return { ok: false, error: "STUDIO_REQUIRED" };
        if (!can(actor, "studios.create")) return { ok: false, error: "FORBIDDEN" };
        const taken = await prisma.studio.findUnique({ where: { name: data.newStudioName }, select: { id: true } });
        if (taken) return { ok: false, error: "STUDIO_NAME_TAKEN" };
        newStudioName = data.newStudioName;
      }
    }
  } else {
    return { ok: false, error: "FORBIDDEN" };
  }

  // ── Roles, each checked against what this approver may give ───────────────
  const roles = data.roleIds.length
    ? await prisma.accessRole.findMany({
        where: { id: { in: data.roleIds } },
        select: { id: true, name: true, assignableBy: true, permissions: true, accountTypes: true },
      })
    : [];
  if (roles.length !== new Set(data.roleIds).size) return { ok: false, error: "NOT_FOUND" };
  const target = { id: request.id, role: accountType, studioId: studioId ?? (newStudioName ? "__new__" : null) };
  for (const role of roles) {
    // A brand-new studio does not exist yet, so the studio check is moot:
    // only BFT MENA reaches this with a new studio.
    const decision = canGiveRole(actor, target, role);
    if (!decision.allowed) return { ok: false, error: decision.reason, keys: decision.keys };
  }

  const now = new Date();
  const decided = await prisma.$transaction(async (tx) => {
    const finalStudioId = newStudioName
      ? (await tx.studio.create({ data: { name: newStudioName }, select: { id: true } })).id
      : studioId;
    // Whoever acts first decides: this only lands on a request still waiting.
    const updated = await tx.user.updateMany({
      where: { id: request.id, approvalStatus: "pending" },
      data: {
        role: accountType,
        studioId: finalStudioId,
        approvalStatus: "approved",
        approvedAt: now,
        approvedById: actor.id,
        rejectionReason: null,
        permissionsUpdatedAt: now,
      },
    });
    if (updated.count === 0) throw new Error("ALREADY_DECIDED");
    if (roles.length) {
      await tx.userAccessRole.createMany({
        data: roles.map((role) => ({ userId: request.id, accessRoleId: role.id, assignedById: actor.id })),
        skipDuplicates: true,
      });
    }
    return true;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "ALREADY_DECIDED") return false;
    throw error;
  });
  if (!decided) return { ok: false, error: "ALREADY_DECIDED" };

  // Approving an athlete who already has a partner and a competition ENTERS
  // them, here, rather than leaving them approved-but-in-nothing waiting for a
  // second press somebody has to remember. Best-effort on purpose: the
  // approval above has committed and must stand even if the entry cannot be
  // made, and every reason it might not be is a condition, not a fault.
  let entered: EnterPairOutcome = { entered: false, reason: "NOT_APPROVED" };
  if (accountType === "competitor") {
    entered = await enterApprovedPairs(request.id).catch((error: unknown) => {
      console.error("[APPROVALS:enter]", error);
      return { entered: false, reason: "NOT_APPROVED" } as const;
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.signupApproved,
    targetType: "user",
    targetId: request.id,
    targetLabel: request.email,
    detail: [
      `as ${accountType}`,
      roles.length ? `roles: ${roles.map((role) => role.name).join(", ")}` : null,
      newStudioName ? `new studio "${newStudioName}"` : null,
      entered.entered
        ? `entered as team ${entered.teamNumber}${entered.waitlisted ? " (waiting list)" : ""}`
        : null,
    ]
      .filter(Boolean)
      .join("; "),
  });
  try {
    await sendSignupDecisionEmail({
      email: request.email,
      approved: true,
      url: `${getBaseUrl()}${accountType === "competitor" ? "/athlete" : "/login"}`,
    });
  } catch {
    // The decision stands whether or not the email went out.
  }
  revalidateApprovals();
  return { ok: true, message: "Approved." };
}

/** Turn a waiting sign-up down, with a reason. */
export async function rejectSignup(input: unknown): Promise<ApprovalResult> {
  const actor = await requireAccess("approvals.decide");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  if (parsed.data.userId === actor.id) return { ok: false, error: "CANNOT_CHANGE_OWN_ACCESS" };

  const scope = approvalScope(actor);
  if (!scope) return { ok: false, error: "FORBIDDEN" };
  const request = await loadRequest(scope, parsed.data.userId);
  if (!request) return { ok: false, error: "NOT_FOUND" };

  const reason = parsed.data.reason || null;
  const updated = await prisma.user.updateMany({
    where: { id: request.id, approvalStatus: "pending" },
    data: {
      approvalStatus: "rejected",
      approvedAt: null,
      approvedById: actor.id,
      rejectionReason: reason,
      permissionsUpdatedAt: new Date(),
    },
  });
  if (updated.count === 0) return { ok: false, error: "ALREADY_DECIDED" };

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.signupRejected,
    targetType: "user",
    targetId: request.id,
    targetLabel: request.email,
    detail: reason ? `reason: ${reason}` : null,
  });
  try {
    await sendSignupDecisionEmail({ email: request.email, approved: false, reason, url: getBaseUrl() });
  } catch {
    // As above.
  }
  revalidateApprovals();
  return { ok: true, message: "Turned down." };
}
