import { describe, expect, it } from "vitest";

import { deletionGuard, seriesArchiveGuard } from "@/lib/series-guard";

describe("deletionGuard", () => {
  it("allows everything while the event is only scheduled", () => {
    expect(deletionGuard("scheduled")).toEqual({ allowed: true });
  });

  it("blocks deletions while the event is on the floor", () => {
    expect(deletionGuard("live")).toEqual({ allowed: false, reason: "EVENT_RUNNING" });
  });

  it("blocks deletions forever once the event is finished", () => {
    expect(deletionGuard("final")).toEqual({ allowed: false, reason: "EVENT_FINISHED" });
  });
});

describe("seriesArchiveGuard", () => {
  it("follows the same rule as the rows inside it", () => {
    expect(seriesArchiveGuard("scheduled")).toEqual({ allowed: true });
    expect(seriesArchiveGuard("live")).toEqual({ allowed: false, reason: "EVENT_RUNNING" });
    expect(seriesArchiveGuard("final")).toEqual({ allowed: false, reason: "EVENT_FINISHED" });
  });
});
