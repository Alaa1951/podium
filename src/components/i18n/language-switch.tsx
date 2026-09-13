"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useLocale } from "@/components/i18n/locale-provider";
import { setLocale } from "@/lib/actions/locale";
import { LOCALES, LOCALE_META } from "@/lib/i18n/config";

/**
 * The cookie is written by a server action, so the response that follows already
 * carries the new locale — server components re-render in the new language and
 * the document direction flips with them.
 */
export function LanguageSwitch({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    if (next === locale) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  const dark = tone === "dark";

  return (
    <div
      style={{ display: "inline-flex", opacity: pending ? 0.6 : 1 }}
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((code, i) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            onClick={() => choose(code)}
            aria-pressed={active}
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 600,
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "4px 9px",
              cursor: "pointer",
              lineHeight: 1.3,
              border: `1px solid ${dark ? "var(--on-navy-faint)" : "var(--border-strong)"}`,
              borderInlineStart: i === 0 ? undefined : "none",
              background: active
                ? dark
                  ? "var(--on-navy)"
                  : "var(--color-accent-700)"
                : "transparent",
              color: active
                ? dark
                  ? "var(--color-accent-900)"
                  : "var(--on-navy)"
                : dark
                  ? "var(--on-navy-secondary)"
                  : "var(--text-secondary)",
            }}
          >
            {LOCALE_META[code].label}
          </button>
        );
      })}
    </div>
  );
}
