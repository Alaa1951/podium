import { FIELD, readField, type CrmContact } from "@/lib/crm/field-map";
import {
  contactFullName,
  partnerFullName,
  toBftMember,
  toCategory,
  toDate,
  toDivision,
  toMinorUnits,
  toShirtSize,
  toStudioName,
  type Category,
  type Division,
  type ShirtSize,
} from "@/lib/crm/values";
import type { CrmOpportunity, CrmPipeline } from "@/lib/crm/client";
import { entryPlace } from "@/lib/visibility";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE SYNC SHOULD DO, worked out with no network and no database.
//
// Everything that decides anything lives in this file as a pure function, so
// the rules can be tested against a snapshot rather than against a live CRM
// that changes while you read it — which this one does: its counts moved
// twice during a single afternoon of exploring it.
//
// THE ONE RULE THAT MATTERS: a record this code cannot read correctly is
// never imported with a stand-in value. A third of the contacts have no
// Category and no Division, and both are required enums in PODIUM. Division
// decides the prescribed loads a pair lifts (LoadStandard is keyed on
// [division, sex]) — so a filled-in guess is a team handed the wrong weights,
// discovered on the floor on the morning.
//
// It is not discarded either: it becomes an `intake` action, held where staff
// can see and chase it, and promoted to a real team by the first poll after
// somebody finishes the form. Every contact produces exactly one action.
// ─────────────────────────────────────────────────────────────────────────────

export type PaymentStatus = "pending" | "paid" | "refunded";

/** A team as PODIUM already holds it — only what the sync compares or writes. */
export type ExistingTeam = {
  id: string;
  externalId: string | null;
  source: string;
  paymentStatus: PaymentStatus;
  amountMinor: number | null;
  billingNumber: string | null;
};

/** The money fields, and nothing else. See the comment in `reconcile`. */
export type MoneyChanges = Partial<
  Pick<ExistingTeam, "paymentStatus" | "amountMinor" | "billingNumber">
>;

export type SeatDraft = {
  position: 1 | 2;
  fullName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  shirtSize: ShirtSize | null;
  bftMember: boolean;
  studioName: string | null;
};

export type TeamDraft = {
  externalId: string;
  /**
   * The CRM contact exactly as it arrived.
   *
   * THIS IS WHAT MAKES THE UNMAPPED FIELDS SURVIVE. Eighteen custom fields
   * exist and this code reads sixteen of them; without the snapshot the other
   * two — and anything BFT MENA adds to the form next month — would be read,
   * ignored, and gone. It is also the only way a disputed registration can be
   * read back as it was submitted rather than as we interpreted it.
   */
  raw: CrmContact;
  name: string;
  category: Category;
  division: Division;
  paymentStatus: PaymentStatus;
  amountMinor: number | null;
  billingNumber: string | null;
  /**
   * Entered after registration closed, so it holds no place yet.
   *
   * Decided from the CRM's own `dateAdded` — the moment that competition
   * heard of them, which is the honest analogue of a self sign-up's
   * `signupAt`. Until this existed the deadline simply did not apply to CRM
   * registrations, which is the route most entries come through.
   */
  waitlisted: boolean;
  seats: SeatDraft[];
};

/**
 * A registration the CRM has not finished, kept where it can be seen.
 *
 * Everything here is for a human to act on: who they are, how to reach them,
 * and what is stopping them becoming a team. It deliberately carries no
 * category or division — not having those is the entire reason it exists.
 */
export type IntakeDraft = {
  externalId: string;
  /** The contact as it arrived — see the note on TeamDraft.raw. */
  raw: CrmContact;
  contactName: string;
  email: string | null;
  phone: string | null;
  partnerName: string | null;
  teamName: string | null;
  stageName: string | null;
  missing: string;
};

export type Action =
  | { kind: "create"; externalId: string; draft: TeamDraft }
  | { kind: "update"; externalId: string; teamId: string; changes: MoneyChanges }
  /**
   * Not a team yet, and NOT thrown away. An unfinished registration is still
   * a person who paid and expects to compete; skipping it silently is how
   * thirty-two of eighty-seven people become invisible to the people whose
   * job is to chase them.
   */
  | { kind: "intake"; externalId: string; intake: IntakeDraft }
  | { kind: "skip"; externalId: string; reason: string };

export type Snapshot = {
  contacts: CrmContact[];
  opportunities: CrmOpportunity[];
  pipelines: CrmPipeline[];
  /** Studio names as PODIUM spells them, for `toStudioName`. */
  studioNames: string[];
  /** Teams already in the target competition. */
  teams: ExistingTeam[];
  /** Human-approved merges only, scoped to this competition by the reader. */
  merges?: { teamId: string; retiredExternalId: string; canonicalExternalId: string; status: string }[];
  /**
   * After this, an entry waits for a place. Null means the door never closed
   * — and then nobody waits, which is the state of a competition nobody has
   * set a deadline on.
   */
  registrationClosesAt: Date | null;
};

/**
 * What a pipeline stage says about money.
 *
 * Read off the stage's NAME, which is the only thing carrying the meaning —
 * the ids are opaque, and BFT MENA renames and reorders stages from the CRM
 * UI without telling anybody. The ORDER of these tests is the whole trick:
 * "Paid – Not Registered" contains the word "Paid", and "Registered but Not
 * Paid" contains it too, so "not paid" has to be ruled out FIRST.
 *
 * Returns null when a stage cannot be classified, and null means skip. A
 * fourth stage nobody told this code about must not silently become "paid".
 */
export function paymentFromStage(pipelineName: string, stageName: string): PaymentStatus | null {
  const pipeline = pipelineName.toLowerCase();
  const stage = stageName.toLowerCase();

  // Refunds live in their own pipeline, by decision: the three stages of the
  // registration pipeline encode payment crossed with form completion, and a
  // single-valued stage has no room for a third independent fact.
  if (/refund/.test(pipeline) || /refund/.test(stage)) return "refunded";

  if (/not\s*paid/.test(stage) || /unpaid/.test(stage)) return "pending";
  if (/paid/.test(stage)) return "paid";
  return null;
}

/**
 * The seats a contact describes. Member 1 is the contact; member 2 is fields.
 *
 * A PARTNER EMAIL IDENTICAL TO THE REGISTRANT'S IS NOT AN EMAIL. Five of the
 * live registrations have the same address in both boxes — somebody typed
 * their own when asked for their partner's. Recording it as the partner's is
 * worse than recording nothing: it tells the duplicate guard these are the
 * same person, and it would send that partner's mail to somebody else. So it
 * is dropped, and the seat honestly has no address.
 */
function seatsOf(contact: CrmContact, studioNames: readonly string[]): SeatDraft[] {
  const seats: SeatDraft[] = [];

  const one = contactFullName(contact);
  if (one) {
    seats.push({
      position: 1,
      fullName: one,
      email: contact.email?.trim().toLowerCase() || null,
      phone: contact.phone?.trim() || null,
      dateOfBirth: toDate(contact.dateOfBirth ?? null),
      shirtSize: toShirtSize(readField(contact, FIELD.shirtOne)),
      bftMember: toBftMember(readField(contact, FIELD.bftMemberOne)),
      studioName: toStudioName(readField(contact, FIELD.studioOne), studioNames),
    });
  }

  const two = partnerFullName(contact);
  if (two) {
    const ownEmail = contact.email?.trim().toLowerCase() || null;
    const claimed = readField(contact, FIELD.emailTwo)?.toLowerCase() ?? null;
    seats.push({
      position: 2,
      fullName: two,
      email: claimed && claimed === ownEmail ? null : claimed,
      phone: readField(contact, FIELD.phoneTwo),
      dateOfBirth: toDate(readField(contact, FIELD.birthTwo)),
      shirtSize: toShirtSize(readField(contact, FIELD.shirtTwo)),
      bftMember: toBftMember(readField(contact, FIELD.bftMemberTwo)),
      studioName: toStudioName(readField(contact, FIELD.studioTwo), studioNames),
    });
  }

  return seats;
}

/**
 * Turn one contact into what PODIUM would store, or say why it cannot.
 *
 * Exported because the dry run prints it and the tests drive it directly.
 */
export function draftFrom(
  contact: CrmContact,
  payment: PaymentStatus,
  studioNames: readonly string[],
  registrationClosesAt: Date | null = null
): { ok: true; draft: TeamDraft } | { ok: false; reason: string } {
  const category = toCategory(readField(contact, FIELD.category));
  const division = toDivision(readField(contact, FIELD.division));
  if (!category && !division) return { ok: false, reason: "no category and no division" };
  if (!category) return { ok: false, reason: "no category" };
  if (!division) return { ok: false, reason: "no division" };

  const seats = seatsOf(contact, studioNames);
  if (seats.length === 0) return { ok: false, reason: "no name on the contact" };

  // The house rule for a blank team name, the same one every other
  // registration path uses: fall back to the first competitor's name.
  const teamName = (readField(contact, FIELD.teamName) ?? seats[0].fullName).toUpperCase();

  return {
    ok: true,
    draft: {
      externalId: contact.id,
      raw: contact,
      name: teamName,
      category,
      division,
      paymentStatus: payment,
      amountMinor: toMinorUnits(readField(contact, FIELD.paidAmount)),
      billingNumber: readField(contact, FIELD.invoice),
      waitlisted:
        entryPlace({
          signedUpAt: toDate(contact.dateAdded ?? null),
          registrationClosesAt,
        }) === "waiting_list",
      seats,
    },
  };
}

/**
 * The whole plan for one poll: what to create, what to update, what to leave.
 *
 * Deterministic and side-effect free — the caller decides whether to carry
 * any of it out, and the dry run carries out none of it.
 */
/** What to hold for a contact that cannot become a team yet. */
function intakeFrom(
  contact: CrmContact,
  stageName: string | null,
  missing: string
): IntakeDraft {
  return {
    externalId: contact.id,
    raw: contact,
    // Never blank: the row is useless if it cannot be spoken about. A contact
    // with no name at all is listed by the only handle it has.
    contactName: contactFullName(contact) ?? readField(contact, FIELD.nameTwo) ?? contact.id,
    email: contact.email?.trim().toLowerCase() || null,
    phone: contact.phone?.trim() || readField(contact, FIELD.phoneTwo),
    partnerName: partnerFullName(contact),
    teamName: readField(contact, FIELD.teamName),
    stageName,
    missing,
  };
}

export function reconcile(snapshot: Snapshot): Action[] {
  const stageById = new Map<string, { stage: string; pipeline: string }>();
  for (const pipeline of snapshot.pipelines) {
    for (const stage of pipeline.stages ?? []) {
      stageById.set(stage.id, { stage: stage.name, pipeline: pipeline.name });
    }
  }

  const opportunityByContact = new Map<string, CrmOpportunity>();
  for (const opportunity of snapshot.opportunities) {
    opportunityByContact.set(opportunity.contactId, opportunity);
  }

  // ONLY teams this integration created are candidates for update. A team
  // entered through self sign-up, or by a studio, carries no externalId and
  // stays PODIUM's alone — the CRM must never write over somebody else's work.
  const mine = new Map<string, ExistingTeam>();
  for (const team of snapshot.teams) {
    if (team.source === "ghl" && team.externalId) mine.set(team.externalId, team);
  }

  const actions: Action[] = [];

  for (const contact of snapshot.contacts) {
    const merge = snapshot.merges?.find((entry) =>
      entry.retiredExternalId === contact.id || entry.canonicalExternalId === contact.id
    );
    if (merge) {
      const canonical = snapshot.teams.find((team) => team.id === merge.teamId);
      // A prepared/interrupted merge must not be undone by an ordinary poll.
      // After linking, the payer remains the only source of payment/refunds.
      const linked = (merge.status === "linked" || merge.status === "completed") &&
        canonical?.externalId === merge.canonicalExternalId;
      if (!linked || contact.id === merge.retiredExternalId) {
        actions.push({ kind: "skip", externalId: contact.id,
          reason: linked ? "registration merged into existing team" : "registration merge awaiting completion" });
        continue;
      }
    }
    const opportunity = opportunityByContact.get(contact.id);
    const named = opportunity ? stageById.get(opportunity.pipelineStageId) : undefined;
    const payment = named ? paymentFromStage(named.pipeline, named.stage) : null;
    const stageName = named?.stage ?? null;

    // A contact whose state cannot be read is still a person who registered.
    // It goes on the list with the reason showing, rather than vanishing.
    if (!opportunity) {
      actions.push({
        kind: "intake",
        externalId: contact.id,
        intake: intakeFrom(contact, null, "not in the pipeline"),
      });
      continue;
    }
    if (!named) {
      actions.push({
        kind: "intake",
        externalId: contact.id,
        intake: intakeFrom(contact, null, "stage not in any pipeline"),
      });
      continue;
    }
    if (!payment) {
      actions.push({
        kind: "intake",
        externalId: contact.id,
        intake: intakeFrom(contact, stageName, `stage "${named.stage}" does not say if it is paid`),
      });
      continue;
    }

    const existing = mine.get(contact.id);
    if (existing) {
      // ONLY MONEY IS UPDATED. Names, categories and divisions are left alone
      // once a team exists: those decide brackets and prescribed loads, and a
      // silent rewrite on the morning of a competition is how a pair ends up
      // in the wrong bracket with nobody having touched anything.
      const draft = draftFrom(contact, payment, snapshot.studioNames, snapshot.registrationClosesAt);
      const changes: MoneyChanges = {};
      if (existing.paymentStatus !== payment) changes.paymentStatus = payment;
      if (draft.ok) {
        if (draft.draft.amountMinor !== null && draft.draft.amountMinor !== existing.amountMinor) {
          changes.amountMinor = draft.draft.amountMinor;
        }
        if (draft.draft.billingNumber && draft.draft.billingNumber !== existing.billingNumber) {
          changes.billingNumber = draft.draft.billingNumber;
        }
      }
      if (Object.keys(changes).length === 0) {
        actions.push({ kind: "skip", externalId: contact.id, reason: "already in step" });
      } else {
        actions.push({ kind: "update", externalId: contact.id, teamId: existing.id, changes });
      }
      continue;
    }

    const draft = draftFrom(contact, payment, snapshot.studioNames, snapshot.registrationClosesAt);
    if (!draft.ok) {
      actions.push({
        kind: "intake",
        externalId: contact.id,
        intake: intakeFrom(contact, stageName, draft.reason),
      });
      continue;
    }
    actions.push({ kind: "create", externalId: contact.id, draft: draft.draft });
  }

  return actions;
}

/** A one-line count of a plan, for the log and the dry run. */
export function summarise(actions: readonly Action[]) {
  const reasons: Record<string, number> = {};
  for (const action of actions) {
    const reason = action.kind === "intake" ? action.intake.missing : action.kind === "skip" ? action.reason : null;
    if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return {
    create: actions.filter((action) => action.kind === "create").length,
    update: actions.filter((action) => action.kind === "update").length,
    intake: actions.filter((action) => action.kind === "intake").length,
    skip: actions.filter((action) => action.kind === "skip").length,
    reasons,
  };
}
