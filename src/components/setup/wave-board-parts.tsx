"use client";

import type { ReactNode } from "react";

import { useT } from "@/components/i18n/locale-provider";

/** A team in the running order, and one field of a wave's settings. */
export type SetupTeam = {
  id: string;
  number: number;
  name: string;
  category: string;
  division: string;
  wave: number;
  waveId: string | null;
  /** 1–9: where the team stands in every zone of its wave. */
  station: number | null;
  /** RUNNING MANUALLY: placed by hand; Auto Assign keeps it exactly here. */
  slotManual: boolean;
  /** A zone of its score is submitted: its slot is final. */
  scored: boolean;
  competitors: { id: string; fullName: string; studioId: string | null }[];
};

/** Where the team runs against where its category runs — computed by the board. */
export type TeamPlacement = {
  /** The block this team stands in is not its own category's. */
  outsideBlock: boolean;
  /** The block it stands in: a category, or null for a wave outside the schedule. */
  hostBlock: string | null;
  /** Women's and men's/mixed media rules meet here (category-schedule.ts › privacyReview). */
  privacyReview?: boolean;
  /** Its wave finishes after its own category's awards begin. */
  lateForAwards: { from: string; to: string } | null;
  /**
   * Why the team cannot be moved at all — said on its row instead of a Move
   * button that could only be refused: its wave has started (it ran, or
   * missed, that wave), or a zone of its score is submitted.
   */
  locked: { reason: "started"; wave: number } | { reason: "scored" } | null;
};

export function Field({
  label,
  name,
  value,
  min,
  max,
}: {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={`${name}-${value}`}>
        {label}
      </label>
      <input
        id={`${name}-${value}`}
        name={name}
        type="number"
        min={min}
        max={max}
        defaultValue={value}
        className="input pd-num"
        style={{ width: 92 }}
        required
      />
    </div>
  );
}

/**
 * One team on the running order: who they are, where they stand, and — for
 * whoever places teams — Move, and Return to Auto Assign for a team running
 * manually. Every placement goes through the move panel, which says what the
 * move means before it is confirmed.
 */
export function TeamRow({
  team,
  placement,
  canPlace,
  pending,
  canEditTeams,
  studioName,
  onMove,
  onRelease,
  onCycle,
  panel,
}: {
  team: SetupTeam;
  placement: TeamPlacement;
  /** waves.placeTeams: the Move and Return buttons. */
  canPlace: boolean;
  pending: boolean;
  /** The studio chips — registrations.edit, not placing. */
  canEditTeams: boolean;
  studioName: (id: string | null) => string;
  onMove: (team: SetupTeam) => void;
  onRelease: (team: SetupTeam) => void;
  onCycle: (competitorId: string, current: string | null) => void;
  /** The move or return panel open under this row, if any. */
  panel: ReactNode;
}) {
  const t = useT();

  return (
    <div className="setup-team-row" data-testid={`team-row-${team.number}`} data-manual={team.slotManual || undefined} data-outside={placement.outsideBlock || undefined}>
      <div className="setup-team-main">
        <span className="setup-team-station">
          <span className="pd-num" style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            {team.number}
          </span>
          <span className="station-number" title={t("Station")}>
            {team.station ?? "—"}
          </span>
        </span>

        <div style={{ minWidth: 0 }}>
          <div className="setup-team-name">{team.name}</div>
          <div className="team-row-bracket">
            <span className="badge badge-cyan">{t(team.category)}</span>
            <span className="badge badge-blue">{t(team.division)}</span>
            {team.slotManual ? <span className="badge badge-warn" data-testid="running-manually">{t("Running Manually")}</span> : null}
          </div>
          {placement.outsideBlock ? (
            <div className="setup-team-note" data-testid="outside-block">
              {placement.hostBlock
                ? t("Runs in the {block} block — competes, is ranked and awarded as {category} {division}.", {
                    block: t(placement.hostBlock), category: t(team.category), division: t(team.division),
                  })
                : t("Runs outside the category schedule — competes, is ranked and awarded as {category} {division}.", {
                    category: t(team.category), division: t(team.division),
                  })}
            </div>
          ) : null}
          {placement.privacyReview ? (
            <div className="setup-team-note setup-team-warn" data-testid="privacy-review">
              {t("Privacy review: the women's competition is never photographed or recorded (waiver §8), while the men's and mixed portions may be filmed (§9). This slot changes no category and gives no media consent — BFT MENA checks it before the wave.")}
            </div>
          ) : null}
          {placement.lateForAwards ? (
            <div className="setup-team-note setup-team-warn" data-testid="late-for-awards">
              {t("Finishes after the {category} awards period begins ({from}–{to}): {category} results are not complete until this wave ends.", {
                category: t(team.category), from: placement.lateForAwards.from, to: placement.lateForAwards.to,
              })}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
            {team.competitors.map((competitor) => (
              <button
                key={competitor.id}
                type="button"
                className="chip-sm"
                data-active={!!competitor.studioId}
                disabled={!canEditTeams}
                onClick={() => onCycle(competitor.id, competitor.studioId)}
                style={{ textAlign: "start" }}
              >
                {competitor.fullName} · {studioName(competitor.studioId)}
              </button>
            ))}
          </div>
        </div>

        {canPlace && placement.locked ? (
          <div className="setup-team-note setup-team-locked" data-testid="move-locked">
            {placement.locked.reason === "started"
              ? t("Wave {wave} has started: the team stays in it. Reset the wave on Wave control first to move it (only before any zone is submitted).", { wave: placement.locked.wave })
              : t("A zone of this team's score is submitted: its slot is final.")}
          </div>
        ) : canPlace ? (
          <div className="setup-team-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => onMove(team)}>
              {team.waveId ? t("Move…") : t("Place…")}
            </button>
            {team.slotManual ? (
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => onRelease(team)}>
                {t("Return to Auto Assign")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {panel}
    </div>
  );
}
