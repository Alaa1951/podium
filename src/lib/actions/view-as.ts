"use server";

import { redirect } from "next/navigation";

import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, homeForUser } from "@/lib/session";
import { writeViewAsCookie } from "@/lib/view-as";

/** Only an admin in their own name may open a preview. */
async function requirePreviewOpener() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin" || user.viewAs) return null;
  return user;
}

async function activeTarget(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, archivedAt: true },
  });
}

async function homeFor(target: { id: string; role: Role }, adminLocale: string): Promise<string> {
  return homeForUser({
    id: target.id,
    email: "",
    name: null,
    role: target.role,
    studioId: null,
    locale: adminLocale,
    permissions: [],
  });
}

/**
 * Begin seeing the app through another account's eyes. Admin-only, and only
 * from an ordinary (non-previewing) session — switching previews means exiting
 * the current one first, which keeps "who am I looking as" a single, visible
 * answer.
 *
 * Previewing another admin would show nothing new, so it is refused; every
 * other active account is fair game. The landing is the account's own home,
 * because that is the view being asked for.
 */
export async function startViewAs(userId: string): Promise<{ ok: false; error: string } | never> {
  const user = await requirePreviewOpener();
  if (!user) return { ok: false, error: "FORBIDDEN" };

  const target = await activeTarget(userId);
  if (!target || target.role === "admin" || target.status !== "active" || target.archivedAt) {
    return { ok: false, error: "FORBIDDEN" };
  }

  await writeViewAsCookie(target.id);
  redirect(await homeFor(target, user.locale));
}

/**
 * The menu's "view as": pick a ROLE, and the app is shown through the eyes of
 * a real account that carries it — the platform exactly as a member, a wave
 * scorer, or a studio lives in it, without keeping a login for any of them.
 * The first active account of that kind stands in; a judge means an account
 * actually working a zone.
 */
export async function startViewAsRole(
  role: "member" | "judge" | "studio" | "organiser"
): Promise<{ ok: false; error: string } | never> {
  const user = await requirePreviewOpener();
  if (!user) return { ok: false, error: "FORBIDDEN" };

  const base = { id: true, role: true, status: true, archivedAt: true } as const;
  let target: { id: string; role: Role; status: string; archivedAt: Date | null } | null = null;

  if (role === "member" || role === "studio" || role === "organiser") {
    target = await prisma.user.findFirst({
      where: {
        role: role === "member" ? "competitor" : role,
        status: "active",
        archivedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: base,
    });
  } else {
    // A judge means an account actually working a zone.
    const grant = await prisma.zoneStaff.findFirst({
      where: { user: { status: "active", archivedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    if (grant) {
      target = await prisma.user.findUnique({ where: { id: grant.userId }, select: base });
    }
  }

  if (!target || target.role === "admin" || target.status !== "active" || target.archivedAt) {
    return {
      ok: false,
      error: role === "judge" ? "NO_JUDGE_ACCOUNT" : "NO_ACCOUNT_FOR_ROLE",
    };
  }

  await writeViewAsCookie(target.id);
  redirect(await homeFor(target, user.locale));
}
