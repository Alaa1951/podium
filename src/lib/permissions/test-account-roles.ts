// Relative imports with extensions: the provisioning script and the docs
// generator load this file with plain Node (type stripping).
import type { AccountType } from "./system-roles.ts";

// ─────────────────────────────────────────────────────────────────────────────
// ONE TEST ACCOUNT PER ROLE — what each is, so it can be created the same way
// every time (scripts/test-accounts.mjs) and documented from the same table
// (scripts/access-doc.ts → docs/ACCESS.md).
//
// BFT MENA Full access has no test account: that is BFT MENA's own login.
//
// The PASSWORD is never here — this repository is public. It is given to the
// provisioning script at run time. Which addresses skip the emailed code is
// the server's TEST_ACCOUNT_EMAILS (src/lib/test-accounts.ts), not this file.
// ─────────────────────────────────────────────────────────────────────────────

export type TestAccountDef = {
  /** The part after `test_` in the address: test_<slug>@bftmiddleeast.com. */
  slug: string;
  name: string;
  accountType: AccountType;
  /** AccessRole keys held — the live rows, as BFT MENA edited them. */
  roles: string[];
  /** Floor post it is meant to be put on, for the docs and `--place`. */
  post?: "leader" | "judge";
  /** A judge's station on that zone. */
  station?: number;
  /** A studio account belongs to the empty sandbox studio, never a real one. */
  sandboxStudio?: boolean;
  /** What to try with it, in one line. */
  purpose: string;
};

export const TEST_ACCOUNT_DOMAIN = "bftmiddleeast.com";

export const testAccountEmail = (slug: string) => `test_${slug}@${TEST_ACCOUNT_DOMAIN}`;

export const TEST_ACCOUNTS: TestAccountDef[] = [
  {
    slug: "bft_limited",
    name: "TEST · BFT MENA Limited access",
    accountType: "staff",
    roles: ["bft-partial"],
    purpose: "BFT MENA staff with the live BFT MENA Partial role: the console, competitions and the score console.",
  },
  {
    slug: "studio",
    name: "TEST · Gym / Studio",
    accountType: "studio",
    roles: ["gym-studio"],
    sandboxStudio: true,
    purpose: "A gym's own area, on the empty sandbox studio: its people, its teams, its waves. Sees no real studio's data.",
  },
  {
    slug: "organiser",
    name: "TEST · Organiser",
    accountType: "organiser",
    roles: ["organiser"],
    purpose: "Runs the floor: waves, stations, Wave control (start, end, reset), zone teams; entrance and warm-up check-in; category or level changes at an athlete's request; creates, edits and pairs teams.",
  },
  {
    slug: "zone_leader",
    name: "TEST · Zone leader",
    accountType: "organiser",
    roles: ["judge"],
    post: "leader",
    purpose: "A judge put on a zone as its LEADER: scores any station during the zone's work and changeover, places the zone's judges, starts the next wave.",
  },
  {
    slug: "zone_leaders",
    name: "TEST · Zone Leaders role",
    accountType: "organiser",
    roles: ["zone-leaders"],
    post: "leader",
    purpose:
      "The Zone Leaders role, put on a zone as its leader: enters numeric scores for every station of that zone during work and changeover; sees Wave control read-only; adds and removes judges and reserves on the zone they lead and no other, never leaders; no Start, desks or settings.",
  },
  {
    slug: "judge",
    name: "TEST · Judge 1",
    accountType: "organiser",
    roles: ["judge"],
    post: "judge",
    station: 1,
    purpose: "Judge 1, on station 1 of the zone: sees and scores only the station-1 team of the wave the zone is on.",
  },
  {
    slug: "judge2",
    name: "TEST · Judge 2",
    accountType: "organiser",
    roles: ["judge"],
    post: "judge",
    station: 2,
    purpose: "Judge 2, on station 2 of the same zone — to check that each judge sees only their own station.",
  },
  {
    slug: "volunteer",
    name: "TEST · Volunteer",
    accountType: "organiser",
    roles: ["volunteer"],
    purpose: "Sees the wave schedule, Marshalling and the live board; runs entrance and warm-up check-in; changes a team's category or level at an athlete's request.",
  },
  {
    slug: "coach",
    name: "TEST · Coach",
    accountType: "organiser",
    roles: ["coach"],
    purpose: "Sees the wave schedule, the results and the live board.",
  },
  {
    slug: "athlete",
    name: "TEST · Athlete",
    accountType: "competitor",
    roles: ["athlete"],
    purpose: "An athlete's own pages: profile, partner, team and wave. Has no team until one is registered for it.",
  },
];
