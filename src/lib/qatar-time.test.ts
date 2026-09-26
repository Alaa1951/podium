/**
 * The one rule the whole schedule hangs on: a time an admin types is QATAR
 * time, on every server, whatever timezone the process runs in. These tests
 * run under the runner's own zone on purpose — pass TZ=UTC and TZ=Asia/Qatar
 * and they must pass unchanged, both locally and in CI.
 */
import { describe, expect, it } from "vitest";

import {
  formatQatarDateTime,
  formatQatarDayKey,
  formatQatarForInput,
  parseQatarWallTime,
} from "@/lib/qatar-time";

// 02:00 Qatar is 23:00 the previous evening in UTC. A UTC server that read
// the naive string with plain `new Date` would keep it at 02:00Z — three
// hours late, the bug this module exists to prevent.
const entered = parseQatarWallTime("2026-09-27T02:00") as Date;
const enteredAsUtc = entered.toISOString();

describe("parseQatarWallTime", () => {
  it("reads a naive datetime-local value as Qatar time", () => {
    expect(enteredAsUtc).toBe("2026-09-26T23:00:00.000Z");
  });

  it("accepts seconds and a bare date", () => {
    expect(parseQatarWallTime("2026-09-27T02:00:30")?.toISOString()).toBe("2026-09-26T23:00:30.000Z");
    expect(parseQatarWallTime("2026-09-27")?.toISOString()).toBe("2026-09-26T21:00:00.000Z");
  });

  it("rejects junk as null, like the actions expect", () => {
    expect(parseQatarWallTime(undefined)).toBeNull();
    expect(parseQatarWallTime("")).toBeNull();
    expect(parseQatarWallTime("not a date")).toBeNull();
    expect(parseQatarWallTime("2026-13-40T99:00")).toBeNull();
  });
});

describe("formatQatarForInput", () => {
  it("round-trips what the admin typed, even on a UTC server", () => {
    expect(formatQatarForInput(entered)).toBe("2026-09-27T02:00");
    expect(formatQatarForInput(null)).toBe("");
  });
});

describe("formatQatarDayKey and formatQatarDateTime", () => {
  it("follows the Qatar calendar and clock", () => {
    expect(formatQatarDayKey(entered)).toBe("2026-09-27");
    expect(formatQatarDateTime(entered)).toBe("2026-09-27 02:00");
    expect(formatQatarDateTime("2026-09-26T23:00:00.000Z")).toBe("2026-09-27 02:00");
  });
});
