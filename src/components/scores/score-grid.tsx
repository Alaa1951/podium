"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { ScoreGridRow } from "@/components/scores/score-grid-row";
import { ScoreTeamEntry } from "@/components/scores/score-team-entry";
import type { GridTeam } from "@/components/scores/score-grid-types";
import type { ZoneDef } from "@/lib/zones";

// ─────────────────────────────────────────────────────────────────────────────
// EVERY TEAM ON ONE SHEET.
//
// This is how the franchise manual enters scores, and with a hundred pairs it
// is the only way that is not painful: the person reading the judge's sheets
// works down the list without choosing a team, opening a screen, saving, and
// going back.
//
// The one-team card is not gone — clicking a team's name opens it underneath
// the row, because that card carries the outlier warning and the audit trail,
// which a single line has no room for. Both write through the same server
// action and calculate with the same functions, so they cannot disagree.
//
// On screens ≤720px the sheet is a plain list of team cards. Tapping a team
// opens that team's own full entry screen — one team on the page, movements
// stacked, each +1 a huge slab with its count under it — and Back returns to
// the top of the list. A judge on a phone never scrolls sideways and never
// edits a team inside a crowded sheet.
// ─────────────────────────────────────────────────────────────────────────────

export function useIsMobile(breakpoint = 720) {
  const query = `(max-width: ${breakpoint}px)`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // Server render has no viewport: the table ships first and the phone
    // swaps to cards on hydration, a frame later at most.
    () => false
  );
}

export function ScoreGrid({
  teams,
  zones,
  editBudget,
  budgetApplies = false,
  isAdmin,
  frozen,
  frozenReason,
}: {
  teams: GridTeam[];
  zones: ZoneDef[];
  editBudget: number;
  /** Only a studio is bound by the edit budget — the server's rule, mirrored. */
  budgetApplies?: boolean;
  isAdmin: boolean;
  frozen: boolean;
  frozenReason?: string;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState<string | null>(null);

  if (teams.length === 0) {
    return (
      <div className="notice">
        <strong>{t("No teams here yet.")}</strong>{" "}
        {t("Teams appear on this sheet once their registration is paid.")}
      </div>
    );
  }

  if (isMobile) {
    // The phone sheet is a list, and the list is all it ever is: tapping a
    // team swaps the whole page for that team's own entry screen, and Back
    // returns to the top of the list — never to a half-scrolled sheet.
    const openTeam = open ? (teams.find((team) => team.id === open) ?? null) : null;

    const toTop = () => window.scrollTo({ top: 0 });

    return (
      <>
        {frozen && frozenReason ? (
          <div className="notice notice-warn" style={{ marginBottom: 14 }}>
            {frozenReason}
          </div>
        ) : null}

        {openTeam ? (
          <ScoreTeamEntry
            team={openTeam}
            zones={zones}
            editBudget={editBudget}
            budgetApplies={budgetApplies}
            frozen={frozen}
            waveEndsAt={openTeam.waveEndsAt}
            onBack={() => {
              setOpen(null);
              toTop();
            }}
          />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {teams.map((team) => (
              <ScoreGridRow
                key={team.id}
                team={team}
                zones={zones}
                editBudget={editBudget}
                budgetApplies={budgetApplies}
                isAdmin={isAdmin}
                frozen={frozen}
                mobile
                expanded={false}
                onExpand={() => {
                  setOpen(team.id);
                  toTop();
                }}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {frozen && frozenReason ? (
        <div className="notice notice-warn" style={{ marginBottom: 14 }}>
          {frozenReason}
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="table score-grid">
          <thead>
            <tr>
              <th style={{ width: 56 }}>#</th>
              <th>{t("Team")}</th>
              {zones.map((zone) => (
                <th key={zone.id}>
                  <span className="grid-head-zone">
                    {t("Zone")} {zone.number}
                  </span>
                  <span className="grid-head-name">{t(zone.name)}</span>
                </th>
              ))}
              <th style={{ width: 96 }}>{t("Total")}</th>
              <th style={{ width: 56 }}>{t("Rank")}</th>
              <th style={{ width: 140 }}>{t("Status")}</th>
              <th style={{ width: 96 }} />
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <ScoreGridRow
                key={team.id}
                team={team}
                zones={zones}
                editBudget={editBudget}
                budgetApplies={budgetApplies}
                isAdmin={isAdmin}
                frozen={frozen}
                expanded={open === team.id}
                onExpand={() => setOpen((id) => (id === team.id ? null : team.id))}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
