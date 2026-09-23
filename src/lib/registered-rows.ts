import "server-only";

import type { RegisteredRow } from "@/components/admin/registered-table";
import type { RosterRow } from "@/lib/queries";

/**
 * A roster row as the registration tables want it.
 *
 * Extracted because there are now three lists that show the same rows — the
 * field, the withdrawn, and the waiting list — and the mapping was already
 * written out twice. A third copy is where one of them quietly stops
 * carrying `waitlistedAt`, which is exactly the bug that once made a paid
 * waiting entry read as "Registered".
 */
export function toRegisteredRow(team: RosterRow): RegisteredRow {
  return {
    id: team.id,
    number: team.number,
    name: team.name,
    category: team.category,
    division: team.division,
    wave: team.waveId ? team.wave : null,
    paymentStatus: team.paymentStatus,
    waitlistedAt: team.waitlistedAt,
    amount: team.amountMinor === null ? "—" : (team.amountMinor / 100).toFixed(2),
    currency: team.currency,
    billingNumber: team.billingNumber,
    source: team.source,
    registeredAt: team.registeredAt.toISOString().slice(0, 10),
    attended: team.attendedAt !== null,
    submitted: team.submitted,
    people: team.competitors.map((person) => ({
      id: person.id,
      fullName: person.fullName,
      phone: person.phone,
      email: person.email,
      studioName: person.studioName,
      photoPath: person.photoPath,
    })),
  };
}
