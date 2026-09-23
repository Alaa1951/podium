import "server-only";

import { lowestFreeStation } from "@/lib/floor";
import { prisma as defaultPrisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// LETTING SOMEBODY IN WHEN THERE IS ROOM FOR THEM.
//
// A place is the scarcest thing in this system, and the waiting list exists
// because money must not buy one. So this does not admit whoever has paid —
// it admits whoever there is a RIG for, and only into a wave that already
// exists.
//
// IT NEVER CREATES A WAVE. Building the running order is planning, and
// planning is a person's job: a poll that could add waves could admit an
// unbounded number of pairs at four in the morning and rearrange the whole
// day. "Fill the empty places" is the rule BFT MENA gave, and an empty place
// is a station on a wave somebody already planned.
//
// THE STATION IS CLAIMED IN THE SAME WRITE as the admission. Checking for
// room and then admitting would let two pairs see the same free rig; the
// `@@unique([waveId, station])` index settles it, and a loser simply stays on
// the list for the next poll.
//
// Preference goes to a wave that already holds the same bracket, because
// `autoAssignWaves` groups brackets on purpose — one set of prescribed loads
// per floor. Dropping a Mixed Pro pair into a wave of Womens Rookie would
// undo that quietly.
// ─────────────────────────────────────────────────────────────────────────────

type Db = typeof defaultPrisma;

export type AdmitOutcome =
  | { admitted: true; waveNumber: number; station: number }
  | { admitted: false; reason: "NO_ROOM" | "NOT_WAITING" | "TAKEN" };

/**
 * Admit one waiting team into a free station, or report that there is none.
 *
 * Never throws for a full floor: no room is the ordinary answer, not a
 * failure, and the team keeps its place in the queue.
 */
export async function admitIfRoom(db: Db, teamId: string): Promise<AdmitOutcome> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, seriesId: true, category: true, division: true, waitlistedAt: true },
  });
  if (!team || !team.waitlistedAt) return { admitted: false, reason: "NOT_WAITING" };

  const waves = await db.wave.findMany({
    where: { seriesId: team.seriesId, status: "pending" },
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      capacity: true,
      teams: {
        where: { archivedAt: null, waitlistedAt: null },
        select: { station: true, category: true, division: true },
      },
    },
  });

  const withRoom = waves
    .map((wave) => ({
      wave,
      station: lowestFreeStation(
        wave.teams.map((row) => row.station),
        wave.capacity
      ),
    }))
    .filter((option) => option.station !== null);

  if (withRoom.length === 0) return { admitted: false, reason: "NO_ROOM" };

  // A wave already running this bracket first; otherwise the earliest wave
  // with room, so the day fills from the front.
  const sameBracket = withRoom.find((option) =>
    option.wave.teams.some(
      (row) => row.category === team.category && row.division === team.division
    )
  );
  const chosen = sameBracket ?? withRoom[0];

  try {
    // Conditional on still being on the list: two polls, or a poll and a
    // person pressing Admit, cannot both hand out the same place.
    const taken = await db.team.updateMany({
      where: { id: team.id, waitlistedAt: { not: null } },
      data: {
        waitlistedAt: null,
        waveId: chosen.wave.id,
        wave: chosen.wave.number,
        station: chosen.station,
      },
    });
    if (taken.count === 0) return { admitted: false, reason: "TAKEN" };
  } catch {
    // Somebody else claimed that rig between the read and the write. The
    // unique index kept one of them; this one waits for the next poll.
    return { admitted: false, reason: "TAKEN" };
  }

  return { admitted: true, waveNumber: chosen.wave.number, station: chosen.station as number };
}
