"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";

/**
 * Writes the language preference server-side. A cookie set here is part of the
 * response, so the very next render already has the new locale — and the
 * document direction flips with it, without a client-side write.
 */
export async function setLocale(next: string) {
  if (!isLocale(next)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, next, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    // A display preference, never a credential — readable by the client is fine.
    httpOnly: false,
  });

  revalidatePath("/", "layout");
}
