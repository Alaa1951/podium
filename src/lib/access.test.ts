/**
 * The access rules, tested directly.
 *
 * `teamScope` and `accountScope` are what stand between a studio account and
 * every other studio's teams and people; `canWriteScore` and `canCreateAccount`
 * decide who writes scores and who issues accounts. They are pure and take no
 * session of their own, so they can be exercised exhaustively here — and a
 * regression in any of them is a data leak, not a cosmetic bug.
 */
import { describe, expect, it } from "vitest";

import {
  accountScope,
  can,
  canCreateAccount,
  canWriteScore,
  isAdmin,
  isBft,
  isCompetitor,
  isStudio,
  NO_MATCH,
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

const staff: CurrentUser = {
  ...admin,
  id: "u-staff",
  role: "staff",
  permissions: ["users.view", "users.invite", "scores.view", "scores.enter"],
};

const studio: CurrentUser = {
  id: "u-studio",
  email: "westwalk@bftmena.com",
  name: "West Walk",
  role: "studio",
  permissions: ["users.invite", "scores.view", "registrations.view"],
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

const organiser: CurrentUser = {
  ...competitor,
  id: "u-organiser",
  role: "organiser",
  studioId: null,
  permissions: ["registrations.view", "scores.view", "waves.edit"],
};

describe("can — the one permission decision", () => {
  it("passes BFT MENA Full access on everything, including what nobody can be given", () => {
    expect(can(admin, "scores.correct")).toBe(true);
    expect(can(admin, "roles.edit")).toBe(true);
  });

  it("passes everyone else only on the keys they carry", () => {
    expect(can(staff, "scores.enter")).toBe(true);
    expect(can(staff, "roles.edit")).toBe(false);
    expect(can(organiser, "waves.edit")).toBe(true);
    expect(can(organiser, "scores.enter")).toBe(false);
  });
});

describe("teamScope — which team rows an account may read", () => {
  it("gives BFT MENA and organisers every team", () => {
    expect(teamScope(admin)).toEqual({});
    expect(teamScope(staff)).toEqual({});
    expect(teamScope(organiser)).toEqual({});
  });

  it("limits a studio to the teams it registered", () => {
    expect(teamScope(studio)).toEqual({ studioId: "studio-west-walk" });
  });

  it("FAILS CLOSED for a studio with no studio assigned", () => {
    // The alternative — an empty filter — would hand an unassigned studio
    // account the entire field. It must match nothing instead.
    const scope = teamScope(orphanStudio);
    expect(scope).not.toEqual({});
    expect(scope.studioId).toBe(NO_MATCH);
  });

  it("limits an athlete to teams they compete on", () => {
    expect(teamScope(competitor)).toEqual({ competitors: { some: { userId: "u-competitor" } } });
  });

  it("never scopes an athlete by their studio — a club-mate's team is not theirs", () => {
    expect(JSON.stringify(teamScope(competitor))).not.toContain("studio-west-walk");
  });
});

describe("canWriteScore — the whole rule for writing a score from the console", () => {
  const series = { scoreEntryClosesAt: new Date("2026-10-03T18:00:00Z") };
  const during = new Date("2026-10-03T14:00:00Z");
  const after = new Date("2026-10-03T18:00:01Z");

  it("lets BFT MENA staff holding scores.enter write during the competition", () => {
    expect(canWriteScore(staff, series, during).allowed).toBe(true);
  });

  it("NEVER lets a studio write a score — judges do, and a judging studio person holds the Judge role", () => {
    const withTheKey: CurrentUser = { ...studio, permissions: ["scores.enter"] };
    const result = canWriteScore(withTheKey, series, during);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe("FORBIDDEN");
  });

  it("refuses an organiser without scores.enter", () => {
    expect(canWriteScore(organiser, series, during).allowed).toBe(false);
  });

  it("REFUSES everyone but Full access after the cut-off", () => {
    const result = canWriteScore(staff, series, after);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toBe("SCORE_ENTRY_CLOSED");
  });

  it("locks a finished wave — correcting it is BFT MENA Full access only", () => {
    const ended = canWriteScore(staff, series, during, { ended: true });
    expect(ended.allowed).toBe(false);
    expect(ended.allowed === false && ended.reason).toBe("WAVE_CLOCK_ENDED");
    expect(canWriteScore(admin, series, during, { ended: true }).allowed).toBe(true);
  });

  it("does not honour a stray scores.correct in a permission list", () => {
    // It is Full-admin-only: the resolver never hands it out, and even if a
    // list somehow carried it, the clock still wins for everyone but admin.
    const smuggled: CurrentUser = { ...staff, permissions: [...staff.permissions, "scores.correct"] };
    expect(canWriteScore(smuggled, series, during, { ended: true }).allowed).toBe(false);
  });

  it("never blocks BFT MENA Full access — not by the cut-off, not by the clock", () => {
    const shut = { scoreEntryClosesAt: new Date("2020-01-01T00:00:00Z") };
    expect(canWriteScore(admin, shut, after, { ended: true }).allowed).toBe(true);
  });

  it("never lets an athlete write a score", () => {
    expect(canWriteScore({ ...competitor, permissions: ["scores.enter"] }, { scoreEntryClosesAt: null }, during).allowed).toBe(false);
  });

  it("treats no cut-off as open rather than as closed", () => {
    expect(canWriteScore(staff, { scoreEntryClosesAt: null }, after).allowed).toBe(true);
  });
});

describe("account types", () => {
  it("names them correctly", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isBft(admin)).toBe(true);
    expect(isBft(staff)).toBe(true);
    expect(isBft(studio)).toBe(false);
    expect(isStudio(studio)).toBe(true);
    expect(isCompetitor(competitor)).toBe(true);
    expect(isAdmin(staff)).toBe(false);
  });
});

describe("canCreateAccount — who may issue an account to whom", () => {
  it("lets BFT MENA Full create any type, in any studio", () => {
    expect(canCreateAccount(admin, "admin", null)).toEqual({ allowed: true, studioId: null });
    expect(canCreateAccount(admin, "studio", "studio-the-pearl")).toEqual({
      allowed: true,
      studioId: "studio-the-pearl",
    });
    expect(canCreateAccount(admin, "competitor", "studio-the-pearl").allowed).toBe(true);
  });

  it("lets BFT MENA Partial create anything but Full access — and only with users.invite", () => {
    expect(canCreateAccount(staff, "organiser", null).allowed).toBe(true);
    expect(canCreateAccount(staff, "staff", null).allowed).toBe(true);
    expect(canCreateAccount(staff, "admin", null).allowed).toBe(false);
    expect(canCreateAccount({ ...staff, permissions: [] }, "organiser", null).allowed).toBe(false);
  });

  it("lets a studio create athletes and organisers only", () => {
    expect(canCreateAccount(studio, "competitor", null).allowed).toBe(true);
    expect(canCreateAccount(studio, "organiser", null).allowed).toBe(true);
    expect(canCreateAccount(studio, "studio", null).allowed).toBe(false);
    expect(canCreateAccount(studio, "staff", null).allowed).toBe(false);
    expect(canCreateAccount(studio, "admin", null).allowed).toBe(false);
  });

  it("forces a studio's new account into ITS OWN studio, whatever was submitted", () => {
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

  it("never lets an athlete create anyone", () => {
    expect(canCreateAccount({ ...competitor, permissions: ["users.invite"] }, "competitor", null).allowed).toBe(false);
  });
});

describe("accountScope — which accounts an account may list", () => {
  it("gives BFT MENA every account", () => {
    expect(accountScope(admin)).toEqual({});
    expect(accountScope(staff)).toEqual({});
  });

  it("limits a studio to its own people", () => {
    expect(accountScope(studio)).toEqual({ studioId: "studio-west-walk" });
  });

  it("fails closed for an unassigned studio account", () => {
    expect(accountScope(orphanStudio)).toEqual({ studioId: NO_MATCH });
  });

  it("limits athletes and organisers to themselves", () => {
    expect(accountScope(competitor)).toEqual({ id: "u-competitor" });
    expect(accountScope(organiser)).toEqual({ id: "u-organiser" });
  });
});
