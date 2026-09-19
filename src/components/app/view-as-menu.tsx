"use client";

import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { startViewAsRole } from "@/lib/actions/view-as";

const ERRORS: Record<string, string> = {
  FORBIDDEN: "You are not allowed to do that.",
  NO_JUDGE_ACCOUNT: "No account carries a wave grant yet — grant one first.",
  NO_ACCOUNT_FOR_ROLE: "No active account for that role yet.",
};

/**
 * The "view as" control at the top of the console menu.
 *
 * In the admin's own name it opens the role strip. While a preview is live it
 * says whose eyes those are — the same sentence the banner carries — and the
 * way out is right there, because switching previews means exiting first.
 */
export function ViewAsMenu({ viewing }: { viewing?: { name: string | null; role: string } }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function view(role: "member" | "judge" | "studio" | "organiser") {
    setError("");
    startTransition(async () => {
      const result = await startViewAsRole(role);
      if (result?.ok === false) {
        setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
      }
    });
  }

  if (viewing) {
    const who =
      viewing.name ??
      t(viewing.role === "admin" ? "Admin" : viewing.role === "studio" ? "Studio" : viewing.role === "organiser" ? "Organiser" : "Athlete");
    return (
      <div className="view-as-menu">
        <button
          type="button"
          className="view-as-menu-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span aria-hidden>◉</span> {t("Viewing the app as {name}", { name: who })}
        </button>
        {open ? (
          <div className="view-as-menu-panel">
            <p className="view-as-menu-note">
              {t("Exactly what this account sees after sign-in — read-only.")}
            </p>
            <a href="/api/view-as/exit" className="btn btn-sm view-as-banner-exit">
              {t("Exit preview")}
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="view-as-menu">
      <button
        type="button"
        className="view-as-menu-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span aria-hidden>◉</span> {t("View as")}
      </button>

      {open ? (
        <div className="view-as-menu-panel">
          <p className="view-as-menu-note">{t("See the whole platform as one of these — read-only.")}</p>
          <div className="view-as-menu-roles">
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => view("member")}>
              {t("Athlete")}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => view("organiser")}>
              {t("Organiser")}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => view("judge")}>
              {t("Judge")}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => view("studio")}>
              {t("Studio")}
            </button>
          </div>
          {pending ? <p className="view-as-menu-note">{t("Opening the preview…")}</p> : null}
          {error ? (
            <p className="view-as-menu-note" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
