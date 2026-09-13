export const THEME_COOKIE = "podium_theme";

/**
 * Three states, not two.
 *
 * "system" means *no stored choice* — the operating system decides, and keeps
 * deciding as the day/night setting changes. An explicit "light" or "dark"
 * stamps `data-theme` on the document and wins over the media query in both
 * directions.
 *
 * PODIUM's ground is dark, so that is what an unconfigured visitor gets: the
 * console should look like the board it sits beside, not like a white form
 * that happens to be about a competition.
 */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "dark";

export function isTheme(value: string | undefined | null): value is Theme {
  return !!value && (THEMES as readonly string[]).includes(value);
}

/** What goes on `<html data-theme>`; `system` deliberately sets nothing. */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}
