"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { setTheme } from "@/lib/actions/theme";
import { THEMES, type Theme } from "@/lib/theme";

const ICONS: Record<Theme, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

/**
 * Light, dark, or follow the system. Three explicit choices rather than a
 * two-way switch, because "follow the system" is a real preference and a
 * toggle cannot express it.
 */
export function ThemeToggle({ current }: { current: Theme }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const labels: Record<Theme, string> = {
    system: t("Match system"),
    light: t("Light"),
    dark: t("Dark"),
  };

  return (
    <div
      role="group"
      aria-label={t("Appearance")}
      style={{
        display: "inline-flex",
        padding: 2,
        gap: 2,
        borderRadius: "var(--r-pill)",
        background: "var(--surface-sunken)",
        border: "1px solid var(--border)",
        opacity: pending ? 0.6 : 1,
      }}
    >
      {THEMES.map((theme) => {
        const active = theme === current;
        return (
          <button
            key={theme}
            type="button"
            title={labels[theme]}
            aria-label={labels[theme]}
            aria-pressed={active}
            onClick={() =>
              startTransition(async () => {
                await setTheme(theme);
                router.refresh();
              })
            }
            style={{
              width: 28,
              height: 26,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              borderRadius: "var(--r-pill)",
              border: "none",
              fontSize: 13,
              lineHeight: 1,
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--text)" : "var(--text-muted)",
              boxShadow: active ? "var(--shadow-xs)" : "none",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            <span aria-hidden>{ICONS[theme]}</span>
          </button>
        );
      })}
    </div>
  );
}
