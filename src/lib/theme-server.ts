import "server-only";

import { cookies } from "next/headers";

import { DEFAULT_THEME, isTheme, THEME_COOKIE, type Theme } from "@/lib/theme";

/** The appearance choice for this request, from the cookie the toggle writes. */
export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  const value = store.get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : DEFAULT_THEME;
}
