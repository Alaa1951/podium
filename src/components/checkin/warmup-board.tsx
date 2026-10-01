"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useState, useTransition } from "react";

import { SearchBox, useUrlFilters } from "@/components/app/search-box";
import { useT } from "@/components/i18n/locale-provider";
import { setWarmupReadiness } from "@/lib/actions/checkin";
import { arrivalStatus, matchesWarmup, waiversDone, warmupGroups, warmupTotals, type CheckInTeam, type WarmupWave } from "@/lib/checkin";
import type { TeamGaps } from "@/lib/readiness";
import { gapLines, waiverBadge } from "@/lib/readiness-messages";
import { CATEGORIES, DIVISIONS } from "@/lib/scoring";
import { waiverSatisfied } from "@/lib/waivers/status";
import { privacyReview } from "@/lib/category-schedule";

// ─────────────────────────────────────────────────────────────────────────────
// WARM-UP CHECK-IN — which teams are ready to compete.
//
// One checklist per wave, in running order, each team on its station.
// WARM-UP CHECK-IN marks a team ready for its wave; it needs every athlete
// signed (their own waiver) and checked in at the entrance, and a refusal
// says who is missing what. WARM-UP CHECK-OUT takes readiness back — always
// allowed. Readiness belongs to one wave: a team moved to another wave shows
// as not ready until it checks in again. Arriving never ticks this list.
// ─────────────────────────────────────────────────────────────────────────────

const FILTER_KEYS = ["q", "category", "division", "wave", "readiness", "waiver"] as const;

export function WarmupBoard({ teams, waves, canMark, waiverRequired = false }: { teams: CheckInTeam[]; waves: WarmupWave[]; canMark: boolean; waiverRequired?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [refusal, setRefusal] = useState<TeamGaps | null>(null);
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const query = useDeferredValue(filters.q);

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 10_000);
    return () => clearInterval(poll);
  }, [router]);

  const totals = warmupTotals(teams);
  const groups = warmupGroups(teams, waves);
  const matches = (team: CheckInTeam) => matchesWarmup(team, { ...filters, q: query });
  const shown = teams.filter(matches).length;
  const filtered = Boolean(filters.q || filters.category || filters.division || filters.wave || filters.readiness || filters.waiver);

  function mark(team: CheckInTeam) {
    if (!canMark) return;
    setError("");
    setRefusal(null);
    startTransition(async () => {
      try {
        const result = await setWarmupReadiness({ teamId: team.id, ready: !team.ready });
        if (!result.ok && result.error === "PREREQUISITES" && result.gaps) setRefusal(result.gaps);
        else if (!result.ok) {
          setError(
            result.error === "SERIES_FINISHED"
              ? t("This competition is finished.")
              : t("Could not save. Check your connection and try again.")
          );
        }
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      }
    });
  }

  const waveStatus = (wave: WarmupWave) => (wave.status === "running" ? t("Running now") : wave.status === "complete" ? t("Finished") : t("Upcoming"));

  return (
    <div className="checkin">
      <div className="checkin-figures checkin-figures-wide">
        <div className="stat-card">
          <span className="stat-label">{t("Teams")}</span>
          <span className="stat-value pd-num">{totals.teams}</span>
        </div>
        <div className="stat-card" data-tone="ok">
          <span className="stat-label">{t("Ready teams")}</span>
          <span className="stat-value pd-num">{totals.ready}</span>
          <span className="stat-note">{t("marked ready in warm-up")}</span>
        </div>
        <div className="stat-card" data-tone={totals.pending ? "warn" : undefined}>
          <span className="stat-label">{t("Pending teams")}</span>
          <span className="stat-value pd-num">{totals.pending}</span>
          <span className="stat-note">{t("not marked ready yet")}</span>
        </div>
      </div>

      <div className="list-toolbar">
        <SearchBox
          value={filters.q}
          onChange={(q) => setFilters({ q })}
          placeholder={t("Search team, athlete or team number…")}
          label={t("Search warm-up")}
          shown={shown}
          total={teams.length}
        />
        <div className="list-toolbar-filters">
          <select className="input" value={filters.wave} onChange={(event) => setFilters({ wave: event.target.value })} aria-label={t("Wave")}>
            <option value="">{t("All waves")}</option>
            {groups.map((group) =>
              group.wave ? (
                <option key={group.wave.id} value={group.wave.id}>
                  {t("Wave")} {group.wave.number}
                </option>
              ) : (
                <option key="none" value="none">
                  {t("Not in a wave")}
                </option>
              )
            )}
          </select>
          <select className="input" value={filters.category} onChange={(event) => setFilters({ category: event.target.value })} aria-label={t("Category")}>
            <option value="">{t("All categories")}</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
          <select className="input" value={filters.division} onChange={(event) => setFilters({ division: event.target.value })} aria-label={t("Level")}>
            <option value="">{t("All levels")}</option>
            {DIVISIONS.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
          <select className="input" value={filters.readiness} onChange={(event) => setFilters({ readiness: event.target.value })} aria-label={t("Readiness")}>
            <option value="">{t("Ready and pending")}</option>
            <option value="ready">{t("Ready")}</option>
            <option value="pending">{t("Not ready yet")}</option>
          </select>
          {waiverRequired ? (
            <select className="input" value={filters.waiver} onChange={(event) => setFilters({ waiver: event.target.value })} aria-label={t("Waiver")}>
              <option value="">{t("Any waiver status")}</option>
              <option value="signed">{t("Everybody signed")}</option>
              <option value="pending">{t("Waiver acceptance required")}</option>
            </select>
          ) : null}
          {filtered ? (
            <button type="button" className="linkish" onClick={() => setFilters({ q: "", category: "", division: "", wave: "", readiness: "", waiver: "" })}>
              {t("Clear")}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="notice-error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {teams.length === 0 ? (
        <div className="notice">{t("No teams to check in yet.")}</div>
      ) : shown === 0 ? (
        <div className="notice">
          <strong>{t("Nobody matches.")}</strong> {t("Clear the search or the filters.")}
        </div>
      ) : null}

      {groups.map((group) => {
        const visible = group.teams.filter(matches);
        if (!visible.length) return null;
        return (
          <section key={group.wave?.id ?? "none"} className="card warmup-group" data-testid={`warmup-wave-${group.wave?.number ?? "none"}`}>
            <div className="marshal-move pd-num">
              <strong>{group.wave ? `${t("Wave")} ${group.wave.number}` : t("Not in a wave yet")}</strong>
              {group.wave ? (
                <span>
                  {group.wave.startTime} · {waveStatus(group.wave)}
                </span>
              ) : null}
              <span className="warmup-count">
                <span className="badge badge-ok">{t("{count} ready", { count: group.ready })}</span>{" "}
                <span className={group.pending ? "badge badge-warn" : "badge badge-neutral"}>{t("{count} pending", { count: group.pending })}</span>
              </span>
            </div>

            <ul className="warmup-list">
              {visible.map((team) => {
                const arrival = arrivalStatus(team);
                const here = team.athletes.filter((athlete) => athlete.arrived).length;
                return (
                  <li key={team.id} className="warmup-row" data-ready={team.ready || undefined} data-testid={`warmup-team-${team.number}`}>
                    <span className="station-number" title={t("Station")}>{team.station ?? "?"}</span>
                    <div className="marshal-cell-body">
                      <div>
                        <strong>
                          <span className="pd-num">#{team.number}</span> {team.name}
                        </strong>
                      </div>
                      <div className="reg-sub">{team.athletes.map((athlete) => athlete.fullName).join(" · ")}</div>
                      <div className="reg-sub">
                        {t(team.category)} · {t(team.division)}
                        {team.studio ? ` · ${team.studio}` : ""}
                      </div>
                      {team.outsideBlock ? (
                        <div className="reg-sub" data-testid="warmup-outside-block">
                          <span className="badge badge-warn">
                            {team.hostBlock
                              ? t("Runs in the {block} block — competes as {category}", { block: t(team.hostBlock), category: t(team.category) })
                              : t("Runs outside the category schedule — competes as {category}", { category: t(team.category) })}
                          </span>
                          {privacyReview(team.category, team.hostBlock ?? null) ? <span className="badge badge-danger" data-testid="warmup-privacy">{t("Privacy review before the wave")}</span> : null}
                        </div>
                      ) : null}
                      <div className="chip-row" style={{ marginTop: 6 }}>
                        {/* Read-only here: the entrance desk's fact, beside this desk's own. */}
                        <span className="reg-sub">{t("Entrance")}:</span>
                        {arrival === "in" ? (
                          <span className="badge badge-ok">{t("Arrived")}</span>
                        ) : arrival === "partial" ? (
                          <span className="badge badge-warn">{t("Partly arrived — {here} of {total}", { here, total: team.athletes.length })}</span>
                        ) : (
                          <span className="badge badge-neutral">{t("Not arrived")}</span>
                        )}
                        <span className="reg-sub">{t("Warm-up")}:</span>
                        {team.ready ? <span className="badge badge-ok">{t("Ready")}</span> : <span className="badge badge-warn">{t("Not ready yet")}</span>}
                        {waiverRequired ? (
                          <>
                            <span className="reg-sub">{t("Waiver")}:</span>
                            {waiversDone(team)
                              ? <span className="badge badge-ok" data-testid="team-waivers">{t("Everybody signed")}</span>
                              : team.athletes.filter((athlete) => !waiverSatisfied(athlete.waiver)).map((athlete) => {
                                  const badge = waiverBadge(athlete.waiver)!;
                                  return <span key={athlete.id} className={"badge " + badge.tone} data-testid="team-waivers">{athlete.fullName}: {t(badge.label)}</span>;
                                })}
                          </>
                        ) : null}
                      </div>
                      {refusal && refusal.team.id === team.id ? (
                        <div className="notice-error checkin-refusal" role="alert" data-testid="warmup-refusal">
                          <strong>{t("Not checked in at warm-up.")}</strong>
                          <ul>
                            {gapLines(refusal, t).map((line) => <li key={line.who}><strong>{line.who}:</strong> {line.what.join(" · ")}</li>)}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    {canMark ? (
                      <button type="button" className={team.ready ? "btn btn-ghost" : "btn btn-primary"} disabled={pending} onClick={() => mark(team)}>
                        {team.ready ? t("Warm-up check-out") : t("Warm-up check-in")}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
