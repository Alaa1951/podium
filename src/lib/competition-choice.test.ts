import { expect, it } from "vitest";
import { competitionChoices, completedCompetitions } from "./competition-choice";
const now = new Date("2026-09-24T21:01:00Z"); // September 25 in Qatar.
const event = (id: string, status: string, date: string, more = {}) => ({ id, name: id, status, competitionDate: new Date(date), ...more });
it("defaults to running, then upcoming by date, excluding completed and past scheduled events", () => {
  const list = [event("far", "scheduled", "2026-10-10"), event("done", "final", "2026-09-25"), event("past", "scheduled", "2026-09-24"), event("near", "scheduled", "2026-09-25"), event("run", "live", "2026-09-23")];
  expect(competitionChoices(list, now).map(s => s.id)).toEqual(["run", "near", "far"]);
  expect(completedCompetitions(list).map(s => s.id)).toEqual(["done"]);
});
it("keeps concurrent running competitions selectable, preferring the live real event to rehearsal", () => {
  expect(competitionChoices([event("training", "live", "2026-09-01", { isTraining: true }), event("real", "live", "2026-09-25"), event("second", "live", "2026-09-26")], now).map(s => s.id)).toEqual(["real", "second", "training"]);
});
it("has no completed fallback and excludes inactive and archived competitions", () => {
  expect(competitionChoices([event("done", "final", "2026-09-25"), event("off", "live", "2026-09-25", { isActive: false }), event("gone", "live", "2026-09-25", { archivedAt: now })], now)).toEqual([]);
});
