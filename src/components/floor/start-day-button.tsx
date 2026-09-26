"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { startCompetitionDay } from "@/lib/actions/waves";

const ERRORS: Record<string, string> = {
  NOT_SCHEDULED: "The competition is not waiting to start any more — reload the page.",
  FORBIDDEN: "You are not allowed to do that.",
};

/**
 * The supervisor's "we are starting" — sets a scheduled competition to Running
 * so waves can start and judges can score (startCompetitionDay).
 */
export function StartDayButton({ seriesId }: { seriesId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function start() {
    if (!window.confirm(t("Start the competition now? Waves can then be started and judges can score."))) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await startCompetitionDay({ seriesId });
        if (!result.ok) {
          setError(t(ERRORS[result.error] ?? "Something went wrong. Try again."));
          return;
        }
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  return (
    <>
      <button type="button" className="btn btn-primary" disabled={pending} onClick={start} style={{ marginTop: 10 }}>
        {t("Start the competition")}
      </button>
      {error ? (
        <div className="notice-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </>
  );
}
