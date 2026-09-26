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
  /** Set when the entry arrived after registration closed. Null = in the field. */
  waitlistedAt: Date | null;
  /** The pair's own photograph, shown on the open score sheet. */
  groupPortraitPath: string | null;
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
  /** One zone's work in minutes — the finisher is the wave's last this-many. */
  finisherWorkMinutes: number;
  /** True once that clock has run out: the wave's scores are closed. */
  waveEnded: boolean;
  /** Zones the zone judge has submitted — each one locked on its own. */
  lockedZones?: string[];
  /** The station (1–9) the team stands on in every zone. */
  station?: number | null;
};
