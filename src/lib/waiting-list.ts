import "server-only";

import { crmSyncEnabled } from "@/lib/crm/sync";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// WHO IS REGISTERED AND NOT IN THE FIELD.
//
// Two groups describe the same thing from opposite sides, and until now
// neither had a number anywhere in the system:
//
//   WAITING FOR A PLACE   a team that entered after registration closed. It
//                         holds no place until somebody admits it, and it has
//                         no wave ON PURPOSE.
//   NOT A TEAM YET        a CRM registration the form has not finished — most
//                         often with no Category and no Division, which are
//                         required, so it cannot become a team at all.
//
// THE NUMBER MUST COUNT WHAT THE VIEWER CAN ACTUALLY SEE, which is why this
// takes flags rather than working anything out:
//
//   `includeIntake` — the CRM half is BFT MENA's alone; it carries the emails
//     and phone numbers of people who have not finished registering, and the
//     list itself is gated on `isBft`. A studio shown "31" beside a screen
//     listing two of its own entries has been handed a bug, not a feature.
//
//   `crmSyncEnabled()` — `crmIntakeFor` returns nothing when the sync is off,
//     so counting the rows anyway would put a number on a menu item whose
//     screen is empty, on every deployment that does not use the CRM.
//
// A badge that disagrees with its own screen reads as a stale cache rather
// than a miscount, which is why both gates are here and not at the call site.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The teams on the waiting list.
 *
 * Exported so the count, the screen and the tests cannot drift into three
 * slightly different ideas of who is waiting. `archivedAt` matters as much as
 * `waitlistedAt`: a withdrawn entry is nobody's work.
 */
export function waitingTeamWhere(seriesId: string) {
  return { seriesId, archivedAt: null, waitlistedAt: { not: null } } as const;
}

export type WaitingCount = {
  /** Entered after the deadline, waiting to be let in. */
  teams: number;
  /** CRM registrations that cannot become teams yet. */
  intake: number;
  total: number;
};

export async function countWaitingList(
  seriesId: string,
  options: { includeIntake: boolean; scope?: object }
): Promise<WaitingCount> {
  const showIntake = options.includeIntake && crmSyncEnabled();

  const [teams, intake] = await Promise.all([
    prisma.team.count({ where: { ...waitingTeamWhere(seriesId), ...(options.scope ?? {}) } }),
    showIntake ? prisma.crmIntake.count({ where: { seriesId } }) : Promise.resolve(0),
  ]);

  return { teams, intake, total: teams + intake };
}
