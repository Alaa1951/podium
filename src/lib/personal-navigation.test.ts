/**
 * The four destinations a competitor gets, and the four everybody else gets.
 *
 * This list used to be inline in the phone's tab bar and nowhere else, which
 * is how a competitor on a laptop ended up with no navigation at all: CSS
 * deletes that bar above 900px. Both bars now read this, so the test that
 * matters is that the ternary still says what it said — it has never had one.
 */
import { describe, expect, it } from "vitest";

import {
  personalNavActivePath,
  personalNavCommonScreen,
  personalNavItems,
  screenTitle,
} from "@/lib/personal-navigation";

const hrefs = (role: string, home?: string) => personalNavItems(role, home).map((i) => i.href);

describe("who gets which bar", () => {
  it("gives a competitor their own team, wave, results and account", () => {
    expect(hrefs("competitor")).toEqual(["/me", "/my-wave", "/results", "/account"]);
  });

  it("gives a competitor the same four whatever their home resolved to", () => {
    // A competitor working a zone still belongs on /me first.
    expect(hrefs("competitor", "/my-wave")).toEqual(["/me", "/my-wave", "/results", "/account"]);
  });

  it("gives anybody posted to a live zone the judge's bar", () => {
    expect(hrefs("staff", "/my-wave")).toEqual(["/my-wave", "/results", "/account"]);
    expect(hrefs("organiser", "/my-wave")).toEqual(["/my-wave", "/results", "/account"]);
  });

  it("gives a studio its competitions", () => {
    expect(hrefs("studio")).toEqual(["/studio", "/results", "/account"]);
  });

  it("gives an admin the console's four", () => {
    expect(hrefs("admin")).toEqual(["/", "/series", "/users", "/?menu=more"]);
    expect(hrefs("staff", "/")).toEqual(["/", "/series", "/users", "/?menu=more"]);
  });

  it("falls back to the general bar", () => {
    expect(hrefs("organiser")).toEqual(["/home", "/results", "/account"]);
  });
});

describe("which tab is lit", () => {
  const matches = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

  it("counts the inbox as the account tab", () => {
    expect(personalNavCommonScreen("/notifications", matches)).toBe(true);
    expect(personalNavActivePath("/notifications", true)).toBe("/account");
  });

  it("counts the wall board as results", () => {
    expect(personalNavActivePath("/series/podium-2/board", false)).toBe("/results");
  });

  it("leaves an ordinary path alone", () => {
    expect(personalNavActivePath("/me/partner", false)).toBe("/me/partner");
  });
});

describe("what a screen is called", () => {
  it("names the partner screens — the ones with no heading of their own", () => {
    expect(screenTitle("/me/partner")).toBe("Find a partner");
    expect(screenTitle("/me/partner/requests")).toBe("Partner requests");
  });

  it("keeps the prefix rules", () => {
    expect(screenTitle("/my-wave/zone-1")).toBe("My wave");
    expect(screenTitle("/studio/announcements/new")).toBe("Announcements");
  });

  it("says nothing where the screen speaks for itself", () => {
    expect(screenTitle("/series/podium-2/board")).toBeUndefined();
  });
});
