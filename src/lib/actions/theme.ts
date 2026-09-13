"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { isTheme, THEME_COOKIE } from "@/lib/theme";

/**
 * Stores the appearance choice server-side, so the very next render already
 * carries it — the page never flashes the wrong theme on the way in, which is
 * the usual failing of a client-side toggle.
 */
export async function setTheme(next: string) {
  if (!isTheme(next)) return;

  const store = await cookies();
  store.set(THEME_COOKIE, next, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    // A display preference, never a credential.
    httpOnly: false,
  });

  revalidatePath("/", "layout");
}
