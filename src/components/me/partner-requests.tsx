"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import {
  acceptPartnerRequest,
  declinePartnerRequest,
  withdrawPartnerRequest,
} from "@/lib/actions/partner-requests";

export type PartnerRequestRow = {
  id: string;
  name: string;
  division: string | null;
  category: string | null;
  studioName: string | null;
  /** What they were when they asked, when that is no longer what they are. */
  changed: string | null;
};

const ERRORS: Record<string, string> = {
  ALREADY_DECIDED: "That request has already been answered.",
  ALREADY_LINKED: "One of you already has a partner.",
  NOT_FOUND: "That request is no longer there.",
  TRY_LATER: "Too many answers at once. Try again in a moment.",
  FORBIDDEN: "You cannot answer this.",
};

/** The asks waiting on this athlete, and the ones they sent. */
export function PartnerRequests({
  seriesId,
  incoming,
  outgoing,
}: {
  seriesId: string;
  incoming: PartnerRequestRow[];
  outgoing: PartnerRequestRow[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  function run(id: string, action: (input: { seriesId: string; requestId: string }) => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    setBusy(id);
    startTransition(async () => {
      try {
        const result = await action({ seriesId, requestId: id });
        if (!result.ok) {
          setError(t(ERRORS[result.error ?? ""] ?? "Something went wrong. Try again."));
          return;
        }
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      } finally {
        setBusy("");
      }
    });
  }

  const facts = (row: PartnerRequestRow) =>
    [row.division, row.category, row.studioName ?? t("No studio")]
      .filter(Boolean)
      .map((part) => t(String(part)))
      .join(" · ");

  return (
    <>
      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}

      <h2 className="section-title">{t("Asked you")}</h2>
      {incoming.length === 0 ? (
        <p className="reg-sub">{t("Nobody has asked you yet.")}</p>
      ) : (
        <div className="mobile-list">
          {incoming.map((row) => (
            <div key={row.id} className="mobile-list-card">
              <div>
                <strong>{row.name || t("Athlete")}</strong>
                <small>{facts(row)}</small>
                {row.changed ? <small>{row.changed}</small> : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => run(row.id, acceptPartnerRequest)}
                  disabled={pending}
                >
                  {busy === row.id ? <span className="spinner" /> : null}
                  {t("Accept")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => run(row.id, declinePartnerRequest)}
                  disabled={pending}
                >
                  {t("Decline")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="section-title">{t("You asked")}</h2>
      {outgoing.length === 0 ? (
        <p className="reg-sub">{t("You have not asked anyone yet.")}</p>
      ) : (
        <div className="mobile-list">
          {outgoing.map((row) => (
            <div key={row.id} className="mobile-list-card">
              <div>
                <strong>{row.name || t("Athlete")}</strong>
                <small>{facts(row)}</small>
                <small>{t("Waiting for their answer.")}</small>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => run(row.id, withdrawPartnerRequest)}
                disabled={pending}
              >
                {busy === row.id ? <span className="spinner" /> : null}
                {t("Withdraw")}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
