"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useT } from "@/components/i18n/locale-provider";
import { fmt } from "@/lib/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// THE PUBLISHED LEADERBOARD.
//
// Rank, team, studio, score — and nothing else, because that is what somebody
// scrolling on a phone is looking for. The top three carry their metal on the
// left edge and round their discs in a glow, the way the reference board does,
// because a podium is the one thing on the page meant to be seen from across
// the room.
//
// It polls the public results endpoint — published data only — so a late
// correction BFT MENA makes reaches a screen that has been hanging on the gym
// wall all day without anybody reloading it. The "updating in" countdown sits
// top right, where the reference puts it.
// ─────────────────────────────────────────────────────────────────────────────

export type BoardRow = {
  id: string;
  rank: number;
  name: string;
  competitors: string[];
  studioName: string | null;
  total: number;
};

const REFRESH_SECONDS = 20;

export function PublicResultsBoard({
  rows: initialRows,
  studios: initialStudios,
  category,
  division,
  seriesName,
  seriesSlug,
  showCompetitorNames,
  showStudioColumn,
}: {
  rows: BoardRow[];
  studios: string[];
  category: string;
  division: string;
  seriesName: string;
  seriesSlug: string;
  /** Whether this competition publishes the two names as well as the team. */
  showCompetitorNames: boolean;
  /** Whether the studio column is part of this event's public view at all. */
  showStudioColumn: boolean;
}) {
  const t = useT();
  const [studio, setStudio] = useState("__all");
  const [query, setQuery] = useState("");

  // The server render is the first frame; the poll keeps a screen that has
  // hung on a wall for days current without anyone touching it. Fresh props
  // (a server re-render) are adopted during render — the React-sanctioned
  // way — rather than inside an effect.
  const [rows, setRows] = useState(initialRows);
  const [studios, setStudios] = useState(initialStudios);
  const [lastInitial, setLastInitial] = useState({ rows: initialRows, studios: initialStudios });
  if (
    lastInitial.rows !== initialRows ||
    lastInitial.studios !== initialStudios
  ) {
    setLastInitial({ rows: initialRows, studios: initialStudios });
    setRows(initialRows);
    setStudios(initialStudios);
  }
  const [nextIn, setNextIn] = useState(REFRESH_SECONDS);

  useEffect(() => {
    let alive = true;

    const countdown = setInterval(() => {
      setNextIn((seconds) => (seconds > 0 ? seconds - 1 : REFRESH_SECONDS));
    }, 1000);

    const poll = setInterval(() => {
      fetch(`/api/results/${seriesSlug}/${category}/${division}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((view) => {
          if (!alive || !view) return;
          setRows(view.rows);
          setStudios(view.studios);
        })
        .catch(() => {
          // A gym's wifi drops; the wall keeps showing the last good data.
        });
    }, REFRESH_SECONDS * 1000);

    return () => {
      alive = false;
      clearInterval(countdown);
      clearInterval(poll);
    };
  }, [seriesSlug, category, division]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (studio !== "__all" && row.studioName !== studio) return false;
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.competitors.some((person) => person.toLowerCase().includes(needle))
      );
    });
  }, [rows, studio, query]);

  return (
    <>
      <div className="public-update" role="status">
        {t("Updating in")} <span className="pd-num">0:{String(nextIn).padStart(2, "0")}</span>
      </div>

      <div className="pb-titlerow">
        <h1 className="pb-title">
          <span className="pb-title-cat">{t(category)}</span>
          <span className="pb-title-dot">·</span>
          <span className="pb-title-div">{t(division)}</span>{" "}
          <span className="pb-title-word">{t("Leaderboard")}</span>
        </h1>
        <div className="pb-series">
          <span>{seriesName}</span>
          <i>{"///"}</i>
          <span>{seriesName}</span>
        </div>
      </div>

      <div className="pb-filters">
        {showStudioColumn ? (
          <select
            className="pb-select"
            value={studio}
            onChange={(e) => setStudio(e.target.value)}
            aria-label={t("Studio")}
          >
            <option value="__all">{t("All studios")}</option>
            {studios.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        ) : null}

        <input
          className="pb-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search by team…")}
          aria-label={t("Search by team")}
        />
      </div>

      <div className={`pb-head${showStudioColumn ? "" : " no-studio"}`}>
        <span>{t("Rank")}</span>
        <span>{t("Team")}</span>
        {showStudioColumn ? <span className="pb-head-studio">{t("Studio")}</span> : null}
        <span className="pb-head-score">{t("Score")}</span>
      </div>

      <div className="pb-rows">
        {visible.map((row, index) => (
          <Link
            key={row.id}
            href={`/results/${seriesSlug}/team/${row.id}`}
            className={`pb-row rise${showStudioColumn ? "" : " no-studio"}`}
            data-rank={row.rank <= 3 ? row.rank : undefined}
            style={{ animationDelay: `${Math.min(index, 14) * 35}ms` }}
          >
            <span className="pb-rank">{row.rank}</span>
            <span className="pb-team">
              <span className="pb-team-name">
                {showCompetitorNames && row.competitors.length
                  ? row.competitors.join(" & ")
                  : row.name}
              </span>
              {showCompetitorNames && row.competitors.length ? (
                <span className="pb-team-sub">{row.name}</span>
              ) : null}
            </span>
            {showStudioColumn ? <span className="pb-studio">{row.studioName ?? ""}</span> : null}
            <span className="pb-score">{fmt(row.total, 2)}</span>
          </Link>
        ))}

        {visible.length === 0 ? (
          <div className="pb-empty">{t("No teams match that search.")}</div>
        ) : null}
      </div>
    </>
  );
}
