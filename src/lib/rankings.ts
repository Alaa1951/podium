import { BRACKETS, bracketIndex, rankAll } from "@/lib/scoring";
import type { Category, Division } from "@/generated/prisma/enums";
import type { TeamRow } from "@/lib/queries";

export type RankedTeam = TeamRow & { rank: number };

// Turning a field into an order. Pure: the same teams always rank the same
// way, whoever is asking and whichever screen is asking.

// ── Derived board views ──────────────────────────────────────────────────────

/** Submitted scores only — a draft never reaches the public board. */
export function rankBracket(
  teams: TeamRow[],
  category: Category,
  division: Division,
  waveCap?: number
): RankedTeam[] {
  const pool = teams.filter(
    (t) =>
      t.category === category &&
      t.division === division &&
      t.submitted &&
      (!waveCap || t.wave <= waveCap)
  );
  return rankAll(pool);
}

export function rankOverall(teams: TeamRow[], waveCap?: number): RankedTeam[] {
  const pool = teams.filter((t) => t.submitted && (!waveCap || t.wave <= waveCap));
  return rankAll(pool);
}

export function rankWave(teams: TeamRow[], wave: number): RankedTeam[] {
  return rankAll(teams.filter((t) => t.submitted && t.wave === wave));
}

/** The 1st/2nd/3rd of every bracket, in board order. */
export function podiums(teams: TeamRow[]) {
  const out: { index: number; category: Category; division: Division; places: RankedTeam[] }[] = [];
  const seen = new Set<number>();

  for (const team of teams) {
    const index = bracketIndex(team.category, team.division);
    if (seen.has(index)) continue;
    seen.add(index);
  }

  BRACKETS.forEach(({ category, division }, index) => {
    const places = rankBracket(teams, category, division).filter((r) => r.rank <= 3).slice(0, 3);
    out.push({ index, category, division, places });
  });

  return out;
}

export function lastWave(teams: TeamRow[]) {
  return teams.length ? Math.max(1, ...teams.map((t) => t.wave)) : 1;
}

export {
  getLoadStandards,
  getSeriesWaves,
  listAccounts,
  listStudios,
} from "@/lib/queries-people";
