/**
 * WHO REGISTERED EACH TEAM — the decision, as a pure function (plan v7 §4).
 *
 * Kept apart from the script that reads and writes the database so it can be
 * tested on its own (ownership-plan.test.mjs). The rule is deliberately
 * narrow: a CRM team's contact is its payer, and when that payer's email is on
 * exactly one of the team's seats, that person registered it. Everything else
 * — hand-entered teams, pairs formed in the app, a payer on no seat, a team
 * whose CRM record was merged into another — stays `unknown` and is listed
 * for BFT MENA. Never inferred from seat order.
 */

const clean = (email) => (typeof email === "string" ? email.trim().toLowerCase() : "") || null;

/**
 * @param {Array<{
 *   id: string, source: string, externalId: string|null, ownership: string,
 *   registrantEmail: string|null, payerEmail: string|null,
 *   mergedAway: boolean,
 *   seats: Array<{ id: string, email: string|null, userId: string|null }>
 * }>} teams
 */
export function planOwnership(teams) {
  const set = [];
  const unknown = [];
  let alreadySet = 0;
  for (const team of teams) {
    // Somebody (BFT MENA, the CRM sync, a previous run) already decided.
    if (team.ownership !== "unknown" || team.registrantEmail) {
      alreadySet += 1;
      continue;
    }
    const why = reasonUnknown(team);
    if (why) {
      unknown.push({ id: team.id, reason: why });
      continue;
    }
    const payer = clean(team.payerEmail);
    const seat = team.seats.find((one) => clean(one.email) === payer);
    set.push({
      id: team.id,
      before: { ownership: team.ownership, registrantEmail: team.registrantEmail ?? null, registrantUserId: null },
      after: { ownership: "registrant", registrantEmail: payer, registrantUserId: seat.userId ?? null },
    });
  }
  return { set, unknown, alreadySet };
}

function reasonUnknown(team) {
  if (team.source !== "ghl") return "not from the CRM";
  if (team.mergedAway) return "its CRM record was merged into another";
  const payer = clean(team.payerEmail);
  if (!payer) return "the CRM record has no email";
  const matches = team.seats.filter((one) => clean(one.email) === payer).length;
  if (matches === 0) return "the payer is on no seat";
  if (matches > 1) return "the payer's email is on both seats";
  return null;
}
