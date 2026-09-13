"use client";

import { useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { ScoreGridRow } from "@/components/scores/score-grid-row";
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
// ─────────────────────────────────────────────────────────────────────────────

export function ScoreGrid({
  teams,
  zones,
  editBudget,
  isAdmin,
  frozen,
  frozenReason,
}: {
  teams: GridTeam[];
  zones: ZoneDef[];
  editBudget: number;
  isAdmin: boolean;
  frozen: boolean;
  frozenReason?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);

  if (teams.length === 0) {
    return (
      <div className="notice">
        <strong>{t("No teams here yet.")}</strong>{" "}
        {t("Teams appear on this sheet once their registration is paid.")}
      </div>
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
