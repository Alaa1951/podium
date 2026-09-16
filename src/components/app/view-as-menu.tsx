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
 * The "view as" control at the top of the console menu. Opens a strip with
 * three roles; picking one shows the whole platform through the eyes of a
 * real account that carries that role — read-only, banner above every screen
 * until it is exited.
 */
export function ViewAsMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function view(role: "member" | "judge" | "studio") {
    setError("");
    startTransition(async () => {
      const result = await startViewAsRole(role);
      if (result?.ok === false) {
        setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
      }
    });
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
              {t("Member")}
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
