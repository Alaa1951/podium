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

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE SYNC SHOULD DO, worked out with no network and no database.
//
// Everything that decides anything lives in this file as a pure function, so
// the rules can be tested against a snapshot rather than against a live CRM
// that changes while you read it — which this one does: its counts moved
// twice during a single afternoon of exploring it.
//
// THE ONE RULE THAT MATTERS: a record this code cannot read correctly is
// SKIPPED with a reason, never imported with a stand-in value. Thirty-one of
// the eighty-five contacts have no Category and no Division, and both are
// required enums in PODIUM. Division decides the prescribed loads a pair
// lifts (LoadStandard is keyed on [division, sex]) — so a filled-in guess is
// a team handed the wrong weights, discovered on the floor on the morning.
// Those records arrive on their own the moment somebody completes the form.
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
  name: string;
  category: Category;
  division: Division;
  paymentStatus: PaymentStatus;
  amountMinor: number | null;
  billingNumber: string | null;
  seats: SeatDraft[];
};

export type Action =
  | { kind: "create"; externalId: string; draft: TeamDraft }
  | { kind: "update"; externalId: string; teamId: string; changes: MoneyChanges }
  | { kind: "skip"; externalId: string; reason: string };

export type Snapshot = {
  contacts: CrmContact[];
  opportunities: CrmOpportunity[];
  pipelines: CrmPipeline[];
  /** Studio names as PODIUM spells them, for `toStudioName`. */
  studioNames: string[];
  /** Teams already in the target competition. */
  teams: ExistingTeam[];
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

/** The seats a contact describes. Member 1 is the contact; member 2 is fields. */
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
    seats.push({
      position: 2,
      fullName: two,
      email: readField(contact, FIELD.emailTwo)?.toLowerCase() ?? null,
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
  studioNames: readonly string[]
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
      name: teamName,
      category,
      division,
      paymentStatus: payment,
      amountMinor: toMinorUnits(readField(contact, FIELD.paidAmount)),
      billingNumber: readField(contact, FIELD.invoice),
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
    const opportunity = opportunityByContact.get(contact.id);
    if (!opportunity) {
      actions.push({ kind: "skip", externalId: contact.id, reason: "no opportunity" });
      continue;
    }

    const named = stageById.get(opportunity.pipelineStageId);
    if (!named) {
      actions.push({ kind: "skip", externalId: contact.id, reason: "stage not in any pipeline" });
      continue;
    }

    const payment = paymentFromStage(named.pipeline, named.stage);
    if (!payment) {
      actions.push({
        kind: "skip",
        externalId: contact.id,
        reason: `stage "${named.stage}" says nothing about payment`,
      });
      continue;
    }

    const existing = mine.get(contact.id);
    if (existing) {
      // ONLY MONEY IS UPDATED. Names, categories and divisions are left alone
      // once a team exists: those decide brackets and prescribed loads, and a
      // silent rewrite on the morning of a competition is how a pair ends up
      // in the wrong bracket with nobody having touched anything.
      const draft = draftFrom(contact, payment, snapshot.studioNames);
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

    const draft = draftFrom(contact, payment, snapshot.studioNames);
    if (!draft.ok) {
      actions.push({ kind: "skip", externalId: contact.id, reason: draft.reason });
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
    if (action.kind === "skip") reasons[action.reason] = (reasons[action.reason] ?? 0) + 1;
  }
  return {
    create: actions.filter((action) => action.kind === "create").length,
    update: actions.filter((action) => action.kind === "update").length,
    skip: actions.filter((action) => action.kind === "skip").length,
    reasons,
  };
}
