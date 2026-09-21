/**
 * Which image a seat shows.
 *
 * Most of this file is one assertion said several ways: a stored path that
 * points anywhere but this app resolves to the default. That is the test worth
 * having, because the failure it prevents is not a broken picture — it is this
 * app quietly making a request to somewhere else while its published privacy
 * page says it makes none.
 */
import { describe, expect, it } from "vitest";

import { athletePhoto, DEFAULT_ATHLETE_PHOTO } from "@/lib/athlete-photo";

describe("with nothing stored", () => {
  it("uses the default, which is every seat today", () => {
    expect(athletePhoto(null)).toBe(DEFAULT_ATHLETE_PHOTO);
    expect(athletePhoto(undefined)).toBe(DEFAULT_ATHLETE_PHOTO);
    expect(athletePhoto("")).toBe(DEFAULT_ATHLETE_PHOTO);
    expect(athletePhoto("   ")).toBe(DEFAULT_ATHLETE_PHOTO);
  });
});

describe("with a path of our own", () => {
  it("uses it", () => {
    expect(athletePhoto("/media/portraits/abc.jpg")).toBe("/media/portraits/abc.jpg");
  });

  it("trims it, so a stray space does not blank somebody's face", () => {
    expect(athletePhoto("  /media/portraits/abc.jpg  ")).toBe("/media/portraits/abc.jpg");
  });
});

describe("anything that would leave this origin", () => {
  // Each of these is a real way the field could come to hold a foreign
  // reference: a paste, an import, a generator that returns a hosted URL.
  const foreign = [
    "https://cdn.example.com/face.jpg",
    "http://cdn.example.com/face.jpg",
    // Protocol-relative: loads from another host, and looks like a path.
    "//cdn.example.com/face.jpg",
    // A whole image inlined — not a third party, but not a file we serve
    // either, and it would put an unbounded blob through every payload.
    "data:image/png;base64,iVBORw0KGgo=",
    "javascript:alert(1)",
    // Not rooted here.
    "media/portraits/abc.jpg",
    "../../etc/passwd",
    "/media/../../etc/passwd",
  ];

  for (const value of foreign) {
    it(`refuses ${value.slice(0, 34)} and falls back`, () => {
      expect(athletePhoto(value)).toBe(DEFAULT_ATHLETE_PHOTO);
    });
  }
});

describe("the default itself", () => {
  it("is served by this app, like everything else this returns", () => {
    expect(DEFAULT_ATHLETE_PHOTO.startsWith("/")).toBe(true);
    expect(athletePhoto(DEFAULT_ATHLETE_PHOTO)).toBe(DEFAULT_ATHLETE_PHOTO);
  });
});
