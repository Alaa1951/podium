import { ApprovalsList, type ApprovalRoleOption } from "@/components/approvals/approvals-list";
import { can, isBft, type CurrentUser } from "@/lib/access";
import { listPendingSignups } from "@/lib/approvals";
import { canAssignRole } from "@/lib/permissions/grant-policy";
import { ensureSystemRoles } from "@/lib/permissions/ensure-system-roles";
import { prisma } from "@/lib/prisma";

/**
 * The requests waiting on this viewer, with the roles they may give and — at
 * BFT MENA — the studios to choose from. Shared by /approvals and a studio's
 * People screen.
 */
export async function ApprovalsSection({ user }: { user: CurrentUser }) {
  await ensureSystemRoles();
  const [requests, roleRows, studios] = await Promise.all([
    listPendingSignups(user),
    prisma.accessRole.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, key: true, name: true, assignableBy: true, permissions: true, accountTypes: true },
    }),
    isBft(user)
      ? prisma.studio.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  // Only roles this viewer could give to somebody in their reach; the server
  // checks again, per request, on approve.
  const probe = { id: "__request__", role: "organiser" as const, studioId: user.studioId };
  const roles: ApprovalRoleOption[] = roleRows
    .filter((role) => canAssignRole(user, probe, role).allowed)
    .map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      accountTypes: Array.isArray(role.accountTypes) ? (role.accountTypes as string[]) : [],
    }));

  return (
    <ApprovalsList
      requests={requests}
      roles={roles}
      studios={studios}
      canPickStudio={isBft(user)}
      canDecide={!user.viewAs && can(user, "approvals.decide")}
    />
  );
}
