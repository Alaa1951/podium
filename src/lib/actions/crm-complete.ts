"use server";

import { z } from "zod";

import { AUDIT, recordAudit } from "@/lib/audit";
import { isBft } from "@/lib/access";
import { createCrmClient, type CrmClient } from "@/lib/crm/client";
import { completionFields, stageAfterCompleting, type CompletionAnswers } from "@/lib/crm/complete";
import { FIELD, readField } from "@/lib/crm/field-map";
import { crmSyncEnabled, runSync } from "@/lib/crm/sync";
import { toCategory, toDivision } from "@/lib/crm/values";
import { prisma } from "@/lib/prisma";
import { revalidateCompetitionViews } from "@/lib/revalidate-competition";
import { requireAccess } from "@/lib/session";

// ─────────────────────────────────────────────────────────────────────────────
// FINISHING SOMEBODY ELSE'S REGISTRATION.
//
// Thirty people on the live CRM have paid and are not teams. The form stopped
// before Category and Division, and the only way out was for the same person to
// go back to a form they had already left. This is the way out that does not
// depend on them: staff fill in what is missing here, PODIUM writes it to the
// CRM, and the next poll turns it into a team.
//
// THE WRITE GOES TO THE CRM, NOT TO PODIUM, and that is the whole design. A
// team created straight into PODIUM would be a registration the CRM has never
// heard of — the record and the system would disagree from the first minute, and
// every later poll would have to be taught to leave it alone. Writing to the
// source keeps one record of a registration, which is the thing BFT MENA
// actually asked for when they asked for a two-way integration.
//
// FOUR THINGS IT WILL NOT DO:
//
//   It will not touch the money. `updateContactFields` refuses those field ids
//   outright, and the stage move is searched along the "registered" axis only.
//
//   It will not blank anything. An answer left empty here is an answer NOT
//   SENT, so a half-filled form cannot erase what the registrant typed.
//
//   It will not claim success it has not seen. The write is read back from the
//   CRM and compared; a write that stored nothing is reported as a failure
//   rather than as a job done. (GHL resolves the record before validating the
//   body, so this read-back is the only proof the shape is right.)
//
//   It will not run with the sync switched off. The promise made to whoever
//   presses the button is "this becomes a team" — and with no poller, nothing
//   would ever come back.
//
// IT REUSES `registrations.create`. A new permission key has to be written into
// every system role by the migration, or the feature ships invisible to
// everyone except an admin — who is the person testing it. That has happened
// twice here. This action creates a registration, so the key already fits.
// ─────────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const optional = z
  .string()
  .trim()
  .max(191)
  .optional()
  .transform((value) => (value && value.length ? value : null));

const schema = z.object({
  intakeId: z.string().min(1),
  seriesId: z.string().min(1),
  category: z.enum(["Mens", "Womens", "Mixed"]).nullish(),
  division: z.enum(["Rookie", "Open", "Pro"]).nullish(),
  teamName: optional,
  partnerName: optional,
  partnerEmail: z.string().trim().max(191).email().optional().or(z.literal("")).transform((value) => value || null),
  partnerPhone: optional,
  partnerGender: z.enum(["Male", "Female"]).nullish(),
  partnerShirtSize: z.enum(["XS", "S", "M", "L", "XL", "XXL"]).nullish(),
  partnerBftMember: z.boolean().optional(),
  partnerStudioName: optional,
});

export type CompleteRegistrationInput = z.input<typeof schema>;

export async function completeCrmRegistration(
  input: CompleteRegistrationInput,
  client: CrmClient = createCrmClient()
): Promise<ActionResult> {
  const actor = await requireAccess("registrations.create");
  if (actor.viewAs) return { ok: false, error: "FORBIDDEN" };
  // The work list itself is BFT MENA's — it carries contact details for people
  // who have not finished registering, which a studio never sees.
  if (!isBft(actor)) return { ok: false, error: "FORBIDDEN" };
  if (!crmSyncEnabled()) return { ok: false, error: "DISABLED" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  const data = parsed.data;

  // Scoped in the `where`, so the competition in the URL is the competition
  // written to — an intake id from another series simply is not found.
  const intake = await prisma.crmIntake.findFirst({
    where: { id: data.intakeId, seriesId: data.seriesId },
    select: { id: true, externalId: true, contactName: true },
  });
  if (!intake) return { ok: false, error: "NOT_FOUND" };

  const answers: CompletionAnswers = {
    category: data.category ?? null,
    division: data.division ?? null,
    teamName: data.teamName,
    partner: data.partnerName
      ? {
          fullName: data.partnerName,
          email: data.partnerEmail,
          phone: data.partnerPhone,
          gender: data.partnerGender ?? null,
          shirtSize: data.partnerShirtSize ?? null,
          bftMember: data.partnerBftMember ?? false,
          studioName: data.partnerStudioName,
        }
      : null,
  };

  let written: number;
  let dropped: string[];
  let moved = false;
  try {
    const definitions = await client.listCustomFields();
    const options = Object.fromEntries(definitions.map((field) => [field.id, field.options]));

    const body = completionFields(answers, options);
    if (body.fields.length === 0) return { ok: false, error: "NOTHING_TO_WRITE" };
    written = body.fields.length;
    dropped = body.dropped;

    await client.updateContactFields(intake.externalId, body.fields);

    // ── The read-back ──────────────────────────────────────────────────────
    // Only the two fields that decide whether this record can become a team at
    // all are checked, and they are checked THROUGH THE READER the sync uses —
    // so this proves the round trip, not just that something was stored.
    //
    // ONLY WHAT WAS ACTUALLY SENT is checked. An answer the CRM has no option
    // for was dropped before the request and is already named in `dropped`;
    // reporting it a second time as a failed write would send staff back to
    // redo a write that landed perfectly.
    const sent = new Set(body.fields.map((field) => field.id));
    const after = await client.getContact(intake.externalId);
    if (!after) return { ok: false, error: "NOT_READ_BACK" };
    if (sent.has(FIELD.category) && toCategory(readField(after, FIELD.category)) !== answers.category) {
      return { ok: false, error: "NOT_READ_BACK" };
    }
    if (sent.has(FIELD.division) && toDivision(readField(after, FIELD.division)) !== answers.division) {
      return { ok: false, error: "NOT_READ_BACK" };
    }

    // ── The stage ──────────────────────────────────────────────────────────
    // Last, and allowed to be a no-op. The fields are what make a team; the
    // stage is what makes the CRM's own board honest. If this half fails the
    // fields are already in, which is the right way round — the opposite order
    // would leave a record filed as registered with nothing in it.
    const [opportunities, pipelines] = await Promise.all([
      client.listOpportunities(),
      client.listPipelines(),
    ]);
    const opportunity = opportunities.find((row) => row.contactId === intake.externalId);
    const move = opportunity ? stageAfterCompleting(pipelines, opportunity.pipelineStageId) : null;
    if (opportunity && move) {
      await client.moveOpportunityStage(opportunity.id, move.pipelineId, move.stageId);
      moved = true;
    }
  } catch {
    // The client's errors never carry the body, and neither does this: the body
    // of this particular write is somebody's name, email and phone number.
    return { ok: false, error: "CRM_FAILED" };
  }

  await recordAudit({
    actorId: actor.id,
    action: AUDIT.crmRegistrationCompleted,
    targetType: "event",
    targetId: intake.externalId,
    targetLabel: intake.contactName,
    detail: `wrote ${written} field(s)${moved ? ", moved the pipeline stage" : ""}${
      dropped.length ? `, could not write: ${dropped.join(", ")}` : ""
    }`,
  });

  // Bring them in now rather than in up to fifteen minutes. The sync is the
  // ONLY thing that creates the team — this action never does — so a poll that
  // is busy is not a failure here: the next one picks the record up.
  const synced = await runSync();
  revalidateCompetitionViews();

  const parts = [`Written to the CRM.`];
  if (moved) parts.push("Their CRM stage now says registered.");
  if (synced.ok && synced.created > 0) parts.push("They are a team now.");
  else if (synced.busy) parts.push("A sync was already running — they will appear on the next one.");
  else if (!synced.ok) parts.push("The sync could not run just now; they will appear on the next one.");
  else parts.push("Still not a team — something else on the CRM record is missing.");
  if (dropped.length) parts.push(`Could not write: ${dropped.join(", ")}.`);

  return { ok: true, message: parts.join(" ") };
}
