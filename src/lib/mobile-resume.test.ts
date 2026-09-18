import { describe, expect, it } from "vitest";
import { createNativeResumeRefresh, NATIVE_RESUME_REFRESH_MS } from "./mobile-resume";

function setup(platform: "ios" | "android") {
  let elapsed = 0;
  let wall = 1_800_000_000_000;
  const gate = createNativeResumeRefresh(platform, () => elapsed, () => wall);
  return {
    gate,
    advance: (ms: number) => { elapsed += ms; wall += ms; },
    advanceWall: (ms: number) => { wall += ms; },
    background: () => {
      if (platform === "ios") { gate.stateChange(false, true); gate.pause(); }
      else { gate.pause(); gate.stateChange(false, true); }
    },
  };
}

describe.each(["ios", "android"] as const)("%s native resume refresh", (platform) => {
  it("does not fetch again on initial or repeated active events", () => {
    const { gate, advance } = setup(platform);
    expect(gate.stateChange(true, true)).toBe(false);
    advance(120_000);
    expect(gate.stateChange(true, true)).toBe(false);
  });

  it("preserves warmed routes after a short background and consumes the event", () => {
    const { gate, background, advance } = setup(platform);
    background();
    advance(NATIVE_RESUME_REFRESH_MS - 1);
    expect(gate.stateChange(true, true)).toBe(false);
    advance(120_000);
    expect(gate.stateChange(true, true)).toBe(false);
  });

  it("refreshes once per background of at least 30 seconds", () => {
    const { gate, background, advance } = setup(platform);
    background();
    advance(NATIVE_RESUME_REFRESH_MS);
    expect(gate.stateChange(true, true)).toBe(true);
    expect(gate.stateChange(true, true)).toBe(false);
    background();
    advance(120_000);
    expect(gate.stateChange(true, true)).toBe(true);
  });

  it("does not postpone freshness when the native shell repeats a background event", () => {
    const { gate, background, advance } = setup(platform);
    background();
    advance(20_000);
    background();
    advance(10_000);
    expect(gate.stateChange(true, true)).toBe(true);
  });

  it("refreshes after a locked phone sleeps even if the monotonic clock is suspended", () => {
    const { gate, background, advanceWall } = setup(platform);
    background();
    advanceWall(120_000);
    expect(gate.stateChange(true, true)).toBe(true);
    expect(gate.stateChange(true, true)).toBe(false);
  });

  it("still refreshes after 30 seconds when the wall clock moves backward", () => {
    const { gate, background, advance, advanceWall } = setup(platform);
    background();
    advance(NATIVE_RESUME_REFRESH_MS);
    advanceWall(-3_600_000);
    expect(gate.stateChange(true, true)).toBe(true);
  });

  it("limits a forward wall-clock change to one refresh for that background", () => {
    const { gate, background, advanceWall } = setup(platform);
    background();
    advanceWall(3_600_000);
    expect(gate.stateChange(true, true)).toBe(true);
    expect(gate.stateChange(true, true)).toBe(false);
    background();
    expect(gate.stateChange(true, true)).toBe(false);
  });

  it("does not refresh while offline or editing, or on a later duplicate active event", () => {
    const { gate, background, advance } = setup(platform);
    background();
    advance(120_000);
    expect(gate.stateChange(true, false)).toBe(false);
    expect(gate.stateChange(true, true)).toBe(false);
    background();
    advance(120_000);
    expect(gate.stateChange(true, true)).toBe(true);
  });
});

it("ignores iOS inactivity without entering the background, even for a long system interruption", () => {
  const { gate, advance } = setup("ios");
  gate.stateChange(false, true);
  advance(120_000);
  expect(gate.stateChange(true, true)).toBe(false);
});

it("ignores an Android pause without onStop, such as a permission dialog", () => {
  const { gate, advance } = setup("android");
  gate.pause();
  advance(120_000);
  expect(gate.stateChange(true, true)).toBe(false);
});
