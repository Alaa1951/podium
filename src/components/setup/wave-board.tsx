"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DetailLink } from "@/components/app/detail-link";
import { useIsMobile } from "@/components/app/use-mobile";
import { useT } from "@/components/i18n/locale-provider";
import { deleteWave, saveWave } from "@/lib/actions/waves";
import { setAthleteStudio } from "@/lib/actions/team-people";
import { type WaveState } from "@/lib/waves";
import { waveScheduleErrorMessage } from "@/lib/wave-schedule-messages";
import type { Category } from "@/generated/prisma/enums";
import { clockLabel, clockMinutes, lateForAwards, outsideItsBlock, privacyReview, type AwardsWindow, type SchedulePlan } from "@/lib/category-schedule";
import { type SetupTeam, type TeamPlacement } from "@/components/setup/wave-board-parts";
import { OrphanCard, WaveCard } from "@/components/setup/wave-card";
import { MoveTeamPanel, type MoveWave } from "@/components/setup/move-team-panel";
import { ReleasePanel } from "@/components/setup/release-panel";
import { ScheduleControls } from "@/components/setup/schedule-controls";

export type { SetupTeam };

// ─────────────────────────────────────────────────────────────────────────────
// THE RUNNING ORDER.
//
// A wave is a row of its own: its number in the running order, its estimated
// start, and — once a category schedule exists — the category block it runs
// in. Its length and capacity come from the competition's settings.
//
// Teams are placed here: by Auto Assign, category by category (schedule-
// controls.tsx), or by hand through the move panel — after which the team
// RUNS MANUALLY and Auto Assign leaves it where it is. STARTING a wave is the
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
  canBuild,
  canPlace,
  canEditTeams,
  canRebuild = true,
  scheduled = false,
  plan = null,
  awards = [],
  settingsHref,
}: {
  detailId?: string;
  editMode?: boolean;
  seriesId: string;
  teams: SetupTeam[];
  /** The running order as it stands, each wave with its own settings. */
  waves: WaveState[];
  studios: { id: string; name: string }[];
  waveCapacity: number;
  /** waves.edit on a floor account — the running order itself: schedule, auto-assign, waves and times. */
  canBuild: boolean;
  /** waves.placeTeams — move a team by hand, or return it to Auto Assign. */
  canPlace: boolean;
  /** registrations.edit — mark an athlete as a studio's member or not. */
  canEditTeams: boolean;
  canRebuild?: boolean;
  scheduled?: boolean;
  plan?: SchedulePlan | null;
  /** Each category's planned awards period, from the waves as they stand. */
  awards?: AwardsWindow[];
  settingsHref: string;
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const mobile = useIsMobile();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<string | null>(editMode ? detailId ?? null : null);
  const [open, setOpen] = useState<{ teamId: string; kind: "move" | "release" } | null>(null);

  const studioName = (id: string | null) =>
    id ? (studios.find((s) => s.id === id)?.name ?? "—") : t("Non-member");

  // The console's screen: every studio taking part is a choice (a studio
  // account never reaches it — requireConsoleAccess).
  const cycle: (string | null)[] = [null, ...studios.map((s) => s.id)];

  // A team can carry a wave number the running order has not caught up with —
  // an import, or a wave deleted under it. Those are shown as unscheduled
  // rather than quietly dropped.
  const scheduledIds = new Set(waves.map((wave) => wave.id));
  const unassigned = teams.filter(team => !team.waveId || !scheduledIds.has(team.waveId));
  const orphanNumbers = [...new Set(unassigned.map((team) => team.wave))].sort((a, b) => a - b);
  const highest = Math.max(0, ...waves.map((w) => w.number));

  function report(result: { ok: boolean; error?: string; teams?: number[] }) {
    if (result.ok) {
      setMessage("");
      router.refresh();
      return;
    }
    setMessage(
      result.error === "WAVE_NUMBER_TAKEN"
        ? t("There is already a wave with that number.")
        : result.error === "PROTECTED_CONFLICT"
          ? t("This wave holds teams running manually ({teams}). Move them or return them to Auto Assign first.", { teams: (result.teams ?? []).map((n) => `#${n}`).join(", ") })
          : t(waveScheduleErrorMessage(result.error))
    );
  }

  function cycleMembership(competitorId: string, current: string | null) {
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    startTransition(async () => report(await setAthleteStudio({ competitorId, studioId: next })));
  }

  function removeWave(waveId: string) {
    setMessage("");
    startTransition(async () => report(await deleteWave({ waveId })));
  }

  function saveSettings(wave: WaveState, form: FormData) {
    setMessage("");
    startTransition(async () => {
      const input = { seriesId, waveId: wave.id, number: form.get("number"), startTime: form.get("startTime") };
      let result = await saveWave(input);
      // Changing a wave that holds teams running manually moves them with it: only on purpose.
      if (!result.ok && result.error === "PROTECTED_WAVE" &&
          window.confirm(t("Wave {wave} holds teams running manually ({teams}). Change its number or time anyway? They move with it.", { wave: wave.number, teams: (result.teams ?? []).map((n) => `#${n}`).join(", ") }))) {
        result = await saveWave({ ...input, confirmProtected: true });
      }
      if (result.ok) { setEditing(null); if (editMode) router.replace(path.replace(/\/edit$/, "")); }
      else if (result.error === "PROTECTED_WAVE") { setMessage(""); return; }
      report(result);
    });
  }

  const waveOf = (team: SetupTeam) => waves.find((wave) => wave.id === team.waveId) ?? null;
  const placement = (team: SetupTeam): TeamPlacement => {
    const wave = waveOf(team);
    const late = wave && scheduled
      ? lateForAwards(team.category as Category, clockMinutes(wave.startTime) + wave.durationMinutes, awards)
      : null;
    return {
      outsideBlock: !!wave && outsideItsBlock(team.category as Category, wave.blockCategory, scheduled),
      hostBlock: wave?.blockCategory ?? null,
      privacyReview: !!wave && scheduled && privacyReview(team.category as Category, wave.blockCategory),
      lateForAwards: late ? { from: clockLabel(late.fromMinutes), to: clockLabel(late.toMinutes) } : null,
      locked: wave && wave.status !== "pending" ? { reason: "started", wave: wave.number } : team.scored ? { reason: "scored" } : null,
    };
  };
  // The teams in the field on each station (the board's teams are exactly
  // those: no waiting list, no withdrawn team) — what the server counts too.
  const moveWaves = (team: SetupTeam): MoveWave[] =>
    waves.filter((wave) => wave.status === "pending").map((wave) => ({
      id: wave.id, number: wave.number, startTime: wave.startTime, durationMinutes: wave.durationMinutes,
      capacity: wave.capacity, blockCategory: wave.blockCategory,
      // A team in the wave without a station yet still takes a place in it.
      count: teams.filter((one) => one.waveId === wave.id && one.id !== team.id).length,
      occupants: teams
        .filter((one) => one.waveId === wave.id && one.id !== team.id && one.station !== null)
        .map((one) => ({ teamId: one.id, station: one.station!, number: one.number, name: one.name, category: one.category as Category, scored: one.scored })),
    }));
  const done = (text: string) => { setOpen(null); setMessage(text); router.refresh(); };
  const panelFor = (team: SetupTeam) =>
    open?.teamId !== team.id ? null : open.kind === "move" ? (
      <MoveTeamPanel team={team} waves={moveWaves(team)} scheduled={scheduled} awards={awards} onClose={() => setOpen(null)} onDone={done} onStale={() => router.refresh()} />
    ) : (
      <ReleasePanel team={team} waveNumber={waveOf(team)?.number ?? null} onClose={() => setOpen(null)} onDone={done} />
    );

  const grid = {
    placement,
    canPlace,
    pending,
    canEditTeams: canEditTeams && !pending,
    studioName,
    onMove: (team: SetupTeam) => { setMessage(""); setOpen({ teamId: team.id, kind: "move" }); },
    onRelease: (team: SetupTeam) => { setMessage(""); setOpen({ teamId: team.id, kind: "release" }); },
    onCycle: cycleMembership,
    panelFor,
  };

  return (
    <div>
      <div className="wave-board-head">
        <div>
          <div className="page-eyebrow">{t("Event day schedule")}</div>
          <h1 className="page-title" style={{ fontSize: 40 }}>
            {t("Wave assignment")}
          </h1>
        </div>
      </div>

      {!detailId ? (
        <ScheduleControls
          seriesId={seriesId}
          scheduled={scheduled}
          plan={plan}
          settingsHref={settingsHref}
          canBuild={canBuild}
          canRebuild={canRebuild}
          waveCount={waves.length}
          nextNumber={highest + 1}
          capacity={waveCapacity}
          manualCount={teams.filter((team) => team.slotManual && team.waveId).length}
        />
      ) : null}

      {message ? (
        <div className="notice" role="status" style={{ marginTop: 12 }} data-testid="board-message">
          {message}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 22 }}>
        {waves.filter(wave => !detailId || wave.id === detailId).map((wave) => mobile && !detailId ? <DetailLink key={wave.id} href={`${path}/${wave.id}`}><strong>{t("Wave")} {wave.number}</strong><span>{wave.startTime} · {wave.blockCategory ? t("{category} block", { category: t(wave.blockCategory) }) : ""} · {teams.filter(team => team.waveId === wave.id).length} {t("Teams")}</span><span className="badge badge-neutral">{t(wave.status === "running" ? "On the floor" : wave.status === "complete" ? "Complete" : "Not started")}</span></DetailLink> : (
          <WaveCard
            key={wave.id}
            wave={wave}
            scheduled={scheduled}
            inWave={teams.filter((team) => team.waveId === wave.id)}
            isAdmin={canBuild}
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
