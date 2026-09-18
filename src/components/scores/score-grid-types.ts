import type { PaymentStatus } from "@/generated/prisma/enums";
import type { ScoreAuditLine } from "@/lib/queries-people";
import type { EntryValues } from "@/lib/zones";

/** One line of the score sheet, as the server hands it to the grid. */
export type GridTeam = {
  id: string;
  number: number;
  name: string;
  category: string;
  division: string;
  wave: number;
  competitors: string[];
  submitted: boolean;
  scoreEdits: number;
  paymentStatus: PaymentStatus;
  values: EntryValues;
  /**
   * The totals of the other SUBMITTED teams in this team's own bracket, so the
   * row can show a live projected placing while somebody types.
   *
   * Computed on the server against the whole field, not against the rows in
   * this grid — a studio sees only its own teams, and a placing worked out
   * from those alone would be a different and wrong number.
   */
  peerTotals: number[];
  /** Who changed what, most recent first — shown when the row is opened. */
  audit: ScoreAuditLine[];
  /** When this team's own wave clock runs out — the finisher stop reads it. */
  waveEndsAt: string | null;
  /** True once that clock has run out: the wave's scores are closed. */
  waveEnded: boolean;
};
