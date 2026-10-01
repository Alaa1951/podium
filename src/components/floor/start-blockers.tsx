"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/i18n/locale-provider";
import type { TeamGaps } from "@/lib/readiness";
import { gapLines } from "@/lib/readiness-messages";

/**
 * Why a wave cannot start — by team, then by athlete, each with what is
 * missing — and where each can be put right: the entrance desk, this wave's
 * warm-up checklist. A missing waiver is the athlete's own to sign, on their
 * own phone: no desk can do it for them.
 */
export function StartBlockers({ waveNumber, waveId, blockers, onClose }: { waveNumber: number; waveId: string; blockers: TeamGaps[]; onClose: () => void }) {
  const t = useT();
  const path = usePathname();
  const base = /^\/(series|studio)\/[^/]+/.exec(path)?.[0] ?? null;
  const needs = (kind: string) => blockers.some((one) => one.gaps.includes(kind as never) || one.athletes.some((athlete) => athlete.gaps.includes(kind as never)));
  return (
    <section className="notice-error start-blockers" role="alert" data-testid="start-blockers">
      <strong>{t("Wave {wave} cannot start yet. Every athlete must be registered, signed, checked in, and ready in warm-up for this wave.", { wave: waveNumber })}</strong>
      {blockers.map((team) => (
        <div key={team.team.id} className="start-blocker-team" data-testid={`start-blocker-${team.team.number}`}>
          <strong>#{team.team.number} {team.team.name}</strong>
          <ul>
            {gapLines(team, t).map((line) => (
              <li key={line.who}>{line.who === `#${team.team.number} ${team.team.name}` ? null : <strong>{line.who}: </strong>}{line.what.join(" · ")}</li>
            ))}
          </ul>
        </div>
      ))}
      <div className="chip-row">
        {base && needs("entrance") ? <Link href={`${base}/check-in`} className="btn btn-sm btn-secondary">{t("Entrance check-in")}</Link> : null}
        {base && needs("warmup") ? <Link href={`${base}/warm-up?wave=${encodeURIComponent(waveId)}`} className="btn btn-sm btn-secondary">{t("Warm-up check-in")}</Link> : null}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t("Close")}</button>
      </div>
      {needs("waiver") || needs("waiver_resign") || needs("account") ? (
        <p className="field-note" style={{ margin: 0 }}>{t("A waiver is signed by the athlete alone, on their own phone: PODIUM → Waiver Declarations. Staff cannot sign for them.")}</p>
      ) : null}
    </section>
  );
}
