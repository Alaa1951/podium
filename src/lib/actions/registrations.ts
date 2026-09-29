"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { registrantSeat } from "@/lib/ownership";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { alreadyEntered } from "@/lib/one-entry";
import { normalizeName } from "@/lib/scoring";
import { createTeam } from "@/lib/team-create";
import { isBft, requireAccess, teamScope } from "@/lib/session";
import { registrationOpen } from "@/lib/visibility";
import {
  optionalText,
  personSchema,
  toDate,
  toMinor,
} from "@/lib/actions/registration-fields";

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATIONS.
//
// A registration is a pair who entered and paid, and in this system that same
// record IS the team — it gets a wave, and then a score. These actions are the
// front of the funnel: taking a registration in, confirming its money, and
// correcting what arrived.
//
// Two words that are never mixed here:
//   REGISTERED  paid and entered  → Team.paymentStatus
//   MEMBER      a BFT studio membership → Competitor.studioId
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { message?: string } : { message?: string; data: T }))
  | { ok: false; error: string };

const registrationSchema = z.object({
  seriesId: z.string().min(1),
  /** Optional: without one, the team takes the first competitor's name. */
  teamName: optionalText,
  category: z.enum(["Womens", "Mens", "Mixed"]),
  division: z.enum(["Rookie", "Open", "Pro"]),
  one: personSchema,
  two: personSchema,
  paymentStatus: z.enum(["pending", "paid"]).default("pending"),
  /** Major units as typed — "250" or "250.00" — converted to minor here. */
  amount: optionalText,
  currency: z.string().trim().min(1).max(8).default("QAR"),
  billingNumber: optionalText,
  paymentNote: optionalText,
  externalId: optionalText,
});

/**
 * Take a registration in.
 *
 * This is the shape the CRM form submits, entered by hand. When the GHL
 * integration lands it will call the same path with the same fields, so the
 * manual route stays the fallback rather than becoming a second way in with
 * its own rules.
 */
export async function createRegistration(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAccess("registrations.create");
  if (actor.viewAs || !isBft(actor)) return { ok: false, error: "FORBIDDEN" };

  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;

  // A finished (or archived) competition's field is the record.
  const series = await prisma.series.findUnique({ where: { id: data.seriesId }, select: { status: true, archivedAt: true } });
  if (!series || series.archivedAt) return { ok: false, error: "NOT_FOUND" };
  if (series.status === "final") return { ok: false, error: "SERIES_FINISHED" };

  // NOBODY ENTERS THE SAME COMPETITION TWICE, which this path did not check
  // at all. It relied on `@@unique([seriesId, externalId])`, and the form
  // leaves `externalId` blank — so it would happily make a second team for a
  // pair who had already signed themselves up or come through the CRM.
  const twice = await alreadyEntered({
    seriesId: data.seriesId,
    emails: [data.one.email, data.two.email],
  });
  if (twice) return { ok: false, error: "ALREADY_ENTERED" };

  // A pair without a chosen team name competes under the first competitor's
  // name. A team is never nameless — the board has to call them something.
  const name = (data.teamName ?? data.one.fullName).toUpperCase();
  const paid = data.paymentStatus === "paid";

  // The row itself is written by `createTeam`, which the CRM sync uses too.
  // One path, so the two cannot drift: this one used to omit `shirtSize` and
  // `bftMember` while the columns sat there waiting for it.
  const created = await createTeam(prisma, {
    seriesId: data.seriesId,
    name,
    category: data.category,
    division: data.division,
    // The registering competitor's studio also owns the team, which is what
    // scopes it for that studio's account.
    studioId: data.one.studioId,
    paymentStatus: data.paymentStatus,
    source: "manual",
    paidAt: paid ? new Date() : null,
    amountMinor: toMinor(data.amount),
    currency: data.currency,
    billingNumber: data.billingNumber,
    paymentNote: data.paymentNote,
    confirmedById: paid ? actor.id : null,
    externalId: data.externalId,
    seats: [data.one, data.two].map((person, index) => ({
      position: index + 1,
      fullName: person.fullName,
      phone: person.phone,
      email: person.email,
      dateOfBirth: toDate(person.dateOfBirth),
      studioId: person.studioId,
    })),
  });

  if (!created.ok) {
    return {
      ok: false,
      error: created.error === "ALREADY_ENTERED" ? "ALREADY_ENTERED" : "NUMBER_RACE",
    };
  }
  const team = created;

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.registrationCreated,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${team.name}`,
    detail: `${data.category} ${data.division} · ${data.paymentStatus}`,
  });

  revalidateCompetitionViews();
  return { ok: true, data: { id: team.id }, message: `Registered ${team.name} as team ${team.number}.` };
}

/** A person on the edit form, with the seat they already hold (if any). */
const editPerson = personSchema.extend({ id: z.string().min(1).optional() });

const editSchema = z.object({
  teamId: z.string().min(1),
  /** Open text, editable at any time — by BFT MENA or by the integration. */
  teamName: z.string().trim().min(1).max(120),
  category: z.enum(["Womens", "Mens", "Mixed"]),
  division: z.enum(["Rookie", "Open", "Pro"]),
  one: editPerson,
  /** Absent on a one-seat team — a team whose partner has not been named. */
  two: editPerson.optional(),
});

/**
 * Correct a registration. The team name in particular is an open field: a pair
 * may change what they compete under at any point up to the event, and the
 * integration may fill it in later than they did.
 *
 * A studio may do this to its own teams, up to the registration deadline — but
 * not the division. The manual's own FAQ sends a division change to BFT MENA,
 * because a division is what a team is ranked against and moving it after
 * others have entered changes somebody else's result. The studio form does not
 * offer the field at all; the check here is what makes that true rather than
 * merely displayed.
 */
export async function updateRegistration(input: unknown): Promise<ActionResult> {
  const actor = await requireAccess("registrations.edit");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID_INPUT" };
  const data = parsed.data;

  // Scoped, not merely checked afterwards: a studio asking for another studio's
  // team gets NOT_FOUND, and learns nothing about whether it exists.
  const team = await prisma.team.findFirst({
    where: { id: data.teamId, ...teamScope(actor) },
    select: {
      id: true,
      seriesId: true,
      number: true,
      name: true,
      division: true,
      ownership: true,
      registrantEmail: true,
      registrantUserId: true,
      series: { select: { registrationClosesAt: true } },
      competitors: { orderBy: { position: "asc" }, select: { id: true, position: true, email: true, userId: true } },
    },
  });
  if (!team) return { ok: false, error: "NOT_FOUND" };

  const deadline = registrationOpen({
    role: actor.role,
    registrationClosesAt: team.series.registrationClosesAt,
    now: new Date(),
  });
  if (!deadline.open) return { ok: false, error: deadline.reason };

  if (!isBft(actor) && data.division !== team.division) {
    return { ok: false, error: "DIVISION_LOCKED" };
  }

  // WHICH SEAT EACH PERSON IS. A form that sends seat ids is taken at its
  // word: a person with an id is that seat, a person without one is a NEW
  // seat. Only an older form that sends no ids at all is matched by position
  // order. A new seat goes to whichever position is free. Nothing here
  // assumes two seats, and nothing deletes one.
  const people = [data.one, data.two].filter((person): person is NonNullable<typeof person> => Boolean(person));
  const seats = team.competitors;
  const byId = people.some((person) => person.id);
  const targets = people.map((person, index) =>
    byId
      ? person.id ? seats.find((seat) => seat.id === person.id) ?? "unknown" : null
      : seats[index] ?? null
  );
  if (targets.includes("unknown")) return { ok: false, error: "INVALID_INPUT" };
  const held = targets.filter((target): target is (typeof seats)[number] => Boolean(target) && target !== "unknown");
  if (new Set(held.map((seat) => seat.id)).size !== held.length) return { ok: false, error: "INVALID_INPUT" };
  if (seats.length + targets.filter((target) => target === null).length > 2) return { ok: false, error: "INVALID_INPUT" };

  // The person who registered the team is an identity: changing their email
  // changes who that is, which is BFT MENA's to do (plan §4).
  const registrant = registrantSeat(team);
  const registrantIndex = registrant ? targets.findIndex((target) => target !== "unknown" && target?.id === registrant.id) : -1;
  const newRegistrantEmail = registrantIndex >= 0 ? people[registrantIndex].email?.toLowerCase() ?? null : undefined;
  const registrantMoves = registrant !== null && newRegistrantEmail !== undefined && newRegistrantEmail !== (registrant.email ?? "").toLowerCase();
  if (registrantMoves && !isBft(actor)) return { ok: false, error: "REGISTRANT_EMAIL_LOCKED" };

  await prisma.$transaction(async (tx) => {
    // Every writer of a team's seats takes the competition lock.
    await tx.$queryRaw`SELECT id FROM Series WHERE id = ${team.seriesId} FOR UPDATE`;
    await tx.team.update({
      where: { id: team.id },
      data: {
        name: data.teamName.toUpperCase(),
        category: data.category,
        division: data.division,
        // Which studio owns the entry is what scopes it, so only BFT MENA may
        // move it. A studio editing its own team keeps it — otherwise saving
        // the form with a different first competitor would hand the team away.
        ...(isBft(actor) ? { studioId: data.one.studioId } : {}),
      },
    });

    const taken = new Set(seats.map((seat) => seat.position));
    for (const [index, person] of people.entries()) {
      const fields = {
        fullName: person.fullName,
        normalizedName: normalizeName(person.fullName),
        phone: person.phone,
        email: person.email?.toLowerCase() ?? null,
        dateOfBirth: toDate(person.dateOfBirth),
        studioId: person.studioId,
      };
      const target = targets[index];
      if (target && target !== "unknown") {
        await tx.competitor.update({ where: { id: target.id }, data: fields });
      } else {
        const position = [1, 2].find((free) => !taken.has(free))!;
        taken.add(position);
        await tx.competitor.create({ data: { teamId: team.id, position, ...fields } });
      }
    }

    if (registrantMoves) {
      await tx.team.update({
        where: { id: team.id },
        data: newRegistrantEmail
          ? { registrantEmail: newRegistrantEmail, registrantUserId: null }
          : { ownership: "unknown", registrantEmail: null, registrantUserId: null },
      });
    }
  });

  if (registrantMoves) {
    await recordAudit({
      actorId: actor.id,
      action: AUDIT.teamOwnershipChanged,
      targetType: "team",
      targetId: team.id,
      targetLabel: `${team.number} ${data.teamName}`,
      detail: `registrant ${registrant?.email ?? "—"} → ${newRegistrantEmail ?? "unknown (no email)"} (registration edited)`,
    });
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.registrationUpdated,
    targetType: "team",
    targetId: team.id,
    targetLabel: `${team.number} ${data.teamName}`,
    detail: team.name === data.teamName.toUpperCase() ? "details corrected" : `renamed from ${team.name}`,
  });

  revalidateCompetitionViews();
  return { ok: true };
}
