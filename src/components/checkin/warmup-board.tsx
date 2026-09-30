"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useState, useTransition } from "react";

import { SearchBox, useUrlFilters } from "@/components/app/search-box";
import { useT } from "@/components/i18n/locale-provider";
import { setWarmupReadiness } from "@/lib/actions/checkin";
import { arrivalStatus, matchesWarmup, warmupGroups, warmupTotals, type CheckInTeam, type WarmupWave } from "@/lib/checkin";
import { CATEGORIES, DIVISIONS } from "@/lib/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// WARM-UP CHECK-IN — which teams are ready to compete.
//
// One checklist per wave, in running order, each team on its station. The
// button marks a team READY once its preparation is complete. Beside it, for
// reading only, is what the entrance desk recorded — arrived, partly arrived,
// not arrived — so "here" and "ready" are never mistaken for each other:
// arriving does not tick this list, and ticking it does not check anyone in.
// ─────────────────────────────────────────────────────────────────────────────

const FILTER_KEYS = ["q", "category", "division", "wave", "readiness"] as const;

export function WarmupBoard({ teams, waves, canMark }: { teams: CheckInTeam[]; waves: WarmupWave[]; canMark: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
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
  const filtered = Boolean(filters.q || filters.category || filters.division || filters.wave || filters.readiness);
  const readyNotArrived = teams.filter((team) => team.ready && arrivalStatus(team) !== "in").length;

  function mark(team: CheckInTeam) {
    if (!canMark) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await setWarmupReadiness({ teamId: team.id, ready: !team.ready });
        if (!result.ok) {
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

      {readyNotArrived ? (
        <div className="notice" style={{ marginTop: 12 }}>
          {t("{count} ready team(s) are not fully checked in at the entrance. Readiness does not check anyone in.", { count: readyNotArrived })}
        </div>
      ) : null}

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
          {filtered ? (
            <button type="button" className="linkish" onClick={() => setFilters({ q: "", category: "", division: "", wave: "", readiness: "" })}>
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
                      </div>
                    </div>
                    {canMark ? (
                      <button type="button" className={team.ready ? "btn btn-ghost" : "btn btn-primary"} disabled={pending} onClick={() => mark(team)}>
                        {team.ready ? t("Undo ready") : t("Mark ready")}
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
