"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DetailLink } from "@/components/app/detail-link";
import { useIsMobile } from "@/components/app/use-mobile";
import { useT } from "@/components/i18n/locale-provider";
import { arrangeWaveTimes, deleteWave, saveWave } from "@/lib/actions/waves";
import { autoAssignWaves, setTeamStation, setTeamWave } from "@/lib/actions/teams";
import { setAthleteStudio } from "@/lib/actions/team-people";
import { type WaveState } from "@/lib/waves";
import { waveScheduleErrorMessage } from "@/lib/wave-schedule-messages";
import { type SetupTeam } from "@/components/setup/wave-board-parts";
import { OrphanCard, WaveCard } from "@/components/setup/wave-card";

export type { SetupTeam };

// ─────────────────────────────────────────────────────────────────────────────
// THE RUNNING ORDER.
//
// A wave is a row of its own: its number in the running order and its
// estimated start. Its length and capacity come from the competition's
// settings, so one change there reaches every wave at once.
//
// Teams are linked to waves and stations here; STARTING a wave is the
// supervisor's job and lives on Wave control.
// ─────────────────────────────────────────────────────────────────────────────

export function WaveBoard({
  detailId,
  editMode = false,
  seriesId,
  teams,
  waves,
  studios,
  waveCapacity,
  isAdmin,
  canPlace,
  canEditTeams,
  canRebuild = true,
}: {
  detailId?: string;
  editMode?: boolean;
  seriesId: string;
  teams: SetupTeam[];
  /** The running order as it stands, each wave with its own settings. */
  waves: WaveState[];
  studios: { id: string; name: string }[];
  /** Defaults for a wave that does not exist yet. */
  waveMinutes: number;
  waveCapacity: number;
  /** waves.edit — the running order itself: add, number, time, rebuild. */
  isAdmin: boolean;
  /** waves.placeTeams — move a team to another wave or station. */
  canPlace: boolean;
  /** registrations.edit — mark an athlete as a studio's member or not. */
  canEditTeams: boolean;
  canRebuild?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const mobile = useIsMobile();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [perWave, setPerWave] = useState(Math.min(9, waveCapacity));
  const [editing, setEditing] = useState<string | null>(editMode ? detailId ?? null : null);

  const studioName = (id: string | null) =>
    id ? (studios.find((s) => s.id === id)?.name ?? "—") : t("Non-member");

  // The console's screen: every studio taking part is a choice (a studio
  // account never reaches it — requireConsoleAccess).
  const cycle: (string | null)[] = [null, ...studios.map((s) => s.id)];

  // A team can carry a wave number the running order has not caught up with —
  // an import, or a wave deleted under it. Those numbers are shown as
  // unscheduled rather than quietly dropped.
  const scheduled = new Set(waves.map((wave) => wave.id));
  const unassigned = teams.filter(team => !team.waveId || !scheduled.has(team.waveId));
  const orphanNumbers = [...new Set(unassigned.map((team) => team.wave))]
    .sort((a, b) => a - b);

  // The next wave to CREATE is one past the highest wave that exists. Teams are
  // deliberately not counted: `Team.wave` defaults to 1 on every registration
  // long before a schedule is built, so a competition with teams and no waves
  // would have its first "Add wave" create number 2 — and the whole day would
  // start at Wave 2 while every team still pointed at a Wave 1 that was never
  // made.
  const highest = Math.max(0, ...waves.map((w) => w.number));
  // The PICKER still has to reach any number a team already claims, or a team
  // sitting on wave 7 could not be moved to a wave that does not exist yet.
  const claimed = Math.max(highest, 0, ...teams.map((x) => x.wave));
  const pickable = Array.from({ length: Math.min(99, Math.max(16, claimed + 1)) }, (_, i) => i + 1);

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
          ? t("Waves that have started cannot be rescheduled.")
          : result.error === "WAVE_NUMBER_TAKEN"
            ? t("There is already a wave with that number.")
            : result.error === "WAVE_FULL"
              ? t("That wave is full — {n} teams, one per station.", { n: waveCapacity })
              : result.error === "BEYOND_CAPACITY"
                ? t("This wave runs {n} stations — pick one of those, or raise Teams per wave in Settings.", { n: waveCapacity })
                : result.error === "STATION_TAKEN"
                ? t("Another studio's team is on that station.")
                : t(waveScheduleErrorMessage(result.error))
    );
  }

  function moveTeam(teamId: string, wave: number) {
    startTransition(async () => report(await setTeamWave({ teamId, wave })));
  }

  function moveStation(teamId: string, station: number) {
    startTransition(async () => report(await setTeamStation({ teamId, station })));
  }

  function cycleMembership(competitorId: string, current: string | null) {
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    startTransition(async () => report(await setAthleteStudio({ competitorId, studioId: next })));
  }

  function autoAssign() {
    if (waves.length && !window.confirm(t("Reassign all teams? This replaces manual moves and approved time changes."))) return;
    setMessage("");
    startTransition(async () => report(await autoAssignWaves({ seriesId, perWave })));
  }

  function addWave() {
    setMessage("");
    const number = highest + 1;

    startTransition(async () =>
      report(
        await saveWave({
          seriesId,
          number,
        })
      )
    );
  }

  function arrangeTime() {
    if (!window.confirm(t("Recalculate all wave start times? This replaces current times, including manual changes."))) return;
    setMessage("");
    startTransition(async () => report(await arrangeWaveTimes({ seriesId })));
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
      });
      if (result.ok) { setEditing(null); if (editMode) router.replace(path.replace(/\/edit$/, "")); }
      report(result);
    });
  }

  const grid = {
    pickable,
    // Each control follows the key its action checks, so nothing is offered
    // that would then be refused: moving a team is placeTeams, the studio
    // chip is registrations.edit.
    pending: pending || !canPlace,
    canEditTeams: canEditTeams && !pending,
    studioName,
    onMove: moveTeam,
    onCycle: cycleMembership,
    onStation: moveStation,
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
                max={9}
                className="input pd-num"
                value={perWave}
                onChange={(e) => setPerWave(Math.min(9, Math.max(1, Number(e.target.value) || 1)))}
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
              disabled={pending || !canRebuild}
            >
              {t("Auto-assign waves")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={arrangeTime} disabled={pending || !canRebuild || !waves.length}>
              {t("Arrange time")}
            </button>
          </div>
        ) : null}
      </div>

      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 10, maxWidth: "70ch" }}>
        {t(
          "Teams fill waves in order: Men, Mixed, Women; Rookie, Open, Pro within each category. Remaining places are filled from the next group. Arrange time calculates starts from the competition settings."
        )}
      </p>

      {message ? (
        <div className="notice" style={{ marginTop: 12 }}>
          {message}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 22 }}>
        {waves.filter(wave => !detailId || wave.id === detailId).map((wave) => mobile && !detailId ? <DetailLink key={wave.id} href={`${path}/${wave.id}`}><strong>{t("Wave")} {wave.number}</strong><span>{wave.startTime} · {teams.filter(team => team.waveId === wave.id).length} {t("Teams")}</span><span className="badge badge-neutral">{t(wave.status === "running" ? "On the floor" : wave.status === "complete" ? "Complete" : "Not started")}</span></DetailLink> : (
          <WaveCard
            key={wave.id}
            wave={wave}
            inWave={teams.filter((team) => team.waveId === wave.id)}
            isAdmin={isAdmin}
            pending={pending}
            editing={editing === wave.id}
            onToggleSettings={() => mobile && detailId ? router.push(`${path.replace(/\/edit$/, "")}/edit`) : setEditing(editing === wave.id ? null : wave.id)}
            onRemove={() => removeWave(wave.id)}
            onSaveSettings={saveSettings}
            grid={grid}
          />
        ))}

        {/* Teams pointing at a wave that is not in the running order. */}
        {!detailId && orphanNumbers.map((number) => (
          <OrphanCard
            key={`orphan-${number}`}
            number={number}
            inWave={unassigned.filter((team) => team.wave === number)}
            stations={waveCapacity}
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
