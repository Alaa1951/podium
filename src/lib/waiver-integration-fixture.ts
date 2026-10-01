import type { PrismaClient } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/access";
import { setTeamArrival, setWarmupReady } from "@/lib/checkin-db";
import { resolveEffectivePermissions } from "@/lib/permissions/resolve";
import { systemRole } from "@/lib/permissions/system-roles";
import { actors } from "@/lib/schedule-integration-fixture";
import { attachRelease, signWaiver } from "@/lib/waivers/waiver-db";

// ─────────────────────────────────────────────────────────────────────────────
// On top of schedule-integration-fixture's competition "s1": the waiver
// attached, each seat given its own athlete account (the way the athlete
// door links a seat once its email is proven), and the steps each team takes
// before its wave — every athlete signs, arrives, and the team warms up.
// ─────────────────────────────────────────────────────────────────────────────

export const athleteOf = (competitorId: string): CurrentUser => ({
  id: `acct-${competitorId}`, email: `${competitorId}@example.com`, name: `Account ${competitorId}`, role: "competitor", studioId: null, locale: "en",
  permissions: resolveEffectivePermissions({ accountType: "competitor", approved: true, roles: [systemRole("athlete")!], overrides: null }),
});

/** Every seat of these teams gets its own account, linked to the seat. */
export async function linkAccounts(prisma: PrismaClient, teamNumbers: number[]) {
  const seats = await prisma.competitor.findMany({ where: { team: { seriesId: "s1", number: { in: teamNumbers } } } });
  for (const seat of seats) {
    const account = athleteOf(seat.id);
    await prisma.user.upsert({
      where: { id: account.id },
      // The account carries the athlete's own name, as a real sign-up does.
      create: { id: account.id, email: account.email, name: seat.fullName, role: "competitor", status: "active" },
      update: {},
    });
    await prisma.competitor.update({ where: { id: seat.id }, data: { userId: account.id } });
  }
  return seats;
}

export async function attach(prisma: PrismaClient) {
  return prisma.$transaction((tx) => attachRelease(tx, { seriesId: "s1", documentKey: "podium-series-1", version: 1, actorId: actors.hq.id }));
}

/** BFT MENA requires a new version (a copy of the current one stands in for it). */
export async function newVersion(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => {
    const old = await tx.waiverRelease.findFirstOrThrow({ where: { seriesId: "s1", status: "active" }, include: { editions: true } });
    await tx.waiverRelease.update({ where: { id: old.id }, data: { status: "retired", retiredAt: new Date() } });
    await tx.waiverRelease.create({
      data: {
        seriesId: "s1", version: old.version + 1, documentKey: `podium-series-1@${old.version + 1}`,
        editions: { create: old.editions.map(({ language, content, contentHash, acknowledgement }) => ({ language, content, contentHash, acknowledgement })) },
      },
    });
  });
}

export async function activeReleaseId(prisma: PrismaClient) {
  return (await prisma.waiverRelease.findFirstOrThrow({ where: { seriesId: "s1", status: "active" } })).id;
}

/** Each athlete of these teams signs, as themselves. */
export async function signAll(prisma: PrismaClient, teamNumbers: number[], language: "en" | "ar" = "en") {
  const releaseId = await activeReleaseId(prisma);
  const seats = await prisma.competitor.findMany({ where: { team: { seriesId: "s1", number: { in: teamNumbers } } } });
  for (const seat of seats) {
    const result = await signWaiver(prisma, seat.userId!, { seriesId: "s1", releaseId, language, typedName: seat.fullName, agreed: true });
    if (!result.ok) throw new Error(`sign ${seat.fullName}: ${result.error}`);
  }
}

export async function arriveAll(prisma: PrismaClient, teamNumbers: number[]) {
  for (const number of teamNumbers) {
    const team = await prisma.team.findFirstOrThrow({ where: { seriesId: "s1", number } });
    const outcome = await setTeamArrival(prisma, actors.organiser, { teamId: team.id, attended: true });
    if (!outcome.ok) throw new Error(`arrive #${number}: ${outcome.error}`);
  }
}

export async function readyAll(prisma: PrismaClient, teamNumbers: number[]) {
  for (const number of teamNumbers) {
    const team = await prisma.team.findFirstOrThrow({ where: { seriesId: "s1", number } });
    const outcome = await setWarmupReady(prisma, actors.volunteer, { teamId: team.id, ready: true });
    if (!outcome.ok) throw new Error(`ready #${number}: ${outcome.error} ${JSON.stringify("gaps" in outcome ? outcome.gaps : null)}`);
  }
}
