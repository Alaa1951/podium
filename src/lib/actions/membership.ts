"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { can } from "@/lib/access";
import { sendAddedToTeamEmail, sendPartnerLeftEmail, sendRemovedFromTeamEmail } from "@/lib/email";
import { changeMembership, type MembershipError, type MembershipInput } from "@/lib/membership-change";
import { membershipChangesEnabled } from "@/lib/ownership";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { getBaseUrl } from "@/lib/security";
import { getCurrentUser } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// The athlete's buttons: replace my partner, add a partner, leave the team.
// Everything is decided in membership-change.ts; this is the session, the
// switch, the input's shape, and — after the change has committed — the
// emails and the pages to refresh.
// ─────────────────────────────────────────────────────────────────────────────

export type MembershipActionResult =
  | { ok: true; code: "REPLACED" | "FILLED" | "LEFT" | "NO_CHANGE"; version: number }
  | { ok: false; error: MembershipError | "FORBIDDEN" | "CHANGES_OFF" | "INVALID_INPUT" };

const base = { operationId: z.string().uuid(), teamId: z.string().min(1).max(191), expectedVersion: z.number().int().min(0) };
const person = { fullName: z.string().max(200), email: z.string().max(254) };
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replace"), ...base, ...person, targetSeatId: z.string().min(1).max(191), expected: z.object({ userId: z.string().max(191).nullable(), email: z.string().max(254).nullable() }) }),
  z.object({ kind: z.literal("fill"), ...base, ...person }),
  z.object({ kind: z.literal("leave"), ...base, mySeatId: z.string().min(1).max(191) }),
]);

export async function changeMyTeam(input: unknown): Promise<MembershipActionResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "competitor" || user.viewAs || !can(user, "athleteHome.editTeam")) return { ok: false, error: "FORBIDDEN" };
  if (!membershipChangesEnabled()) return { ok: false, error: "CHANGES_OFF" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };

  // The account as it is now — never the session's copy of its email.
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, status: true, archivedAt: true } });
  if (!account || account.status === "disabled" || account.archivedAt) return { ok: false, error: "FORBIDDEN" };

  const outcome = await changeMembership(prisma, { id: account.id, email: account.email }, parsed.data as MembershipInput);
  if (!outcome.ok) return outcome;

  // After the commit, never inside it: a mail server's mood must not undo a
  // team change, and a failed email is not a failed change.
  const url = `${getBaseUrl()}/athlete`;
  for (const notice of outcome.notices) {
    const send =
      notice.kind === "removed"
        ? sendRemovedFromTeamEmail({ email: notice.to, teamName: notice.teamName, teamNumber: notice.teamNumber, url: `${getBaseUrl()}/me` })
        : notice.kind === "added"
          ? sendAddedToTeamEmail({ email: notice.to, teamName: notice.teamName, teamNumber: notice.teamNumber, byName: notice.byName, url })
          : sendPartnerLeftEmail({ email: notice.to, teamName: notice.teamName, teamNumber: notice.teamNumber, leaverName: notice.leaverName, url: `${getBaseUrl()}/me` });
    await send.catch((error) => console.error("[MEMBERSHIP:email]", notice.kind, error instanceof Error ? error.message : error));
  }
  if (!outcome.replayed && outcome.code !== "NO_CHANGE") {
    revalidateCompetitionViews();
    revalidatePath("/me");
    revalidatePath("/me/partner");
  }
  return { ok: true, code: outcome.code, version: outcome.version };
}
