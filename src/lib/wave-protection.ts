import type { Prisma } from "@/generated/prisma/client";
import { ScheduleError } from "@/lib/wave-schedule";

// Teams RUNNING MANUALLY (Team.slotManualAt) keep their exact slot: a change to
// their wave — a new number or time, a rebuild, a deletion — never moves them
// as a side effect. The wave actions ask here, then refuse with the teams named.

/** Teams running manually in these waves, by number. */
export async function protectedIn(tx: Prisma.TransactionClient, waveIds: string[]): Promise<number[]> {
  const rows = await tx.team.findMany({
    where: { waveId: { in: waveIds }, slotManualAt: { not: null }, archivedAt: null, waitlistedAt: null, station: { not: null } },
    select: { number: true }, orderBy: { number: "asc" },
  });
  return rows.map((row) => row.number);
}

export class ProtectedWaveError extends ScheduleError {
  constructor(code: "PROTECTED_CONFLICT" | "PROTECTED_WAVE", readonly teams: number[]) {
    super(code);
  }
}
