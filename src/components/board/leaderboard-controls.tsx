"use client";

import { useT } from "@/components/i18n/locale-provider";
import { BRACKETS } from "@/lib/scoring";
import type { Category, Division } from "@/generated/prisma/enums";

// The three things above the ranking: which bracket, whose teams, and a search.
// Lifted out of leaderboard.tsx so the board file is the board and this is the
// controls — and so neither runs past a length anybody wants to read.

export function BracketChips({
  category,
  division,
  hasScores,
  onPick,
}: {
  category: Category;
  division: Division;
  /** Whether a bracket has anything in it — an empty one is dimmed, not hidden. */
  hasScores: (category: Category, division: Division) => boolean;
  onPick: (category: Category, division: Division) => void;
}) {
  const t = useT();

  return (
    <div className="board-brackets">
      {BRACKETS.map((bracket) => {
        const active = bracket.category === category && bracket.division === division;
        const populated = hasScores(bracket.category, bracket.division);
        return (
          <button
            key={`${bracket.category}-${bracket.division}`}
            type="button"
            className="chip chip-dark"
            data-active={active}
            onClick={() => onPick(bracket.category, bracket.division)}
            style={{ opacity: populated || active ? 1 : 0.45 }}
          >
            {t(bracket.category)} {t(bracket.division)}
          </button>
        );
      })}
    </div>
  );
}

export function BoardFilters({
  studio,
  studios,
  locked,
  query,
  onStudio,
  onQuery,
}: {
  studio: string;
  studios: string[];
  /** A studio account sees its own teams and cannot widen the board. */
  locked: boolean;
  query: string;
  onStudio: (value: string) => void;
  onQuery: (value: string) => void;
}) {
  const t = useT();

  return (
    <div className="board-filters">
      <select
        className="input input-dark"
        aria-label={t("Studio")}
        value={studio}
        onChange={(e) => onStudio(e.target.value)}
        disabled={locked}
      >
        {locked ? null : <option value="__all">{t("All studios")}</option>}
        {studios.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <input
        className="input input-dark"
        type="search"
        placeholder={t("Search by team or competitor…")}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        aria-label={t("Search")}
      />
    </div>
  );
}

export function BoardFooter() {
  const t = useT();
  return (
    <footer className="board-foot">
      <span>{t("Powered by BFT MENA")}</span>
    </footer>
  );
}
