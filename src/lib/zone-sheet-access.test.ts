import { describe, expect, it } from "vitest";

import { can, canControlWave } from "@/lib/access";
import { canAssignZoneScorePost, canOpenZoneScoreSheet, canViewZoneScoreSheet } from "@/lib/zone-sheet-access";

const leader = { role: "organiser" as const, permissions: ["judgeSheet.leaderView", "scores.enter"] };
const judge = { role: "organiser" as const, permissions: ["judgeSheet.view", "scores.enter"] };

describe("zone score sheet access", () => {
  it("opens the sheet for either permission and refuses score entry alone", () => {
    expect(canOpenZoneScoreSheet(leader)).toBe(true);
    expect(canOpenZoneScoreSheet(judge)).toBe(true);
    expect(canOpenZoneScoreSheet({ ...leader, permissions: ["scores.enter"] })).toBe(false);
  });

  it("leader-only access accepts a leader post and refuses all other posts", () => {
    expect(canViewZoneScoreSheet(leader, "leader")).toBe(true);
    for (const position of ["judge", "reserve", null]) expect(canViewZoneScoreSheet(leader, position)).toBe(false);
  });

  it("a role without a post opens no zone", () => {
    expect(canViewZoneScoreSheet(leader, null)).toBe(false);
    expect(canViewZoneScoreSheet(judge, null)).toBe(false);
  });

  it("preserves all Judge post types and admin access", () => {
    for (const position of ["judge", "reserve", "leader"]) {
      expect(canViewZoneScoreSheet(judge, position)).toBe(true);
      expect(canAssignZoneScorePost({ role: "admin", permissions: [] }, position)).toBe(true);
    }
  });

  it("needs score-entry permission for appointment", () => {
    expect(canAssignZoneScorePost({ ...leader, permissions: ["judgeSheet.leaderView"] }, "leader")).toBe(false);
    expect(canAssignZoneScorePost(leader, "leader")).toBe(true);
    expect(canAssignZoneScorePost(leader, "judge")).toBe(false);
    expect(canAssignZoneScorePost(leader, "reserve")).toBe(false);
  });

  it("does not grant automatic Start to the new permission", () => {
    expect(canControlWave(leader, "start", can(leader, "judgeSheet.view"))).toBe(false);
    expect(canControlWave(judge, "start", can(judge, "judgeSheet.view"))).toBe(true);
  });
});
