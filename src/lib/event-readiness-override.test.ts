import { afterEach, describe, expect, it, vi } from "vitest";

import { isEventReadinessOverridden } from "@/lib/event-readiness-override";

afterEach(() => vi.unstubAllEnvs());

describe("the event-day readiness override", () => {
  it.each([undefined, "", "   "])("is disabled without a configured event ID (%s)", (value) => {
    vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", value);
    expect(isEventReadinessOverridden({ id: "series-one" })).toBe(false);
  });

  it("applies only to the exact event ID, with surrounding whitespace ignored", () => {
    vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", "  series-one \n");
    expect(isEventReadinessOverridden({ id: "series-one" })).toBe(true);
    expect(isEventReadinessOverridden({ id: "series-two" })).toBe(false);
    expect(isEventReadinessOverridden({ id: "series-one-copy" })).toBe(false);
  });

  it.each(["*", "true", "series-one,series-two", "SERIES-ONE"])("does not treat %s as a wildcard, flag, list, or case-insensitive ID", (value) => {
    vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", value);
    expect(isEventReadinessOverridden({ id: "series-one" })).toBe(false);
  });

  it("reads current runtime configuration, so removal restores ordinary checks", () => {
    vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", "series-one");
    expect(isEventReadinessOverridden({ id: "series-one" })).toBe(true);
    vi.stubEnv("EVENT_READINESS_OVERRIDE_SERIES_ID", "");
    expect(isEventReadinessOverridden({ id: "series-one" })).toBe(false);
  });
});
