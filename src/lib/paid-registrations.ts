import "server-only";

import { prisma } from "@/lib/prisma";
import { crmSyncEnabled } from "@/lib/crm/sync";
import { paymentFromStage } from "@/lib/crm/reconcile";

/** Payment totals count registrations, including paid entries waiting for a place or details. */
export async function getPaidRegistrationSummary(seriesId: string, includeIntake = false) {
  const showIntake = includeIntake && crmSyncEnabled();
  const [teams, intakes, merges] = await Promise.all([
    prisma.team.findMany({
      where: { seriesId },
      // Keep archived IDs in the exclusion set: an old intake must not revive a withdrawn entry.
      select: { externalId: true, paymentStatus: true, archivedAt: true, waitlistedAt: true },
    }),
    showIntake ? prisma.crmIntake.findMany({
      where: { seriesId },
      select: { externalId: true, stageName: true },
    }) : Promise.resolve([]),
    showIntake ? prisma.crmRegistrationMerge.findMany({
      where: { seriesId },
      select: { retiredExternalId: true, canonicalExternalId: true },
    }) : Promise.resolve([]),
  ]);

  const represented = new Set(teams.flatMap(team => team.externalId ? [team.externalId] : []));
  for (const merge of merges) {
    represented.add(merge.retiredExternalId);
    represented.add(merge.canonicalExternalId);
  }
  const paidTeams = teams.filter(team => !team.archivedAt && team.paymentStatus === "paid");
  const inField = paidTeams.filter(team => !team.waitlistedAt).length;
  const waitingTeams = paidTeams.length - inField;
  let incomplete = 0;
  for (const intake of intakes) {
    if (represented.has(intake.externalId)) continue;
    represented.add(intake.externalId);
    if (paymentFromStage("", intake.stageName ?? "") === "paid") incomplete += 1;
  }
  return { inField, waitingTeams, incomplete, waiting: waitingTeams + incomplete, total: paidTeams.length + incomplete };
}
