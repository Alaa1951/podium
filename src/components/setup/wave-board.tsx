"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { deleteWave, saveWave } from "@/lib/actions/waves";
import { autoAssignWaves, setTeamWave } from "@/lib/actions/teams";
import { setAthleteStudio } from "@/lib/actions/team-people";
import { waveWindowLabel, type WaveState } from "@/lib/waves";
import { type SetupTeam } from "@/components/setup/wave-board-parts";
import { OrphanCard, WaveCard } from "@/components/setup/wave-card";

export type { SetupTeam };

// ─────────────────────────────────────────────────────────────────────────────
// THE RUNNING ORDER.
//
// A wave is a row of its own: its own start, its own length, its own capacity,
// its own clock. Nine teams and twenty minutes are only what a new wave starts
// out as — every one of those is editable here, wave by wave, because no two
// event days run to the same shape.
//
// Teams are linked to waves from this screen; STARTING a wave is the operator's
// job and lives on the Scores screen next to the clock.
// ─────────────────────────────────────────────────────────────────────────────

export function WaveBoard({
  seriesId,
  teams,
  waves,
  studios,
  waveMinutes,
  waveCapacity,
  isAdmin,
  ownStudioId,
}: {
  seriesId: string;
  teams: SetupTeam[];
  /** The running order as it stands, each wave with its own settings. */
  waves: WaveState[];
  studios: { id: string; name: string }[];
  /** Defaults for a wave that does not exist yet. */
  waveMinutes: number;
  waveCapacity: number;
  isAdmin: boolean;
  ownStudioId: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [perWave, setPerWave] = useState(waveCapacity);
  const [editing, setEditing] = useState<string | null>(null);

  const studioName = (id: string | null) =>
    id ? (studios.find((s) => s.id === id)?.name ?? "—") : t("Non-member");

  const cycle: (string | null)[] = isAdmin
    ? [null, ...studios.map((s) => s.id)]
    : ownStudioId
      ? [null, ownStudioId]
      : [null];

  // A team can carry a wave number the running order has not caught up with —
  // an import, or a wave deleted under it. Those numbers are shown as
  // unscheduled rather than quietly dropped.
  const scheduled = new Set(waves.map((wave) => wave.number));
  const orphanNumbers = [...new Set(teams.map((team) => team.wave))]
    .filter((number) => !scheduled.has(number))
    .sort((a, b) => a - b);

  const highest = Math.max(0, ...waves.map((w) => w.number), ...teams.map((x) => x.wave));
  const pickable = Array.from({ length: Math.max(16, highest + 1) }, (_, i) => i + 1);

  function report(result: { ok: boolean; error?: string; message?: string }) {
    if (result.ok) {
      setMessage(result.message ?? "");
      router.refresh();
      return;
    }
    setMessage(
      result.error === "WAVE_RUNNING"
        ? t("End the wave on the floor before re-planning the running order.")
        : result.error === "WAVE_STARTED"
          ? t("That wave has already run — only BFT MENA can move a team out of it.")
          : result.error === "WAVE_NUMBER_TAKEN"
            ? t("There is already a wave with that number.")
            : t("Something went wrong. Try again.")
    );
  }

  function moveTeam(teamId: string, wave: number) {
    startTransition(async () => report(await setTeamWave({ teamId, wave })));
  }

  function cycleMembership(competitorId: string, current: string | null) {
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    startTransition(async () => report(await setAthleteStudio({ competitorId, studioId: next })));
  }

  function autoAssign() {
    setMessage("");
    startTransition(async () => report(await autoAssignWaves({ seriesId, perWave })));
  }

  function addWave() {
    setMessage("");
    const number = highest + 1;
    const previous = waves[waves.length - 1];
    const start = previous
      ? waveWindowLabel(previous.startTime, previous.durationMinutes).end
      : "09:00";

    startTransition(async () =>
      report(
        await saveWave({
          seriesId,
          number,
          startTime: start,
          durationMinutes: waveMinutes,
          capacity: waveCapacity,
        })
      )
    );
  }

  function removeWave(waveId: string) {
    setMessage("");
    startTransition(async () => report(await deleteWave({ waveId })));
  }

  function saveSettings(wave: WaveState, form: FormData) {
    setMessage("");
    startTransition(async () => {
      const result = await saveWave({
        seriesId,
        waveId: wave.id,
        number: form.get("number"),
        startTime: form.get("startTime"),
        durationMinutes: form.get("durationMinutes"),
        capacity: form.get("capacity"),
      });
      if (result.ok) setEditing(null);
      report(result);
    });
  }

  const grid = {
    pickable,
    pending,
    studioName,
    onMove: moveTeam,
    onCycle: cycleMembership,
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 16,
          flexWrap: "wrap",
          borderBottom: "2px solid var(--text)",
          paddingBottom: 12,
        }}
      >
        <div>
          <div className="page-eyebrow">{t("Event day schedule")}</div>
          <h1 className="page-title" style={{ fontSize: 40 }}>
            {t("Wave assignment")}
          </h1>
        </div>

        {isAdmin ? (
          <div
            style={{
              marginInlineStart: "auto",
              display: "flex",
              gap: 10,
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <div>
              <label className="field-label" htmlFor="perWave">
                {t("Per wave")}
              </label>
              <input
                id="perWave"
                type="number"
                min={1}
                max={40}
                className="input pd-num"
                value={perWave}
                onChange={(e) => setPerWave(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: 90 }}
              />
            </div>
            <button type="button" className="btn btn-secondary" onClick={addWave} disabled={pending}>
              {t("Add wave")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={autoAssign}
              disabled={pending}
            >
              {t("Auto-assign waves")}
            </button>
          </div>
        ) : null}
      </div>

      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 10, maxWidth: "70ch" }}>
        {t(
          "Auto-assign groups teams by bracket first, then fills waves in order — so a wave runs one or two brackets at a time and the judges use one set of loads per floor. Override any team with the dropdown on its row, and give any wave its own start, length and capacity."
        )}
      </p>

      {message ? (
        <div className="notice" style={{ marginTop: 12 }}>
          {message}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 22 }}>
        {waves.map((wave) => (
          <WaveCard
            key={wave.id}
            wave={wave}
            inWave={teams.filter((team) => team.wave === wave.number)}
            isAdmin={isAdmin}
            pending={pending}
            editing={editing === wave.id}
            onToggleSettings={() => setEditing(editing === wave.id ? null : wave.id)}
            onRemove={() => removeWave(wave.id)}
            onSaveSettings={saveSettings}
            grid={grid}
          />
        ))}

        {/* Teams pointing at a wave that is not in the running order. */}
        {orphanNumbers.map((number) => (
          <OrphanCard
            key={`orphan-${number}`}
            number={number}
            inWave={teams.filter((team) => team.wave === number)}
            grid={grid}
          />
        ))}

        {waves.length === 0 && orphanNumbers.length === 0 ? (
          <div className="notice">
            <strong>{t("No waves yet.")}</strong>{" "}
            {t("Auto-assign builds the running order from the field, or add waves one at a time.")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
