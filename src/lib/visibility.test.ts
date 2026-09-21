/**
 * The phase rules decide whether one studio can read another's data, so every
 * transition is pinned here rather than left to the screens that call them.
 *
 * The rule in one line: before the event nobody sees anyone else; while it runs
 * everyone sees everyone; after it, results are competitor-only until the
 * publication time, then open.
 */
import { describe, expect, it } from "vitest";

import {
  boardAccess,
  entryPlace,
  eventPhase,
  registrationOpen,
  teamEditOpen,
  scoreEntryOpen,
  teamLabel,
  type EventTiming,
} from "@/lib/visibility";

const NOW = new Date("2026-10-03T12:00:00Z");

// Twelve waves, five of them done, one on the floor: an event in full flow.
const base: EventTiming = {
  status: "live",
  teamCount: 108,
  wavesTotal: 12,
  wavesComplete: 5,
  wavesRunning: 1,
  boardOpensAt: null,
  resultsPublicAt: null,
  now: NOW,
};

describe("eventPhase", () => {
  it("is `before` while the event is only scheduled", () => {
    expect(eventPhase({ ...base, status: "scheduled" })).toBe("before");
  });

  it("is `before` for a live event with nothing registered", () => {
    expect(eventPhase({ ...base, teamCount: 0 })).toBe("before");
  });

  it("is `live` once it is running with teams", () => {
    expect(eventPhase(base)).toBe("live");
  });

  it("stays `live` on the final wave while that wave is still running", () => {
    expect(eventPhase({ ...base, wavesComplete: 11, wavesRunning: 1 })).toBe("live");
  });

  it("becomes `results` only when every wave is complete and none is running", () => {
    expect(eventPhase({ ...base, wavesComplete: 12, wavesRunning: 0 })).toBe("results");
  });

  it("stays `live` when a late wave is restarted after the rest are done", () => {
    // Waves can run concurrently and can be reopened, so "the last one" is not
    // a number to compare against — it is "all done, none running".
    expect(eventPhase({ ...base, wavesComplete: 11, wavesRunning: 1 })).toBe("live");
  });

  it("stays `live` while waves are still pending, even with none on the floor", () => {
    // Between waves is not the end of the event.
    expect(eventPhase({ ...base, wavesComplete: 5, wavesRunning: 0 })).toBe("live");
  });

  it("stays `live` when no wave schedule has been built at all", () => {
    // An event being run off a clipboard has no wave rows; it must not read as
    // finished just because zero waves are outstanding.
    expect(eventPhase({ ...base, wavesTotal: 0, wavesComplete: 0, wavesRunning: 0 })).toBe("live");
  });

  it("becomes `results` as soon as the event is marked final", () => {
    expect(eventPhase({ ...base, status: "final" })).toBe("results");
  });

  it("becomes `public` only once the publication time has passed", () => {
    const finished = { ...base, status: "final" as const };
    expect(eventPhase({ ...finished, resultsPublicAt: new Date("2026-10-04T00:00:00Z") })).toBe(
      "results"
    );
    expect(eventPhase({ ...finished, resultsPublicAt: new Date("2026-10-03T11:00:00Z") })).toBe(
      "public"
    );
  });

  it("is `before` until the activation time, even for an event already marked live", () => {
    // An operator marks the event live early to rehearse. The wall screen must
    // still show the countdown until the advertised moment.
    expect(eventPhase({ ...base, boardOpensAt: new Date("2026-10-03T18:00:00Z") })).toBe("before");
    expect(eventPhase({ ...base, boardOpensAt: new Date("2026-10-03T06:00:00Z") })).toBe("live");
  });

  it("never publishes an event that has not finished, whatever the date says", () => {
    // A publication time in the past must not open a board mid-competition.
    expect(eventPhase({ ...base, resultsPublicAt: new Date("2020-01-01T00:00:00Z") })).toBe("live");
  });
});

describe("boardAccess — a studio", () => {
  it("sees the countdown before the event, and nothing of the field", () => {
    const access = boardAccess("studio", "before");
    expect(access).toEqual({
      canSeeBoard: true,
      scope: "own",
      canSeeResults: false,
      isPublic: false,
    });
  });

  it("sees the whole field once the event is running", () => {
    const access = boardAccess("studio", "live");
    expect(access.canSeeBoard).toBe(true);
    expect(access.scope).toBe("all");
    expect(access.canSeeResults).toBe(false);
  });

  it("gets the full results once it is over", () => {
    expect(boardAccess("studio", "results").canSeeResults).toBe(true);
  });
});

describe("boardAccess — a member", () => {
  it("sees only the countdown before the event — never the field", () => {
    expect(boardAccess("competitor", "before").canSeeBoard).toBe(true);
    expect(boardAccess("competitor", "before").scope).toBe("own");
  });

  it("sees the whole field while it runs", () => {
    expect(boardAccess("competitor", "live").scope).toBe("all");
  });

  it("gets winners and the lookup afterwards", () => {
    expect(boardAccess("competitor", "results").canSeeResults).toBe(true);
  });
});

describe("boardAccess — BFT MENA", () => {
  it("sees everything in every phase, including before", () => {
    for (const phase of ["before", "live", "results", "public"] as const) {
      const access = boardAccess("admin", phase);
      expect(access.canSeeBoard).toBe(true);
      expect(access.scope).toBe("all");
      expect(access.canSeeResults).toBe(true);
    }
  });
});

describe("boardAccess — anonymous", () => {
  it("is refused everything until the event is published", () => {
    for (const phase of ["before", "live", "results"] as const) {
      const access = boardAccess("anonymous", phase);
      expect(access.canSeeBoard).toBe(false);
      expect(access.scope).toBe("none");
      expect(access.canSeeResults).toBe(false);
    }
  });

  it("reads the results once they are public", () => {
    const access = boardAccess("anonymous", "public");
    expect(access).toEqual({
      canSeeBoard: true,
      scope: "all",
      canSeeResults: true,
      isPublic: true,
    });
  });
});

describe("deadlines", () => {
  const closed = new Date("2026-10-01T00:00:00Z");
  const open = new Date("2026-12-01T00:00:00Z");

  it("lets a studio register while the window is open", () => {
    expect(
      registrationOpen({ role: "studio", registrationClosesAt: open, now: NOW })
    ).toEqual({ open: true });
  });

  it("closes registration for a studio after the cut-off", () => {
    expect(
      registrationOpen({ role: "studio", registrationClosesAt: closed, now: NOW })
    ).toEqual({ open: false, reason: "REGISTRATION_CLOSED" });
  });

  it("closes score entry for a studio after its cut-off", () => {
    expect(scoreEntryOpen({ role: "studio", scoreEntryClosesAt: closed, now: NOW })).toEqual({
      open: false,
      reason: "SCORE_ENTRY_CLOSED",
    });
  });

  it("never blocks BFT MENA — late changes are exactly what HQ is for", () => {
    expect(registrationOpen({ role: "admin", registrationClosesAt: closed, now: NOW }).open).toBe(
      true
    );
    expect(scoreEntryOpen({ role: "admin", scoreEntryClosesAt: closed, now: NOW }).open).toBe(true);
  });

  it("stays open when no deadline has been set", () => {
    expect(registrationOpen({ role: "studio", registrationClosesAt: null, now: NOW }).open).toBe(
      true
    );
  });

  // ── A member changing their own pair ──────────────────────────────────────

  it("lets a member change their pair well before the competition", () => {
    expect(
      teamEditOpen({ competitionDate: open, teamEditCloseHours: 24, now: NOW })
    ).toEqual({ open: true });
  });

  it("shuts the member door once the competition is inside the window", () => {
    // NOW is one hour before the competition, the window is 24 — shut.
    const soon = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect(
      teamEditOpen({ competitionDate: soon, teamEditCloseHours: 24, now: NOW })
    ).toEqual({ open: false, reason: "TEAM_EDIT_CLOSED" });
  });

  it("takes no role, so BFT MENA cannot be passed in to reopen it", () => {
    // The deliberate difference from the two above. Staff have the wave guard
    // instead; if this ever grew a role parameter, "admin" would walk straight
    // through a door that is about what an ATHLETE may do to their pair.
    const soon = new Date(NOW.getTime() + 60 * 60 * 1000);
    const params = { competitionDate: soon, teamEditCloseHours: 24, now: NOW };
    expect(teamEditOpen({ ...params, role: "admin" } as never).open).toBe(false);
  });

  it("treats a zero-hour window as open right up to the competition", () => {
    const later = new Date(NOW.getTime() + 1000);
    expect(teamEditOpen({ competitionDate: later, teamEditCloseHours: 0, now: NOW }).open).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE WAITING LIST.
//
// Deliberately NOT a third state inside registrationOpen: that function also
// answers "may I edit or withdraw this entry?", where "you are on the waiting
// list" is not an answer. The separation is the design, so it is tested as its
// own question — and the question is settled by WHEN SOMEBODY SIGNED UP, not by
// when anybody got round to processing them.
// ─────────────────────────────────────────────────────────────────────────────

describe("entryPlace", () => {
  const closes = new Date("2026-10-01T00:00:00Z");

  it("gives a place to somebody who signed up in time", () => {
    expect(
      entryPlace({ signedUpAt: new Date("2026-09-30T23:59:00Z"), registrationClosesAt: closes })
    ).toBe("field");
  });

  it("puts somebody who signed up after the deadline on the list", () => {
    expect(
      entryPlace({ signedUpAt: new Date("2026-10-01T00:01:00Z"), registrationClosesAt: closes })
    ).toBe("waiting_list");
  });

  it("keeps the place of somebody processed late — the whole reason it reads signupAt", () => {
    // Signed up a month early; approved a week AFTER the deadline. A slow
    // studio must not cost somebody the place they were in time for, so the
    // answer does not depend on when the question is asked.
    const signedUpAt = new Date("2026-09-01T00:00:00Z");
    expect(entryPlace({ signedUpAt, registrationClosesAt: closes })).toBe("field");
  });

  it("gives a place when no deadline was ever set — the door never closed", () => {
    expect(entryPlace({ signedUpAt: new Date("2030-01-01T00:00:00Z"), registrationClosesAt: null })).toBe(
      "field"
    );
  });

  it("gives a place to an entry staff typed in, which has no sign-up at all", () => {
    expect(entryPlace({ signedUpAt: null, registrationClosesAt: closes })).toBe("field");
  });
});

describe("teamLabel", () => {
  const team = { name: "IRON CLAUSE", competitors: ["Omar Haddad", "Sara Nasser"] };

  it("shows both when both are on", () => {
    expect(teamLabel(team, { showTeamName: true, showCompetitorNames: true, showStudioColumn: true }))
      .toEqual({ primary: "IRON CLAUSE", secondary: "Omar Haddad & Sara Nasser" });
  });

  it("shows the competitors alone, the way BFT International prints it", () => {
    expect(
      teamLabel(team, { showTeamName: false, showCompetitorNames: true, showStudioColumn: true })
    ).toEqual({ primary: "Omar Haddad & Sara Nasser", secondary: null });
  });

  it("shows the team name alone", () => {
    expect(
      teamLabel(team, { showTeamName: true, showCompetitorNames: false, showStudioColumn: true })
    ).toEqual({ primary: "IRON CLAUSE", secondary: null });
  });

  it("never renders a nameless row, even with both switched off", () => {
    expect(
      teamLabel(team, { showTeamName: false, showCompetitorNames: false, showStudioColumn: false })
    ).toEqual({ primary: "IRON CLAUSE", secondary: null });
  });

  it("falls back to the team name when the competitors are missing", () => {
    expect(
      teamLabel(
        { name: "IRON CLAUSE", competitors: [] },
        { showTeamName: false, showCompetitorNames: true, showStudioColumn: true }
      )
    ).toEqual({ primary: "IRON CLAUSE", secondary: null });
  });
});
