/**
 * The access rules, tested directly.
 *
 * `teamScope` and `canEditScore` are the two functions standing between a
 * studio account and every other studio's teams and scores. They are pure and
 * take no session of their own, so they can be exercised exhaustively here —
 * and a regression in either one is a data leak, not a cosmetic bug.
 */
import { describe, expect, it } from "vitest";

import {
  canEditScore,
  canManageAccounts,
  canManageEvent,
  canRegisterTeams,
  canWriteScore,
  isAdmin,
  isCompetitor,
  isStudio,
  NO_MATCH,
  accountScope,
  canCreateAccount,
  scoreWriteBudget,
  teamScope,
  type CurrentUser,
} from "@/lib/access";

const admin: CurrentUser = {
  id: "u-admin",
  email: "admin@bftmena.com",
  name: "BFT MENA",
  role: "admin",
  permissions: ["*"],
  studioId: null,
  locale: "en",
};

const studio: CurrentUser = {
  id: "u-studio",
  email: "westwalk@bftmena.com",
  name: "West Walk",
  role: "studio",
  permissions: [],
  studioId: "studio-west-walk",
  locale: "en",
};

/** A studio account that was never assigned a studio — the dangerous case. */
const orphanStudio: CurrentUser = { ...studio, id: "u-orphan", studioId: null };

const competitor: CurrentUser = {
  id: "u-competitor",
  email: "omar@example.com",
  name: "Omar Haddad",
  role: "competitor",
  permissions: [],
  studioId: "studio-west-walk",
  locale: "en",
};

describe("teamScope — which team rows a role may read", () => {
  it("gives BFT MENA every team", () => {
    expect(teamScope(admin)).toEqual({});
  });

  it("limits a studio to the teams it registered", () => {
    expect(teamScope(studio)).toEqual({ studioId: "studio-west-walk" });
  });

  it("FAILS CLOSED for a studio with no studio assigned", () => {
    // The alternative — an empty filter — would hand an unassigned studio
    // account the entire field. It must match nothing instead.
    const scope = teamScope(orphanStudio);
    expect(scope).not.toEqual({});
    expect(scope.studioId).toBe("__none__");
  });

  it("limits a competitor to teams they are an competitor on", () => {
    expect(teamScope(competitor)).toEqual({ competitors: { some: { userId: "u-competitor" } } });
  });

  it("never scopes a competitor by their studio — a club-mate's team is not theirs", () => {
    expect(JSON.stringify(teamScope(competitor))).not.toContain("studio-west-walk");
  });
});

describe("canEditScore — who may write a score, and how often", () => {
  const ownTeam = { studioId: "studio-west-walk", scoreEdits: 0 };
  const otherTeam = { studioId: "studio-the-pearl", scoreEdits: 0 };

  /** The BFT manual's own rule: one write, then SUBMITTED and locked. */
  const MANUAL = scoreWriteBudget({ studioScoreCorrections: 0 });
  /** What MENA gets if it grants a series one correction. */
  const LENIENT = scoreWriteBudget({ studioScoreCorrections: 1 });

  it("reads the budget from the series, corrections on top of the submission", () => {
    expect(MANUAL).toBe(1);
    expect(LENIENT).toBe(2);
  });

  it("lets BFT MENA edit anything, however many times, whatever the budget", () => {
    expect(canEditScore(admin, ownTeam, MANUAL).allowed).toBe(true);
    expect(canEditScore(admin, otherTeam, MANUAL).allowed).toBe(true);
    expect(canEditScore(admin, { ...otherTeam, scoreEdits: 99 }, 0).allowed).toBe(true);
  });

  it("lets a studio submit its own team's first score", () => {
    expect(canEditScore(studio, ownTeam, MANUAL).allowed).toBe(true);
  });

  it("LOCKS a studio out after one save when the series grants no corrections", () => {
    // This is the manual's default and the schema's default, and it is the
    // case that was silently unenforced: the server used to allow a second
    // write because the limit was a hard-coded 2.
    const result = canEditScore(studio, { ...ownTeam, scoreEdits: 1 }, MANUAL);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe("EDIT_BUDGET_SPENT");
  });

  it("lets a studio correct once when the series grants one correction", () => {
    expect(canEditScore(studio, { ...ownTeam, scoreEdits: 1 }, LENIENT).allowed).toBe(true);
    expect(canEditScore(studio, { ...ownTeam, scoreEdits: 2 }, LENIENT).allowed).toBe(false);
  });

  it("refuses a studio another studio's team outright, however large the budget", () => {
    const result = canEditScore(studio, otherTeam, 99);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe("FORBIDDEN");
  });

  it("refuses an unassigned studio account even a team with no studio", () => {
    const result = canEditScore(orphanStudio, { studioId: null, scoreEdits: 0 }, MANUAL);
    expect(result.allowed).toBe(false);
  });

  it("never lets a competitor write a score", () => {
    expect(canEditScore(competitor, ownTeam, MANUAL).allowed).toBe(false);
    expect(canEditScore(competitor, { studioId: null, scoreEdits: 0 }, 99).allowed).toBe(false);
  });

  it("treats a negative budget as no writes rather than as a wrap-around", () => {
    expect(canEditScore(studio, ownTeam, -5).allowed).toBe(false);
  });
});

describe("canWriteScore — the whole rule for writing a score", () => {
  const ownTeam = { studioId: "studio-west-walk", scoreEdits: 0 };

  /** A series set up the way the manual describes: studios enter, once. */
  const series = {
    studiosMayEnterScores: true,
    studioScoreCorrections: 0,
    scoreEntryClosesAt: new Date("2026-10-03T18:00:00Z"),
  };
  const during = new Date("2026-10-03T14:00:00Z");
  const after = new Date("2026-10-03T18:00:01Z");

  it("lets a studio enter its own team's score during the competition", () => {
    expect(canWriteScore(studio, ownTeam, series, during).allowed).toBe(true);
  });

  it("REFUSES a studio when the series does not let studios enter scores", () => {
    // The setting is off by default. Before this rule existed the server would
    // have accepted the write and only the missing screen stopped it.
    const closed = { ...series, studiosMayEnterScores: false };
    const result = canWriteScore(studio, ownTeam, closed, during);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe("FORBIDDEN");
  });

  it("REFUSES a studio after the cut-off", () => {
    const result = canWriteScore(studio, ownTeam, series, after);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe("SCORE_ENTRY_CLOSED");
  });

  it("locks a finished wave against judges and studios — the clock outranks every grant", () => {
    const judge: CurrentUser = {
      ...studio,
      role: "competitor",
      studioId: null,
      permissions: [],
    };
    const ended = canWriteScore(judge, ownTeam, series, during, { ended: true });
    expect(ended.allowed).toBe(false);
    expect(ended.allowed === false && ended.reason).toBe("WAVE_CLOCK_ENDED");
    expect(canWriteScore(studio, ownTeam, series, during, { ended: true }).allowed).toBe(false);
  });

  it("still lets full admins — and the after-close permission — correct a finished wave", () => {
    expect(canWriteScore(admin, ownTeam, series, during, { ended: true }).allowed).toBe(true);
    const limited: CurrentUser = {
      ...admin,
      role: "competitor",
      permissions: ["scores.afterClose"],
    };
    expect(canWriteScore(limited, ownTeam, series, during, { ended: true }).allowed).toBe(true);
    const withoutIt: CurrentUser = { ...limited, permissions: ["scores.view"] };
    expect(canWriteScore(withoutIt, ownTeam, series, during, { ended: true }).allowed).toBe(false);
  });

  it("REFUSES a studio a second write when the series grants no corrections", () => {
    const result = canWriteScore(studio, { ...ownTeam, scoreEdits: 1 }, series, during);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe("EDIT_BUDGET_SPENT");
  });

  it("refuses a studio another studio's team, even with every gate open", () => {
    const generous = { ...series, studioScoreCorrections: 5, scoreEntryClosesAt: null };
    const other = { studioId: "studio-the-pearl", scoreEdits: 0 };
    expect(canWriteScore(studio, other, generous, after).allowed).toBe(false);
  });

  it("never blocks BFT MENA — not by the toggle, the cut-off or the budget", () => {
    const shut = {
      studiosMayEnterScores: false,
      studioScoreCorrections: 0,
      scoreEntryClosesAt: new Date("2020-01-01T00:00:00Z"),
    };
    expect(canWriteScore(admin, { studioId: "x", scoreEdits: 99 }, shut, after).allowed).toBe(true);
  });

  it("never lets a competitor write a score, whatever the series allows", () => {
    const generous = {
      studiosMayEnterScores: true,
      studioScoreCorrections: 9,
      scoreEntryClosesAt: null,
    };
    expect(canWriteScore(competitor, ownTeam, generous, during).allowed).toBe(false);
  });

  it("treats no cut-off as open rather than as closed", () => {
    const noDeadline = { ...series, scoreEntryClosesAt: null };
    expect(canWriteScore(studio, ownTeam, noDeadline, after).allowed).toBe(true);
  });
});

describe("capability checks", () => {
  it("names the roles correctly", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isStudio(studio)).toBe(true);
    expect(isCompetitor(competitor)).toBe(true);
    expect(isAdmin(studio)).toBe(false);
    expect(isStudio(competitor)).toBe(false);
  });

  it("keeps the schedule to BFT MENA", () => {
    expect(canManageEvent(admin)).toBe(true);
    expect(canManageEvent(studio)).toBe(false);
    expect(canManageEvent(competitor)).toBe(false);
  });

  it("lets BFT MENA and studios register teams, but never a competitor", () => {
    expect(canRegisterTeams(admin)).toBe(true);
    expect(canRegisterTeams(studio)).toBe(true);
    expect(canRegisterTeams(competitor)).toBe(false);
  });

  it("lets BFT MENA and studios manage accounts, but never a competitor", () => {
    expect(canManageAccounts(admin)).toBe(true);
    expect(canManageAccounts(studio)).toBe(true);
    expect(canManageAccounts(competitor)).toBe(false);
  });
});

describe("canCreateAccount — who may issue an account to whom", () => {
  it("lets BFT MENA create any role, in any studio", () => {
    expect(canCreateAccount(admin, "admin", null)).toEqual({ allowed: true, studioId: null });
    expect(canCreateAccount(admin, "studio", "studio-the-pearl")).toEqual({
      allowed: true,
      studioId: "studio-the-pearl",
    });
    expect(canCreateAccount(admin, "competitor", "studio-the-pearl").allowed).toBe(true);
  });

  it("lets a studio create members only", () => {
    expect(canCreateAccount(studio, "competitor", null).allowed).toBe(true);
    expect(canCreateAccount(studio, "studio", null).allowed).toBe(false);
    expect(canCreateAccount(studio, "admin", null).allowed).toBe(false);
  });

  it("forces a studio's new competitor into ITS OWN studio, whatever was submitted", () => {
    // The submitted studio id is attacker-controlled; it must be overridden,
    // not merely validated.
    const result = canCreateAccount(studio, "competitor", "studio-the-pearl");
    expect(result).toEqual({ allowed: true, studioId: "studio-west-walk" });
  });

  it("refuses an unassigned studio account", () => {
    const result = canCreateAccount(orphanStudio, "competitor", null);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe("NO_STUDIO");
  });

  it("never lets a competitor create anyone", () => {
    expect(canCreateAccount(competitor, "competitor", null).allowed).toBe(false);
  });
});

describe("accountScope — which accounts a role may list", () => {
  it("gives BFT MENA every account", () => {
    expect(accountScope(admin)).toEqual({});
  });

  it("limits a studio to its own people", () => {
    expect(accountScope(studio)).toEqual({ studioId: "studio-west-walk" });
  });

  it("fails closed for an unassigned studio account", () => {
    expect(accountScope(orphanStudio)).toEqual({ studioId: NO_MATCH });
  });

  it("limits a competitor to themselves", () => {
    expect(accountScope(competitor)).toEqual({ id: "u-competitor" });
  });
});
