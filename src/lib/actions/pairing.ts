"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { linkPair } from "@/lib/partners";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { normalizeName } from "@/lib/scoring";
import { isBft, isStudio, requireAccess } from "@/lib/session";
import { nextTeamNumber } from "@/lib/actions/teams";
import { registrationOpen } from "@/lib/visibility";
import { revalidatePath } from "next/cache";

// ─────────────────────────────────────────────────────────────────────────────
// PAIRING TWO ATHLETES INTO A TEAM.
//
// A studio (or BFT MENA) takes two approved athletes who signed up — typically
// two "looking for a partner" at the same level and category — and enters
// them as a team in a competition. The team is the studio's own; its entry is
// unpaid until the payment is confirmed, the same as any other registration.
// A studio pairs only its own athletes, only in competitions it is part of,
// and only while registration is open.
// ─────────────────────────────────────────────────────────────────────────────

export type PairResult = { ok: true; message?: string } | { ok: false; error: string };

const schema = z.object({
  seriesId: z.string().min(1),
  athleteIds: z.tuple([z.string().min(1), z.string().min(1)]),
  teamName: z.string().trim().max(80).optional(),
  category: z.enum(["Womens", "Mens", "Mixed"]),
  division: z.enum(["Rookie", "Open", "Pro"]),
});

export async function pairAthletes(input: unknown): Promise<PairResult> {
  const actor = await requireAccess("registrations.pair");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;
  if (data.athleteIds[0] === data.athleteIds[1]) return { ok: false, error: "SAME_ATHLETE" };
  if (!isBft(actor) && !(isStudio(actor) && actor.studioId)) return { ok: false, error: "FORBIDDEN" };

  // The competition: a studio only in one it takes part in, while it is open.
  const series = await prisma.series.findFirst({
    where: {
      id: data.seriesId,
      archivedAt: null,
      ...(isStudio(actor) ? { studios: { some: { studioId: actor.studioId! } } } : {}),
    },
    select: { id: true, name: true, registrationClosesAt: true },
  });
  if (!series) return { ok: false, error: "NOT_FOUND" };
  const open = registrationOpen({ role: actor.role, registrationClosesAt: series.registrationClosesAt, now: new Date() });
  if (!open.open) return { ok: false, error: open.reason };

  // The two athletes: approved athlete accounts.
  //
  // A studio normally sees only its own. The exception is a pair who found
  // EACH OTHER — athletes may look for a partner across every studio, so a
  // cross-studio pair would otherwise be a team nobody could enter: not the
  // one studio, not the other. When the two are already linked to each other,
  // either of their studios may register them.
  const athletes = await prisma.user.findMany({
    where: {
      id: { in: data.athleteIds },
      role: "competitor",
      approvalStatus: "approved",
      archivedAt: null,
      status: { not: "disabled" },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      studioId: true,
      athleteProfile: {
        select: {
          dateOfBirth: true,
          partnerUserId: true,
          division: true,
          category: true,
          sex: true,
          shirtSize: true,
          bftMember: true,
        },
      },
    },
  });
  if (athletes.length !== 2) return { ok: false, error: "NOT_FOUND" };
  const ordered = data.athleteIds.map((id) => athletes.find((athlete) => athlete.id === id)!);

  // Somebody already partnered with a third person is not paired again here.
  for (const athlete of ordered) {
    const partner = athlete.athleteProfile?.partnerUserId;
    if (partner && !data.athleteIds.includes(partner)) return { ok: false, error: "HAS_OTHER_PARTNER" };
  }

  const choseEachOther =
    ordered[0].athleteProfile?.partnerUserId === ordered[1].id &&
    ordered[1].athleteProfile?.partnerUserId === ordered[0].id;

  if (isStudio(actor)) {
    const mine = ordered.filter((athlete) => athlete.studioId === actor.studioId).length;
    // Both must be the studio's own — unless they picked each other, in which
    // case one of them being ours is enough to enter the pair.
    const allowed = choseEachOther ? mine >= 1 : mine === 2;
    if (!allowed) return { ok: false, error: "NOT_FOUND" };
  }

  // The bracket decides the board AND the prescribed loads (LoadStandard is
  // keyed on [division, sex]), so it is checked here rather than trusted from
  // the form that submitted it.
  const levels = ordered.map((athlete) => athlete.athleteProfile?.division).filter(Boolean);
  if (levels.length === 2 && levels[0] !== levels[1]) {
    return { ok: false, error: "MIXED_LEVELS" };
  }
  if (levels.some((level) => level !== data.division)) {
    return { ok: false, error: "LEVEL_MISMATCH" };
  }
  const sexes = ordered.map((athlete) => athlete.athleteProfile?.sex).filter(Boolean);
  const wrongCategory =
    (data.category === "Womens" && sexes.some((sex) => sex === "m")) ||
    (data.category === "Mens" && sexes.some((sex) => sex === "f"));
  if (wrongCategory) return { ok: false, error: "CATEGORY_MISMATCH" };

  // Nobody enters the same competition twice.
  const entered = await prisma.competitor.findFirst({
    where: {
      team: { seriesId: series.id, archivedAt: null },
      OR: [{ userId: { in: data.athleteIds } }, { email: { in: ordered.map((athlete) => athlete.email) } }],
    },
    select: { id: true },
  });
  if (entered) return { ok: false, error: "ALREADY_ENTERED" };

  const first = ordered[0];
  const name = (data.teamName || first.name || first.email).toUpperCase();
  const owningStudio = isStudio(actor) ? actor.studioId : first.studioId ?? ordered[1].studioId ?? null;

  const team = await prisma.team.create({
    data: {
      seriesId: series.id,
      number: await nextTeamNumber(series.id),
      name,
      category: data.category,
      division: data.division,
      studioId: owningStudio,
      paymentStatus: "pending",
      source: "manual",
      competitors: {
        create: ordered.map((athlete, index) => ({
          position: index + 1,
          fullName: athlete.name ?? athlete.email,
          normalizedName: normalizeName(athlete.name ?? athlete.email),
          email: athlete.email.toLowerCase(),
          phone: athlete.phone,
          dateOfBirth: athlete.athleteProfile?.dateOfBirth ?? null,
          // Carried from the profile so the shirt order does not have to be
          // chased separately once a pair is entered this way.
          shirtSize: athlete.athleteProfile?.shirtSize ?? null,
          bftMember: athlete.athleteProfile?.bftMember ?? false,
          studioId: athlete.studioId,
          userId: athlete.id,
        })),
      },
    },
    select: { id: true, number: true, name: true },
  });

  // Paired into a team means partnered, for any profile not yet linked.
  if (ordered.every((athlete) => athlete.athleteProfile) && !ordered[0].athleteProfile?.partnerUserId) {
    await linkPair(ordered[0].id, ordered[1].id).catch(() => undefined);
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.registrationCreated,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: `paired ${ordered.map((athlete) => athlete.email).join(" + ")} · ${data.category} ${data.division}`,
  });

  revalidateCompetitionViews();
  revalidatePath("/studio/people");
  return { ok: true, message: `Entered ${team.name} as team ${team.number} in ${series.name}.` };
}
