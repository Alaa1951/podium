"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useState, useTransition } from "react";

import { SearchBox, useUrlFilters } from "@/components/app/search-box";
import { BracketChange } from "@/components/bracket/bracket-change";
import { CheckInTotalsPanel } from "@/components/checkin/checkin-totals";
import { useT } from "@/components/i18n/locale-provider";
import { setAthleteAttendance } from "@/lib/actions/checkin";
import { setAttendance } from "@/lib/actions/payments";
import type { BracketFacts } from "@/lib/bracket";
import { arrivalStatus, checkInTotals, matchesEntrance, totalsByBracket, type CheckInTeam } from "@/lib/checkin";
import type { TeamGaps } from "@/lib/readiness";
import { gapLines, waiverBadge } from "@/lib/readiness-messages";
import { CATEGORIES, DIVISIONS } from "@/lib/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// ENTRANCE CHECK-IN — who has arrived at the venue.
//
// One card per team, one line per athlete: each person is checked in — or
// out — with their own button, or the whole team at once. Where the
// competition asks for a waiver, each athlete's own signature comes first:
// the line says so, and a refused check-in names who is missing what; the
// athlete signs on their own phone and the desk simply tries again. A team is "checked in" only
// when everybody on it is; one of two is "partly arrived" and says who is
// missing. The totals count teams and athletes separately and are recounted
// from the same rows after every press. The page re-reads the server every
// ten seconds, so two desks see each other's check-ins.
//
// This screen never marks anybody ready to compete: that is the warm-up desk.
// ─────────────────────────────────────────────────────────────────────────────

const FILTER_KEYS = ["q", "category", "division", "status", "waiver"] as const;

export function EntranceBoard({
  teams,
  canCheckIn,
  brackets,
  waiverRequired = false,
}: {
  teams: CheckInTeam[];
  /** The competition asks every athlete to sign a waiver before entry. */
  waiverRequired?: boolean;
  /** Holds entrance check-in (registrations.attendance): the buttons work. */
  canCheckIn: boolean;
  /** Per team, for staff who may change a category or level; null for everybody else. */
  brackets: Record<string, BracketFacts> | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<TeamGaps | null>(null);
  const [filters, setFilters] = useUrlFilters(FILTER_KEYS);
  const query = useDeferredValue(filters.q);

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 10_000);
    return () => clearInterval(poll);
  }, [router]);

  const totals = checkInTotals(teams);
  const visible = teams.filter((team) => matchesEntrance(team, { ...filters, q: query }));
  const filtered = Boolean(filters.q || filters.category || filters.division || filters.status || filters.waiver);

  function run(key: string, action: () => Promise<{ ok: boolean; error?: string; gaps?: TeamGaps }>) {
    if (!canCheckIn) return;
    setError("");
    setRefusal(null);
    setBusy(key);
    startTransition(async () => {
      try {
        const result = await action();
        // Refused for a reason somebody can fix: say who and what, at the team.
        if (!result.ok && result.error === "PREREQUISITES" && result.gaps) setRefusal(result.gaps);
        else if (!result.ok) setError(t("Could not save. Check your connection and try again."));
        router.refresh();
      } catch {
        setError(t("Could not save. Check your connection and try again."));
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="checkin">
      <CheckInTotalsPanel
        totals={totals}
        brackets={totalsByBracket(teams)}
        selected={{ category: filters.category, division: filters.division }}
        onSelect={(category, division) => setFilters({ category, division })}
      />

      <div className="list-toolbar">
        <SearchBox
          value={filters.q}
          onChange={(q) => setFilters({ q })}
          placeholder={t("Search team, athlete or team number…")}
          label={t("Search check-in")}
          shown={visible.length}
          total={teams.length}
        />
        <div className="list-toolbar-filters">
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
          <select className="input" value={filters.status} onChange={(event) => setFilters({ status: event.target.value })} aria-label={t("Check-in status")}>
            <option value="">{t("Any check-in status")}</option>
            <option value="in">{t("Checked in")}</option>
            <option value="pending">{t("Not yet checked in")}</option>
            <option value="partial">{t("Partly arrived")}</option>
          </select>
          {waiverRequired ? (
            <select className="input" value={filters.waiver} onChange={(event) => setFilters({ waiver: event.target.value })} aria-label={t("Waiver")}>
              <option value="">{t("Any waiver status")}</option>
              <option value="signed">{t("Everybody signed")}</option>
              <option value="pending">{t("Waiver acceptance required")}</option>
            </select>
          ) : null}
          {filtered ? (
            <button type="button" className="linkish" onClick={() => setFilters({ q: "", category: "", division: "", status: "", waiver: "" })}>
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
      ) : visible.length === 0 ? (
        <div className="notice">
          <strong>{t("Nobody matches.")}</strong> {t("Clear the search or the filters.")}
        </div>
      ) : null}

      <div className="checkin-list">
        {visible.map((team) => {
          const status = arrivalStatus(team);
          const here = team.athletes.filter((athlete) => athlete.arrived).length;
          const facts = brackets?.[team.id];
          return (
            <section key={team.id} className="card checkin-team" data-status={status} data-testid={`checkin-team-${team.number}`}>
              <div className="checkin-team-head">
                <div className="checkin-team-name">
                  <strong>
                    <span className="pd-num">#{team.number}</span> {team.name}
                  </strong>
                  <div className="reg-sub">
                    {t(team.category)} · {t(team.division)}
                    {team.waveNumber !== null ? ` · ${t("Wave")} ${team.waveNumber}` : ""}
                    {team.station !== null ? ` · ${t("Station {station}", { station: team.station })}` : ""}
                    {team.studio ? ` · ${team.studio}` : ""}
                  </div>
                </div>
                <div className="chip-row">
                  {status === "in" ? (
                    <span className="badge badge-ok">{t("Checked in")}</span>
                  ) : status === "partial" ? (
                    <span className="badge badge-warn">{t("Partly arrived — {here} of {total}", { here, total: team.athletes.length })}</span>
                  ) : (
                    <span className="badge badge-neutral">{t("Not checked in")}</span>
                  )}
                  {!team.competing ? <span className="badge badge-danger">{t("Unpaid")}</span> : null}
                </div>
              </div>

              <ul className="checkin-athletes">
                {team.athletes.map((athlete) => {
                  const waiver = waiverBadge(athlete.waiver);
                  return (
                    <li key={athlete.id} data-testid={`checkin-athlete-${athlete.id}`}>
                      <span className="checkin-athlete-name">{athlete.fullName}</span>
                      {athlete.arrived ? (
                        <span className="badge badge-ok">{t("Arrived")}</span>
                      ) : (
                        <span className="badge badge-neutral">{t("Not arrived")}</span>
                      )}
                      {waiver ? <span className={`badge ${waiver.tone}`} data-testid="athlete-waiver" data-state={athlete.waiver}>{t(waiver.label)}</span> : null}
                      {canCheckIn ? (
                        <button
                          type="button"
                          className={athlete.arrived ? "btn btn-sm btn-ghost" : "btn btn-sm btn-primary"}
                          disabled={pending}
                          aria-busy={busy === athlete.id || undefined}
                          onClick={() => run(athlete.id, () => setAthleteAttendance({ competitorId: athlete.id, attended: !athlete.arrived }))}
                        >
                          {athlete.arrived ? t("Check out") : t("Check in")}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {refusal && refusal.team.id === team.id ? (
                <div className="notice-error checkin-refusal" role="alert" data-testid="checkin-refusal">
                  <strong>{t("Not checked in — nobody on this team was checked in.")}</strong>
                  <ul>
                    {gapLines(refusal, t).map((line) => <li key={line.who}><strong>{line.who}:</strong> {line.what.join(" · ")}</li>)}
                  </ul>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setRefusal(null); router.refresh(); }}>{t("Check again")}</button>
                </div>
              ) : null}

              {canCheckIn || facts ? (
                <div className="checkin-team-actions">
                  {canCheckIn && status !== "in" ? (
                    <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(team.id, () => setAttendance({ teamId: team.id, attended: true }))}>
                      {t("Check in whole team")}
                    </button>
                  ) : null}
                  {canCheckIn && status !== "out" ? (
                    <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run(team.id, () => setAttendance({ teamId: team.id, attended: false }))}>
                      {t("Check out whole team")}
                    </button>
                  ) : null}
                  {facts && changing !== team.id ? (
                    <button type="button" className="btn btn-ghost" onClick={() => setChanging(team.id)}>
                      {t("Category / level…")}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {facts && changing === team.id ? (
                <div className="checkin-bracket">
                  <BracketChange facts={facts} mode="staff" teamLabel={`#${team.number} ${team.name}`} startOpen />
                  <button type="button" className="linkish" onClick={() => setChanging(null)}>
                    {t("Close")}
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
