"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { getCurrentUser, homeForUser } from "@/lib/session";
import { writeViewAsCookie } from "@/lib/view-as";

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
  const user = await getCurrentUser();
  if (!user || user.role !== "admin" || user.viewAs) {
    return { ok: false, error: "FORBIDDEN" };
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, archivedAt: true },
  });
  if (!target || target.role === "admin" || target.status !== "active" || target.archivedAt) {
    return { ok: false, error: "FORBIDDEN" };
  }

  await writeViewAsCookie(target.id);
  redirect(
    await homeForUser({
      id: target.id,
      email: "",
      name: null,
      role: target.role,
      studioId: null,
      locale: user.locale,
      permissions: [],
    })
  );
}
