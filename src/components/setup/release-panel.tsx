"use client";

import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import type { SetupTeam } from "@/components/setup/wave-board-parts";
import { returnToAutoAssign } from "@/lib/actions/team-slot";
import { waveScheduleErrorMessage } from "@/lib/wave-schedule-messages";

/**
 * Handing a team running manually back to Auto Assign — confirmed, because
 * the next run may then move it anywhere in its own category's block. The
 * team stays where it is until then.
 */
export function ReleasePanel({ team, waveNumber, onClose, onDone }: { team: SetupTeam; waveNumber: number | null; onClose: () => void; onDone: (message: string) => void }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function release() {
    setError("");
    startTransition(async () => {
      try {
        const result = await returnToAutoAssign({ teamId: team.id, confirmed: true });
        if (!result.ok) {
          setError(t(waveScheduleErrorMessage(result.error)));
          return;
        }
        onDone(t("#{number} {name} is back with Auto Assign.", { number: team.number, name: team.name }));
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  return (
    <div className="card move-panel" data-testid="release-panel">
      <strong>{t("Return #{number} {name} to Auto Assign?", { number: team.number, name: team.name })}</strong>
      <p style={{ margin: 0 }}>
        {waveNumber
          ? t("It stays in wave {wave}, station {station}, for now. The next Auto Assign run may move it to any slot of its own category's block.", { wave: waveNumber, station: team.station ?? "—" })
          : t("The next Auto Assign run may move it to any slot of its own category's block.")}
      </p>
      {error ? <div className="notice-error" role="alert">{error}</div> : null}
      <div className="move-panel-buttons">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={release}>
          {pending ? <span className="spinner" /> : null}
          {t("Return to Auto Assign")}
        </button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>{t("Keep running manually")}</button>
      </div>
    </div>
  );
}
