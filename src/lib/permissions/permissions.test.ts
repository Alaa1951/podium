/**
 * The role system, tested as a security surface.
 *
 * Three layers: the CATALOG (the vocabulary and each permission's policy), the
 * RESOLVER (what a person may do, from what they hold), and the GRANT POLICY
 * (who may hand what to whom). The rules the n8n-ai-app design taught us —
 * a lock always wins, you can only grant what you hold, nobody edits themselves
 * — each have a test here, because each one failing is an escalation.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_PERMISSION_KEYS,
  GENERAL_PERMISSIONS,
  LEGACY_KEY_MAP,
  normalizeStoredPermissions,
  PERMISSIONS,
  PERMISSION_TREE,
  policyOf,
  STORABLE_PERMISSION_KEYS,
} from "@/lib/permissions/catalog";
import {
  canAssignRole,
  canGiveRole,
  roleFitsAccount,
  canChangeOverrides,
  canEditRole,
  canManageTarget,
  canTakeOverTarget,
  mergeScoped,
  roleRowLock,
  validateRoleContents,
  type Actor,
} from "@/lib/permissions/grant-policy";
import {
  explainPermissions,
  parseOverrides,
  resolveEffectivePermissions,
  withinCeiling,
  type AccessInputs,
} from "@/lib/permissions/resolve";
import { DEFAULT_ROLE_FOR, SYSTEM_ROLES, systemRole } from "@/lib/permissions/system-roles";

const inputs = (over: Partial<AccessInputs>): AccessInputs => ({
  accountType: "organiser",
  approved: true,
  roles: [],
  overrides: null,
  ...over,
});

const role = (name: string, permissions: string[]) => ({ key: name.toLowerCase(), name, permissions });

describe("the catalog", () => {
  it("has unique keys, each shaped screen.action", () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
    for (const key of ALL_PERMISSION_KEYS) expect(key).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
  });

  it("gives every permission exactly one known policy", () => {
    for (const entry of PERMISSIONS) {
      expect(["general", "role", "bftOnly", "fullAdminOnly"]).toContain(entry.policy);
    }
  });

  it("keeps score correction out of reach of every role", () => {
    expect(policyOf("scores.correct")).toBe("fullAdminOnly");
    expect(policyOf("scores.unlock")).toBe("fullAdminOnly");
    expect(STORABLE_PERMISSION_KEYS).not.toContain("scores.correct");
  });

  it("opens the live board and the account basics to everyone", () => {
    expect(GENERAL_PERMISSIONS).toEqual(
      expect.arrayContaining(["board.view", "home.view", "notifications.view", "announcements.view"])
    );
  });

  it("builds a tree that covers every key once", () => {
    const inTree = PERMISSION_TREE.flatMap((module) =>
      module.screens.flatMap((screen) => screen.permissions.map((entry) => entry.key))
    );
    expect(inTree.sort()).toEqual([...ALL_PERMISSION_KEYS].sort());
  });

  it("maps every legacy key onto real keys", () => {
    for (const mapped of Object.values(LEGACY_KEY_MAP)) {
      for (const key of mapped) expect(ALL_PERMISSION_KEYS).toContain(key);
    }
  });

  it("reads old role rows through the legacy map, dropping what cannot be stored", () => {
    expect(normalizeStoredPermissions(["competitors.view", "scores.edit", "board.view", "nonsense"]).sort()).toEqual(
      ["registrations.view", "scores.enter"].sort()
    );
    expect(normalizeStoredPermissions(["scores.afterClose"])).toEqual([]);
    expect(normalizeStoredPermissions("not an array")).toEqual([]);
  });
});

describe("the shipped roles", () => {
  it("carry only storable keys", () => {
    for (const def of SYSTEM_ROLES) {
      expect(validateRoleContents(def.permissions, def.assignableBy)).toEqual({ allowed: true });
    }
  });

  it("let studios give only Athlete and Judge — the Organiser runs every competition's floor", () => {
    const studioGiven = SYSTEM_ROLES.filter((def) => def.assignableBy === "bft_studio").map((def) => def.key);
    expect(studioGiven.sort()).toEqual(["athlete", "judge"]);
    expect(systemRole("organiser")!.assignableBy).toBe("bft");
  });

  it("keep organisers out of score entry, and an organiser account away from money whatever the role lists", () => {
    const organiser = systemRole("organiser")!.permissions;
    expect(organiser).not.toContain("scores.enter");
    expect(organiser).toEqual(expect.arrayContaining(["waveControl.control", "zoneStaff.assign", "scores.view", "registrations.edit"]));
    // As live, the role lists payment and the waiting list — BFT-only keys the
    // organiser account type never holds (the ceiling); a staff account does.
    const asOrganiser = resolveEffectivePermissions(inputs({ accountType: "organiser", roles: [role("Organiser", organiser)] }));
    expect(asOrganiser).not.toContain("registrations.payment");
    expect(asOrganiser).not.toContain("registrations.waitlist");
    expect(asOrganiser).toContain("registrations.edit");
    const asStaff = resolveEffectivePermissions(inputs({ accountType: "staff", roles: [role("Organiser", organiser)] }));
    expect(asStaff).toEqual(expect.arrayContaining(["registrations.payment", "registrations.waitlist"]));
  });

  it("pin shipped role permissions, including the approved Zone Leaders score entry", () => {
    // Stored rows win in a running database. Approved permission changes
    // update this snapshot together with a migration for existing rows.
    const shipped = Object.fromEntries(SYSTEM_ROLES.map((def) => [def.key, [...def.permissions].sort()]));
    expect(shipped).toEqual({
      "bft-partial": [
        "announcements.send", "approvals.decide", "approvals.view", "athleteHome.editTeam", "athleteHome.view",
        "audit.view", "checkIn.view", "checkIn.warmup", "competitionStudios.edit", "competitions.create",
        "competitions.view", "dashboard.view", "judgeSheet.view", "overview.view", "partner.browse", "partner.edit",
        "partner.request", "partner.view", "registrations.archive", "registrations.attendance",
        "registrations.bracket", "registrations.create", "registrations.edit", "registrations.export",
        "registrations.pair", "registrations.partners", "registrations.payment", "registrations.view",
        "registrations.waitlist", "results.publish", "results.view", "roles.edit", "roles.view", "scores.enter",
        "scores.view", "settings.edit", "settings.view", "sponsors.edit", "studios.create", "studios.edit",
        "studios.view", "users.assignRoles", "users.delete", "users.disable", "users.edit", "users.invite",
        "users.overrides", "users.view", "waveControl.control", "waveControl.view", "waves.view", "zoneStaff.assign",
        "zoneStaff.view",
      ],
      "gym-studio": [
        "announcements.send", "approvals.decide", "approvals.view", "checkIn.view", "checkIn.warmup",
        "registrations.archive", "registrations.attendance", "registrations.bracket", "registrations.create",
        "registrations.edit", "registrations.export", "registrations.pair", "registrations.partners",
        "registrations.view", "results.view", "scores.view", "users.assignRoles", "users.delete", "users.disable",
        "users.invite", "users.view", "waves.placeTeams", "waves.view",
      ],
      organiser: [
        "approvals.view", "checkIn.view", "checkIn.warmup", "competitionStudios.view", "competitions.view",
        "dashboard.view", "marshalling.view", "overview.view", "registrations.attendance", "registrations.bracket",
        "registrations.create", "registrations.edit", "registrations.export", "registrations.pair",
        "registrations.partners", "registrations.payment", "registrations.view", "registrations.waitlist",
        "results.view", "scores.view", "settings.view", "shirts.view", "studios.view", "waveControl.control",
        "waveControl.view", "waves.edit", "waves.placeTeams", "waves.view", "zoneStaff.assign", "zoneStaff.view",
      ],
      // Their own sheet only: never a list of every team (Waves, Score entry, Wave control).
      judge: [
        "judgeSheet.view", "scores.enter",
      ],
      // Leader-only sheet access keeps automatic judge-leader Start separate.
      "zone-leaders": [
        "competitions.view", "judgeSheet.leaderView", "overview.view", "scores.enter", "waveControl.view", "waves.view", "zoneStaff.assignJudges",
        "zoneStaff.view",
      ],
      volunteer: [
        "checkIn.view", "checkIn.warmup", "marshalling.view", "registrations.attendance", "registrations.bracket",
        "waves.view",
      ],
      coach: [
        "results.view", "waves.view",
      ],
      athlete: [
        "athleteHome.editTeam", "athleteHome.view", "partner.browse", "partner.edit", "partner.request",
        "partner.view",
      ],
    });
    for (const def of SYSTEM_ROLES) expect(new Set(def.permissions).size).toBe(def.permissions.length);
  });

  it("keep studios out of score entry", () => {
    expect(systemRole("gym-studio")!.permissions).not.toContain("scores.enter");
  });

  it("give Zone Leaders score entry without judge or wave control powers", () => {
    const permissions = systemRole("zone-leaders")!.permissions;
    expect(permissions).toEqual(expect.arrayContaining(["judgeSheet.leaderView", "scores.enter"]));
    for (const key of ["judgeSheet.view", "waveControl.start", "waveControl.control", "zoneStaff.assign"]) {
      expect(permissions).not.toContain(key);
    }
    expect(policyOf("judgeSheet.leaderView")).toBe("role");
  });

  it("name a default role for every non-admin account type that needs one", () => {
    expect(DEFAULT_ROLE_FOR.studio).toBe("gym-studio");
    expect(DEFAULT_ROLE_FOR.competitor).toBe("athlete");
    expect(DEFAULT_ROLE_FOR.staff).toBe("bft-partial");
    expect(DEFAULT_ROLE_FOR.admin).toBeUndefined();
  });
});

describe("resolveEffectivePermissions", () => {
  it("gives BFT MENA Full access everything", () => {
    expect(resolveEffectivePermissions(inputs({ accountType: "admin" }))).toEqual(["*"]);
  });

  it("gives an account awaiting approval the general set only, whatever it holds", () => {
    const pending = resolveEffectivePermissions(
      inputs({ approved: false, roles: [role("Organiser", ["waves.edit"])], overrides: { grant: ["users.view"], deny: [] } })
    );
    expect(pending.sort()).toEqual([...GENERAL_PERMISSIONS].sort());
  });

  it("adds several roles together", () => {
    const effective = resolveEffectivePermissions(
      inputs({ roles: [role("Organiser", ["waves.edit"]), role("Judge", ["scores.enter"])] })
    );
    expect(effective).toEqual(expect.arrayContaining(["waves.edit", "scores.enter", "board.view"]));
  });

  it("adds a per-person grant", () => {
    const effective = resolveEffectivePermissions(inputs({ overrides: { grant: ["results.view"], deny: [] } }));
    expect(effective).toContain("results.view");
  });

  it("lets a LOCK win over a role, a grant and the general set", () => {
    const effective = resolveEffectivePermissions(
      inputs({
        roles: [role("Organiser", ["waves.edit"])],
        overrides: { grant: ["waves.edit"], deny: ["waves.edit", "board.view"] },
      })
    );
    expect(effective).not.toContain("waves.edit");
    expect(effective).not.toContain("board.view");
  });

  it("strips BFT-only permissions from studio, organiser and athlete accounts (the ceiling)", () => {
    for (const accountType of ["studio", "organiser", "competitor"] as const) {
      const effective = resolveEffectivePermissions(
        inputs({ accountType, roles: [role("Bad", ["roles.edit", "users.overrides"])], overrides: { grant: ["audit.view"], deny: [] } })
      );
      expect(effective).not.toContain("roles.edit");
      expect(effective).not.toContain("users.overrides");
      expect(effective).not.toContain("audit.view");
    }
  });

  it("lets BFT MENA Partial hold BFT-only permissions", () => {
    const effective = resolveEffectivePermissions(inputs({ accountType: "staff", roles: [role("HQ", ["roles.edit"])] }));
    expect(effective).toContain("roles.edit");
  });

  it("never hands out a Full-admin-only permission, even from a poisoned row", () => {
    const effective = resolveEffectivePermissions(
      inputs({ accountType: "staff", roles: [role("Poisoned", ["scores.correct", "scores.unlock"])], overrides: { grant: ["scores.correct"], deny: [] } })
    );
    expect(effective).not.toContain("scores.correct");
    expect(effective).not.toContain("scores.unlock");
  });

  it("never hands out the after-cutoff team change (D3a) — not by role, not by grant", () => {
    expect(policyOf("registrations.changeAfterClose")).toBe("fullAdminOnly");
    expect(STORABLE_PERMISSION_KEYS).not.toContain("registrations.changeAfterClose");
    const effective = resolveEffectivePermissions(
      inputs({ accountType: "staff", roles: [role("Poisoned", ["registrations.changeAfterClose", "registrations.edit"])], overrides: { grant: ["registrations.changeAfterClose"], deny: [] } })
    );
    expect(effective).toContain("registrations.edit");
    expect(effective).not.toContain("registrations.changeAfterClose");
  });

  it("reads malformed override JSON as no overrides", () => {
    expect(parseOverrides(null)).toEqual({ grant: [], deny: [] });
    expect(parseOverrides({ grant: "x", deny: [1, "a"] })).toEqual({ grant: [], deny: ["a"] });
  });

  it("knows each account type's ceiling", () => {
    expect(withinCeiling("staff", "roles.edit")).toBe(true);
    expect(withinCeiling("studio", "roles.edit")).toBe(false);
    expect(withinCeiling("studio", "users.view")).toBe(true);
    expect(withinCeiling("staff", "scores.correct")).toBe(false);
    expect(withinCeiling("admin", "scores.correct")).toBe(true);
  });
});

describe("explainPermissions — the Source column", () => {
  it("says where each permission comes from, mirroring the resolver", () => {
    const explained = explainPermissions(
      inputs({
        accountType: "studio",
        roles: [role("Gym / Studio", ["users.view", "roles.edit"])],
        overrides: { grant: ["results.view"], deny: ["waves.view"] },
      })
    );
    expect(explained.get("board.view")).toEqual({ kind: "general" });
    expect(explained.get("users.view")).toEqual({ kind: "role", roles: ["Gym / Studio"] });
    expect(explained.get("results.view")).toEqual({ kind: "grant" });
    expect(explained.get("waves.view")).toEqual({ kind: "lock" });
    expect(explained.get("roles.edit")).toEqual({ kind: "ceiling" });
    expect(explained.get("audit.view")).toEqual({ kind: "none" });
  });
});

const fullAdmin: Actor = { id: "a", role: "admin", studioId: null, permissions: ["*"] };
const partial: Actor = {
  id: "p",
  role: "staff",
  studioId: null,
  permissions: ["roles.edit", "users.assignRoles", "users.overrides", "waves.view", "results.view"],
};
const gym: Actor = { id: "g", role: "studio", studioId: "west", permissions: ["users.assignRoles", "registrations.view"] };

describe("grant policy — you can only hand out what you hold", () => {
  it("lets a role editor change only keys they hold", () => {
    expect(canEditRole(partial, ["waves.view"], ["waves.view", "results.view"])).toEqual({ allowed: true });
    const refused = canEditRole(partial, [], ["users.view"]);
    expect(refused).toMatchObject({ allowed: false, reason: "NOT_HELD", keys: ["users.view"] });
  });

  it("refuses removing a key the editor does not hold, too", () => {
    expect(canEditRole(partial, ["audit.view"], [])).toMatchObject({ allowed: false, reason: "NOT_HELD" });
  });

  it("exempts BFT MENA Full access", () => {
    expect(canEditRole(fullAdmin, [], ["audit.view", "users.view"])).toEqual({ allowed: true });
  });

  it("refuses a role editor without roles.edit", () => {
    expect(canEditRole(gym, [], [])).toMatchObject({ allowed: false, reason: "FORBIDDEN" });
  });

  it("keeps BFT-only and never-grantable keys out of a role studios can give", () => {
    expect(validateRoleContents(["roles.edit"], "bft_studio")).toMatchObject({ reason: "BFT_ONLY_IN_STUDIO_ROLE" });
    expect(validateRoleContents(["roles.edit"], "bft")).toEqual({ allowed: true });
    expect(validateRoleContents(["scores.correct"], "bft")).toMatchObject({ reason: "NOT_STORABLE" });
    expect(validateRoleContents(["board.view"], "bft")).toMatchObject({ reason: "NOT_STORABLE" });
    expect(validateRoleContents(["made.up"], "bft")).toMatchObject({ reason: "UNKNOWN_PERMISSION" });
  });

  it("explains every locked row in the role editor", () => {
    expect(roleRowLock(partial, "board.view", { assignableBy: "bft" })).toBe("ALWAYS_ON");
    expect(roleRowLock(partial, "scores.correct", { assignableBy: "bft" })).toBe("FULL_ADMIN_ONLY");
    expect(roleRowLock(fullAdmin, "roles.edit", { assignableBy: "bft_studio" })).toBe("BFT_ONLY_ROLE");
    expect(roleRowLock(partial, "users.view", { assignableBy: "bft" })).toBe("NOT_HELD");
    expect(roleRowLock(partial, "waves.view", { assignableBy: "bft" })).toBeNull();
  });
});

describe("grant policy — who may manage whom", () => {
  const athleteAtWest = { id: "t1", role: "competitor" as const, studioId: "west" };
  const athleteElsewhere = { id: "t2", role: "competitor" as const, studioId: "pearl" };
  const fullAdminTarget = { id: "t3", role: "admin" as const, studioId: null };
  const partialTarget = { id: "t4", role: "staff" as const, studioId: "west" };

  it("never lets anyone change their own access", () => {
    expect(canManageTarget(fullAdmin, { id: "a", role: "admin", studioId: null })).toMatchObject({
      reason: "CANNOT_CHANGE_OWN_ACCESS",
    });
    expect(canManageTarget(gym, { id: "g", role: "studio", studioId: "west" })).toMatchObject({ allowed: false });
  });

  it("keeps BFT MENA Full access out of everyone else's reach", () => {
    expect(canManageTarget(partial, fullAdminTarget)).toMatchObject({ allowed: false });
    expect(canManageTarget(gym, fullAdminTarget)).toMatchObject({ allowed: false });
  });

  it("limits a studio to its own people, never BFT MENA staff", () => {
    expect(canManageTarget(gym, athleteAtWest)).toEqual({ allowed: true });
    expect(canManageTarget(gym, athleteElsewhere)).toMatchObject({ allowed: false });
    expect(canManageTarget(gym, partialTarget)).toMatchObject({ allowed: false });
  });

  it("lets a Partial account manage another only when it holds all that account holds", () => {
    // Otherwise: change the stronger colleague's email, send the reset link
    // there, sign in as them.
    const weaker = { ...partialTarget, permissions: ["waves.view"] };
    const stronger = { ...partialTarget, permissions: ["waves.view", "audit.view"] };
    expect(canManageTarget(partial, weaker)).toEqual({ allowed: true });
    expect(canManageTarget(partial, stronger)).toMatchObject({ allowed: false, reason: "NOT_HELD", keys: ["audit.view"] });
    expect(canManageTarget(fullAdmin, stronger)).toEqual({ allowed: true });
  });

  it("fails closed when a Partial target's permissions were not loaded", () => {
    expect(canManageTarget(partial, partialTarget)).toMatchObject({ allowed: false, reason: "FORBIDDEN" });
    // Other account types never needed them.
    expect(canManageTarget(partial, athleteAtWest)).toEqual({ allowed: true });
  });
});

describe("grant policy — taking the way into an account", () => {
  const organiser = {
    id: "o1",
    role: "organiser" as const,
    studioId: null,
    permissions: ["waveControl.view", "waveControl.control", "home.view"],
  };
  const athlete = {
    id: "a1",
    role: "competitor" as const,
    studioId: "west",
    permissions: ["athleteHome.view", "partner.edit", "home.view"],
  };

  it("refuses a Partial account an Organiser's email or reset link when it lacks the floor", () => {
    // Otherwise: point the email at an address of its own, reset the
    // password, and start and end waves as the Organiser.
    expect(canManageTarget(partial, organiser)).toEqual({ allowed: true });
    expect(canTakeOverTarget(partial, organiser)).toMatchObject({ allowed: false, reason: "NOT_HELD" });
    expect(canTakeOverTarget(fullAdmin, organiser)).toEqual({ allowed: true });
  });

  it("lets a Partial account help an athlete back in — an athlete's own pages are not powers", () => {
    expect(canTakeOverTarget(partial, athlete)).toEqual({ allowed: true });
  });

  it("fails closed when the target's permissions were not loaded", () => {
    expect(canTakeOverTarget(partial, { id: "o2", role: "organiser", studioId: null })).toMatchObject({
      allowed: false,
      reason: "FORBIDDEN",
    });
  });
});

describe("grant policy — giving roles", () => {
  const judge = { assignableBy: "bft_studio" as const, permissions: ["judgeSheet.view", "scores.enter"] };
  const hq = { assignableBy: "bft" as const, permissions: ["results.view"] };
  const target = { id: "t", role: "organiser" as const, studioId: "west" };

  it("lets a studio appoint a judge without judging itself — trust comes from the role's flag", () => {
    expect(canAssignRole(gym, target, judge)).toEqual({ allowed: true });
  });

  it("refuses a studio a role only BFT MENA may give", () => {
    expect(canAssignRole(gym, target, hq)).toMatchObject({ allowed: false, reason: "ROLE_NOT_ASSIGNABLE" });
  });

  it("refuses a studio a person outside its studio", () => {
    expect(canAssignRole(gym, { ...target, studioId: "pearl" }, judge)).toMatchObject({ allowed: false });
  });

  it("lets BFT MENA Partial give only roles made of what they hold", () => {
    expect(canAssignRole(partial, target, hq)).toEqual({ allowed: true });
    expect(canAssignRole(partial, target, judge)).toMatchObject({ allowed: false, reason: "NOT_HELD" });
  });

  it("needs users.assignRoles at all", () => {
    expect(canAssignRole({ ...gym, permissions: [] }, target, judge)).toMatchObject({ reason: "FORBIDDEN" });
  });

  it("never lets anyone give themselves a role", () => {
    expect(canAssignRole(fullAdmin, { id: "a", role: "admin", studioId: null }, hq)).toMatchObject({ allowed: false });
  });

  it("gives a role only to the account types it is meant for — and always lets it be taken away", () => {
    const judgeRole = { ...judge, accountTypes: ["organiser", "studio", "staff"] };
    const athlete = { id: "x", role: "competitor" as const, studioId: "west" };
    expect(canGiveRole(gym, target, judgeRole)).toEqual({ allowed: true });
    expect(canGiveRole(gym, athlete, judgeRole)).toMatchObject({ allowed: false, reason: "ROLE_NOT_FOR_ACCOUNT_TYPE" });
    expect(canAssignRole(gym, athlete, judgeRole)).toEqual({ allowed: true }); // removal
    expect(canGiveRole(fullAdmin, athlete, judgeRole)).toEqual({ allowed: true }); // Full access decides
    expect(roleFitsAccount({ accountTypes: [] }, "competitor")).toBe(true);
    expect(roleFitsAccount({ accountTypes: null }, "competitor")).toBe(true);
  });
});

describe("grant policy — per-person Grant / Lock", () => {
  const target = { id: "t", role: "organiser" as const, studioId: null };
  const none = { grant: [], deny: [] };

  it("is BFT MENA only (users.overrides)", () => {
    expect(canChangeOverrides(gym, target, none, { grant: ["registrations.view"], deny: [] })).toMatchObject({
      reason: "FORBIDDEN",
    });
  });

  it("lets BFT MENA Partial grant or lock only keys they hold", () => {
    expect(canChangeOverrides(partial, target, none, { grant: ["waves.view"], deny: ["results.view"] })).toEqual({
      allowed: true,
    });
    expect(canChangeOverrides(partial, target, none, { grant: ["users.view"], deny: [] })).toMatchObject({
      reason: "NOT_HELD",
    });
  });

  it("never grants what nobody can be given", () => {
    expect(canChangeOverrides(fullAdmin, target, none, { grant: ["scores.correct"], deny: [] })).toMatchObject({
      reason: "NOT_STORABLE",
    });
  });
});

describe("mergeScoped — a save only touches what the editor could change", () => {
  it("carries hidden keys over and applies the visible ones", () => {
    const editable = (key: string) => key.startsWith("waves.");
    const next = mergeScoped(["audit.view", "waves.view"], ["waves.edit", "users.view"], editable);
    expect(next.sort()).toEqual(["audit.view", "waves.edit"].sort());
  });
});
