/**
 * Who may write one zone of one team's score. Each refusal here is a judge
 * scoring a team that is not in front of them, or a locked result changing.
 */
import { describe, expect, it } from "vitest";

import { canWriteZoneScore, type ZoneWriteFacts } from "@/lib/zone-score-rules";

const judgeUser = { role: "organiser" as const, permissions: ["judgeSheet.view", "scores.enter"] };
const base: ZoneWriteFacts = {
  user: judgeUser,
  post: { position: "judge", station: 3 },
  team: { station: 3 },
  seriesStatus: "live",
  reached: true,
  zoneSubmitted: false,
};

describe("a judge", () => {
  it("scores the team on their own station, in their own zone", () => {
    expect(canWriteZoneScore(base)).toEqual({ allowed: true, as: "judge" });
  });

  it("is refused another station's team", () => {
    expect(canWriteZoneScore({ ...base, team: { station: 4 } })).toMatchObject({ reason: "WRONG_STATION" });
  });

  it("is refused a zone they do not work", () => {
    expect(canWriteZoneScore({ ...base, post: null })).toMatchObject({ reason: "FORBIDDEN" });
  });

  it("waits until the leader places them on a station", () => {
    expect(canWriteZoneScore({ ...base, post: { position: "judge", station: null } })).toMatchObject({
      reason: "NO_STATION",
    });
  });

  it("cannot score a wave that has not reached the zone yet", () => {
    expect(canWriteZoneScore({ ...base, reached: false })).toMatchObject({ reason: "WAVE_NOT_HERE" });
  });

  it("only scores while the competition is running", () => {
    expect(canWriteZoneScore({ ...base, seriesStatus: "scheduled" })).toMatchObject({ reason: "SERIES_NOT_LIVE" });
    expect(canWriteZoneScore({ ...base, seriesStatus: "final" })).toMatchObject({ reason: "SERIES_NOT_LIVE" });
  });

  it("cannot change a zone once it is submitted", () => {
    expect(canWriteZoneScore({ ...base, zoneSubmitted: true })).toMatchObject({ reason: "SCORE_LOCKED" });
  });

  it("needs scores.enter at all — a post alone is not enough", () => {
    expect(canWriteZoneScore({ ...base, user: { role: "organiser", permissions: ["judgeSheet.view"] } })).toMatchObject({
      reason: "FORBIDDEN",
    });
  });

  it("treats a reserve exactly like a judge", () => {
    expect(canWriteZoneScore({ ...base, post: { position: "reserve", station: 3 } })).toEqual({
      allowed: true,
      as: "judge",
    });
  });
});

describe("a zone leader", () => {
  const leader = { ...base, post: { position: "leader" as const, station: null } };

  it("scores any station of their zone", () => {
    expect(canWriteZoneScore({ ...leader, team: { station: 7 } })).toEqual({ allowed: true, as: "leader" });
  });

  it("is still bound by the wave's arrival, the running event and the lock", () => {
    expect(canWriteZoneScore({ ...leader, reached: false })).toMatchObject({ allowed: false });
    expect(canWriteZoneScore({ ...leader, zoneSubmitted: true })).toMatchObject({ reason: "SCORE_LOCKED" });
  });
});

describe("BFT MENA", () => {
  it("lets Full access correct a submitted zone — the only correction path", () => {
    expect(canWriteZoneScore({ ...base, user: { role: "admin", permissions: ["*"] }, post: null, zoneSubmitted: true })).toEqual({
      allowed: true,
      as: "admin",
    });
  });

  it("lets Partial access with scores.enter enter from the console, until it is submitted", () => {
    const staff = { role: "staff" as const, permissions: ["scores.enter"] };
    expect(canWriteZoneScore({ ...base, user: staff, post: null })).toEqual({ allowed: true, as: "console" });
    expect(canWriteZoneScore({ ...base, user: staff, post: null, zoneSubmitted: true })).toMatchObject({
      reason: "SCORE_LOCKED",
    });
  });

  it("never lets a studio enter scores through the console", () => {
    const studio = { role: "studio" as const, permissions: ["scores.enter"] };
    expect(canWriteZoneScore({ ...base, user: studio, post: null })).toMatchObject({ reason: "FORBIDDEN" });
  });
});
