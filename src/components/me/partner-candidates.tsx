"use client";

import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { sendPartnerRequest } from "@/lib/actions/partner-requests";
import type { PartnerCandidate } from "@/lib/partner-directory";

const ERRORS: Record<string, string> = {
  ALREADY_REQUESTED: "You have already asked them.",
  THEY_ASKED_YOU: "They have already asked you — answer them in your requests.",
  DECLINED_BEFORE: "They have already turned this down.",
  TOO_MANY_PENDING: "You have too many requests waiting. Withdraw one first.",
  ALREADY_LINKED: "You already have a partner.",
  PROFILE_INCOMPLETE: "Set your level and category first.",
  NOT_FOUND: "They are no longer looking for a partner.",
  TRY_LATER: "Too many requests. Wait a few minutes and try again.",
  FORBIDDEN: "You cannot send requests.",
};

/**
 * The people at this athlete's own level and category who are looking.
 *
 * A plain list rather than DetailLink rows: there is no page behind a name to
 * navigate to, and there is not meant to be — what is shown here is all anyone
 * gets until the two of them agree.
 */
export function PartnerCandidates({
  seriesId,
  rows,
  canRequest,
}: {
  seriesId: string;
  rows: PartnerCandidate[];
  canRequest: boolean;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [asked, setAsked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  function ask(id: string) {
    setError("");
    setBusy(id);
    startTransition(async () => {
      try {
        const result = await sendPartnerRequest({ seriesId, toUserId: id });
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        setAsked((current) => [...current, id]);
      } catch {
        setError(t("Could not send. Check your connection and try again."));
      } finally {
        setBusy("");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="reg-sub" style={{ marginTop: 16 }}>
        {t("Nobody at your level and category is looking for a partner right now.")}
      </p>
    );
  }

  return (
    <>
      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="mobile-list" style={{ marginTop: 14 }}>
        {rows.map((row) => {
          const sent = asked.includes(row.id);
          return (
            <div key={row.id} className="mobile-list-card">
              <div>
                <strong>{row.name || t("Athlete")}</strong>
                <small>
                  {[row.division, row.category, row.studioName ?? t("No studio")]
                    .filter(Boolean)
                    .map((part) => t(String(part)))
                    .join(" · ")}
                </small>
              </div>
              {sent ? (
                <span className="badge badge-ok">{t("Asked")}</span>
              ) : canRequest ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => ask(row.id)}
                  disabled={pending}
                >
                  {busy === row.id ? <span className="spinner" /> : null}
                  {t("Ask them")}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
