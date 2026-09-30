/**
 * WHO WORKS THE DESKS — entrance check-in, warm-up check-in, and changing a
 * team's category or level for an athlete — as the shipped roles resolve.
 *
 * The rule the request set: Organisers, Volunteers, gyms and every BFT MENA
 * account may; a Judge may not; and nobody gets it merely for not being a
 * judge — each of these is an explicit key held through a role.
 */
import { describe, expect, it } from "vitest";

import {
  canAssistBracketChange,
  canCheckInEntrance,
  canMarkWarmupReady,
  canSeeEntranceCheckIn,
  canSeeWarmupCheckIn,
  type CurrentUser,
} from "@/lib/access";
import { policyOf, STORABLE_PERMISSION_KEYS } from "@/lib/permissions/catalog";
import { resolveEffectivePermissions } from "@/lib/permissions/resolve";
import { SYSTEM_ROLES, systemRole, type AccountType } from "@/lib/permissions/system-roles";

type Holder = Pick<CurrentUser, "role" | "permissions">;

function holding(accountType: AccountType, roles: string[], overrides: { grant: string[]; deny: string[] } | null = null): Holder {
  return {
    role: accountType,
    permissions: resolveEffectivePermissions({ accountType, approved: true, roles: roles.map((key) => systemRole(key)!), overrides }),
  };
}

const DESK_KEYS = ["registrations.attendance", "registrations.bracket", "checkIn.view", "checkIn.warmup"] as const;
const everything = (user: Holder) => ({
  seeEntrance: canSeeEntranceCheckIn(user),
  checkIn: canCheckInEntrance(user),
  seeWarmup: canSeeWarmupCheckIn(user),
  markReady: canMarkWarmupReady(user),
  assistBracket: canAssistBracketChange(user),
});
const ALL = { seeEntrance: true, checkIn: true, seeWarmup: true, markReady: true, assistBracket: true };
const NONE = { seeEntrance: false, checkIn: false, seeWarmup: false, markReady: false, assistBracket: false };

describe("the keys", () => {
  it("are ordinary role keys: grantable, storable, and not always-on for everyone", () => {
    for (const key of DESK_KEYS) {
      expect(policyOf(key)).toBe("role");
      expect(STORABLE_PERMISSION_KEYS).toContain(key);
    }
  });

  it("ship in the Organiser, Volunteer, Gym / Studio and BFT MENA Partial roles — and in no other", () => {
    const carrying = (key: string) => SYSTEM_ROLES.filter((role) => role.permissions.includes(key as never)).map((role) => role.key).sort();
    for (const key of DESK_KEYS) expect(carrying(key)).toEqual(["bft-partial", "gym-studio", "organiser", "volunteer"]);
  });

  it("never give the Judge, Coach or Athlete role a desk", () => {
    for (const key of ["judge", "coach", "athlete"]) {
      for (const desk of DESK_KEYS) expect(systemRole(key)!.permissions).not.toContain(desk);
    }
  });

  it("do not make an organiser or a volunteer an editor of teams", () => {
    for (const key of ["organiser", "volunteer"]) {
      expect(systemRole(key)!.permissions).not.toContain("registrations.edit");
      expect(systemRole(key)!.permissions).not.toContain("registrations.payment");
    }
  });
});

describe("who works the desks", () => {
  it.each([
    ["an Organiser", holding("organiser", ["organiser"])],
    ["a Volunteer", holding("organiser", ["volunteer"])],
    ["a Gym / Studio account (its default role)", holding("studio", ["gym-studio"])],
    ["BFT MENA Partial (its default role)", holding("staff", ["bft-partial"])],
    ["BFT MENA Partial also holding Organiser", holding("staff", ["bft-partial", "organiser"])],
    ["BFT MENA Full access", { role: "admin", permissions: ["*"] } as Holder],
  ])("%s sees both screens and performs both check-ins and the assisted change", (_label, user) => {
    expect(everything(user)).toEqual(ALL);
  });

  it.each([
    ["a Judge", holding("organiser", ["judge"])],
    ["a gym's own person holding only the Judge role", holding("studio", ["judge"])],
    ["BFT MENA staff holding only the Judge role", holding("staff", ["judge"])],
    ["a Coach", holding("organiser", ["coach"])],
    ["event staff with no role at all", holding("organiser", [])],
    ["an Athlete", holding("competitor", ["athlete"])],
  ])("%s reaches neither screen and neither action", (_label, user) => {
    expect(everything(user)).toEqual(NONE);
  });

  it("an account waiting for approval has nothing, whatever role it carries", () => {
    const waiting: Holder = {
      role: "organiser",
      permissions: resolveEffectivePermissions({ accountType: "organiser", approved: false, roles: [systemRole("organiser")!], overrides: null }),
    };
    expect(everything(waiting)).toEqual(NONE);
  });

  it("an ATHLETE's account never works a desk — not through a role, not through a personal grant", () => {
    const granted = holding("competitor", ["athlete"], { grant: [...DESK_KEYS], deny: [] });
    expect(granted.permissions).toEqual(expect.arrayContaining([...DESK_KEYS]));
    expect(everything(granted)).toEqual(NONE);
    expect(everything(holding("competitor", ["organiser"]))).toEqual(NONE);
  });

  it("a judge who is ALSO an organiser works the desks as the organiser they are", () => {
    expect(everything(holding("organiser", ["judge", "organiser"]))).toEqual(ALL);
  });
});

describe("each key on its own", () => {
  const only = (...keys: string[]): Holder => ({ role: "organiser", permissions: keys });

  it("a lock always wins: an organiser locked out of check-in keeps the screen but not the button", () => {
    const locked = holding("organiser", ["organiser"], { grant: [], deny: ["registrations.attendance"] });
    expect(everything(locked)).toEqual({ ...ALL, checkIn: false });
    const noWarmup = holding("organiser", ["volunteer"], { grant: [], deny: ["checkIn.warmup"] });
    expect(everything(noWarmup)).toEqual({ ...ALL, markReady: false });
    const noBracket = holding("studio", ["gym-studio"], { grant: [], deny: ["registrations.bracket"] });
    expect(everything(noBracket)).toEqual({ ...ALL, assistBracket: false });
  });

  it("the view key opens both screens and performs nothing", () => {
    expect(everything(only("checkIn.view"))).toEqual({ ...NONE, seeEntrance: true, seeWarmup: true });
  });

  it("holding one check-in opens its own screen, not the other desk's action", () => {
    expect(everything(only("registrations.attendance"))).toEqual({ ...NONE, seeEntrance: true, checkIn: true });
    expect(everything(only("checkIn.warmup"))).toEqual({ ...NONE, seeWarmup: true, markReady: true });
  });

  it("whoever confirms payment may check in at the entrance, as they always could", () => {
    const cashier: Holder = { role: "staff", permissions: ["registrations.payment"] };
    expect(everything(cashier)).toEqual({ ...NONE, seeEntrance: true, checkIn: true });
  });

  it("the assisted change is its own key: editing teams, or checking in, does not carry it", () => {
    expect(canAssistBracketChange(only("registrations.edit", "registrations.attendance", "checkIn.view"))).toBe(false);
    expect(everything(only("registrations.bracket"))).toEqual({ ...NONE, assistBracket: true });
  });
});
