"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { DetailLink, useListFilter } from "@/components/app/detail-link";
import { useIsMobile } from "@/components/app/use-mobile";
import { FilterSheet } from "@/components/app/filter-sheet";

import { useT } from "@/components/i18n/locale-provider";
import { fmt } from "@/lib/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// THE RESULTS, FOR THE PEOPLE RUNNING THE COMPETITION.
//
// This is not the competitor's "find your result" flow — BFT MENA already
// knows who they are. It is the whole field: the podium of every bracket, then
// every team in order with its zone breakdown, filterable and exportable.
//
// A competitor-facing lookup is a different screen for a different person, and
// putting that one here is what made this section feel wrong.
// ─────────────────────────────────────────────────────────────────────────────

export type ResultRow = {
  id: string;
  rank: number;
  number: number;
  name: string;
  category: string;
  division: string;
  wave: number;
  studioName: string | null;
  competitors: string[];
  submitted: boolean;
  total: number;
  zones: { number: number; name: string; points: number }[];
};

export type PodiumBlock = {
  label: string;
  category: string;
  division: string;
  places: { id: string; rank: number; name: string; studioName: string | null; total: number }[];
};

const MEDAL = ["", "🥇", "🥈", "🥉"];

export function ResultsTable({
  podiums,
  rows,
  brackets,
  studios,
  zoneNames,
  exportHref,
  detailId,
}: {
  podiums: PodiumBlock[];
  rows: ResultRow[];
  brackets: string[];
  studios: string[];
  zoneNames: { number: number; name: string }[];
  exportHref: string;
  detailId?: string;
}) {
  const t = useT();
  const [bracket, setBracket] = useListFilter("bracket");
  const [studio, setStudio] = useListFilter("studio");
  const [query, setQuery] = useListFilter("q", "");
  const [open, setOpen] = useState<string | null>(null);
  const path = usePathname();
  const mobile = useIsMobile();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (bracket !== "all" && `${row.category} ${row.division}` !== bracket) return false;
      if (studio !== "all" && row.studioName !== studio) return false;
      if (!needle) return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        String(row.number) === needle ||
        row.competitors.some((person) => person.toLowerCase().includes(needle))
      );
    });
  }, [rows, bracket, studio, query]);

  const scored = rows.filter((row) => row.submitted).length;

  if (detailId) {
    const row = rows.find((row) => row.id === detailId)!;
    return <article className="mobile-detail"><h1>{row.name}</h1><p>{row.competitors.join(" · ")}</p><dl><dt>{t("Rank")}</dt><dd>{row.submitted ? row.rank : "—"}</dd><dt>{t("Total")}</dt><dd>{row.submitted ? fmt(row.total,2) : t("no score")}</dd><dt>{t("Bracket")}</dt><dd>{t(row.category)} · {t(row.division)}</dd><dt>{t("Wave")}</dt><dd>{row.wave}</dd><dt>{t("Studio")}</dt><dd>{row.studioName ?? t("Non-member")}</dd></dl>{row.zones.map((zone) => <div key={zone.number} className="mobile-list-card"><div><strong>{t("Zone")} {zone.number}</strong><small>{zone.name}</small></div><strong className="pd-num">{row.submitted ? fmt(zone.points,2) : "—"}</strong></div>)}</article>;
  }

  return (
    <>
      {/* ── The podiums ──────────────────────────────────────────────────── */}
      <h2 className="section-title">{t("Podiums")}</h2>
      <div className="podium-grid">
        {podiums.map((block) => (
          <article key={block.label} className="podium-block">
            <div className="podium-bracket">{block.label}</div>
            {block.places.length === 0 ? (
              <div className="podium-empty">{t("Not yet decided")}</div>
            ) : (
              block.places.map((place) => (
                <div key={place.id} className="podium-place" data-rank={place.rank}>
                  <span className="podium-medal" aria-hidden>
                    {MEDAL[place.rank] ?? place.rank}
                  </span>
                  <span className="podium-who">
                    <span className="podium-name">{place.name}</span>
                    {place.studioName ? (
                      <span className="podium-studio">{place.studioName}</span>
                    ) : null}
                  </span>
                  <span className="podium-total pd-num">{fmt(place.total, 2)}</span>
                </div>
              ))
            )}
          </article>
        ))}
      </div>

      {/* ── The whole field ──────────────────────────────────────────────── */}
      <h2 className="section-title" style={{ marginTop: 32 }}>
        {t("Every team")}
      </h2>

      <div className="reg-filters">
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search team, competitor or number…")}
          aria-label={t("Search results")}
          style={{ flex: "1 1 220px", minWidth: 0 }}
        />
        <FilterSheet><select
          className="input"
          value={bracket}
          onChange={(e) => setBracket(e.target.value)}
          aria-label={t("Bracket")}
        >
          <option value="all">{t("All brackets")}</option>
          {brackets.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={studio}
          onChange={(e) => setStudio(e.target.value)}
          aria-label={t("Studio")}
        >
          <option value="all">{t("All studios")}</option>
          {studios.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
        </FilterSheet><div className="reg-filters-count">
          {visible.length === rows.length
            ? `${rows.length} ${t("teams")} · ${scored} ${t("scored")}`
            : `${visible.length} ${t("of")} ${rows.length}`}
          <a className="linkish" href={exportHref} style={{ marginInlineStart: 10 }}>
            {t("Export CSV")}
          </a>
        </div>
      </div>

      {mobile ? <div className="mobile-list">{visible.length ? visible.map((row) => <DetailLink key={row.id} href={`${path}/${row.id}`}><span className="pd-num">{row.submitted ? `#${row.rank}` : "—"}</span><div><strong>{row.name}</strong><small>{row.competitors.join(" · ")}</small><small>{t(row.category)} · {t(row.division)}</small></div><strong className="pd-num">{row.submitted ? fmt(row.total,2) : "—"}</strong><span aria-hidden="true">›</span></DetailLink>) : <p className="notice">{t("No teams match those filters.")}</p>}</div> : <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 64 }}>{t("Rank")}</th>
              <th>{t("Team")}</th>
              <th style={{ width: 130 }}>{t("Bracket")}</th>
              <th style={{ width: 60 }}>{t("Wave")}</th>
              {zoneNames.map((zone) => (
                <th key={zone.number} style={{ width: 84, textAlign: "end" }} title={zone.name}>
                  Z{zone.number}
                </th>
              ))}
              <th style={{ width: 110, textAlign: "end" }}>{t("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5 + zoneNames.length} className="muted">
                  {t("No teams match those filters.")}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <RowPair
                  key={row.id}
                  row={row}
                  zoneCount={zoneNames.length}
                  open={open === row.id}
                  onToggle={() => setOpen(open === row.id ? null : row.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>}
    </>
  );
}

function RowPair({
  row,
  zoneCount,
  open,
  onToggle,
}: {
  row: ResultRow;
  zoneCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();

  return (
    <>
      <tr data-unscored={!row.submitted || undefined}>
        <td className="pd-num" style={{ fontFamily: "var(--font-heading)", fontWeight: 700 }}>
          {row.submitted ? row.rank : "—"}
        </td>
        <td>
          <button type="button" className="linkish" onClick={onToggle} aria-expanded={open}>
            <strong>{row.name}</strong>
          </button>
          <div className="reg-sub">
            {row.competitors.join(" · ")}
            {row.studioName ? ` — ${row.studioName}` : ""}
          </div>
        </td>
        <td>
          {t(row.category)} {t(row.division)}
        </td>
        <td className="pd-num">{row.wave}</td>
        {row.zones.map((zone) => (
          <td key={zone.number} className="pd-num" style={{ textAlign: "end" }}>
            {row.submitted ? fmt(zone.points, Number.isInteger(zone.points) ? 0 : 2) : "—"}
          </td>
        ))}
        <td className="pd-num" style={{ textAlign: "end", fontWeight: 700 }}>
          {row.submitted ? fmt(row.total, 2) : t("no score")}
        </td>
      </tr>

      {open ? (
        <tr className="reg-detail">
          <td colSpan={5 + zoneCount}>
            <div className="reg-detail-grid">
              <div>
                <div className="console-group-title">{t("Team")}</div>
                <div style={{ marginTop: 6, fontSize: 14 }}>
                  #{row.number} · {t("Wave")} {row.wave}
                </div>
                {row.competitors.map((person) => (
                  <div key={person} className="reg-sub">
                    {person}
                  </div>
                ))}
                <div className="reg-sub">{row.studioName ?? t("Non-member")}</div>
              </div>

              {row.zones.map((zone) => (
                <div key={zone.number}>
                  <div className="console-group-title">
                    {t("Zone")} {zone.number}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13 }}>{zone.name}</div>
                  <div
                    className="pd-num"
                    style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22 }}
                  >
                    {fmt(zone.points, Number.isInteger(zone.points) ? 0 : 2)}
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
