import type { CrmFieldWrite, CrmPipeline } from "@/lib/crm/client";
import { FIELD } from "@/lib/crm/field-map";
import { paymentFromStage } from "@/lib/crm/reconcile";
import type { Category, Division, ShirtSize } from "@/lib/crm/values";

// ─────────────────────────────────────────────────────────────────────────────
// FINISHING A REGISTRATION THE CRM NEVER FINISHED.
//
// Thirty of the eighty-seven live registrations are held: somebody paid, and
// the form stopped before Category and Division. They are not teams, they hold
// no place, and until now the only way out of that state was for the same
// person to go back to a form they had already abandoned. This file is the
// other way out — PODIUM writing the missing answers back to the CRM, so the
// CRM stays the record instead of the two drifting apart.
//
// Everything here is PURE. It builds a request body and names a stage; the
// client sends it. That split is not tidiness — it is what lets these rules be
// tested at all, when the one thing no test can reach is the shape of a write
// (GHL resolves the record before it validates the body, so every probe
// against a made-up id returns the same "not found").
//
// ── TWO RULES, BOTH ENFORCED BY CONSTRUCTION ─────────────────────────────────
//
//   1. THE STAGE MOVES ALONG THE "REGISTERED" AXIS ONLY, NEVER THE MONEY ONE.
//      The three stages encode two facts multiplied together: paid × form
//      finished. PODIUM is allowed to say the form is finished — it just
//      watched somebody finish it. It is NOT allowed to say anything about
//      money, because the stage is exactly where it READS the money from, and
//      a write there would be this app confirming its own payment. So the
//      target stage is found by SEARCHING for a stage that agrees with the
//      current one about money, rather than by naming a destination. If no such
//      stage exists, nothing moves.
//
//   2. THIS WRITE CAN ADD OR CORRECT, NEVER ERASE. A value the caller does not
//      supply produces no entry in the body at all, rather than an empty one.
//      A half-filled completion form must not blank the partner's phone number
//      that the registrant typed in themselves three weeks ago.
// ─────────────────────────────────────────────────────────────────────────────

/** The CRM's own option lists, keyed by field id, as `listCustomFields` reads them. */
export type FieldOptions = Record<string, readonly string[]>;

/** One partner, as PODIUM knows them, on the way back to the CRM. */
export type PartnerAnswers = {
  fullName: string;
  email: string | null;
  phone: string | null;
  gender: "Male" | "Female" | null;
  shirtSize: ShirtSize | null;
  bftMember: boolean;
  /** As PODIUM spells it — "West Walk", not "BFT West Walk  Female". */
  studioName: string | null;
};

export type CompletionAnswers = {
  category: Category | null;
  division: Division | null;
  teamName: string | null;
  partner: PartnerAnswers | null;
};

export type CompletionBody = {
  fields: CrmFieldWrite[];
  /**
   * Answers that had nowhere valid to go — an option the CRM does not offer, or
   * a studio whose two gendered doors cannot be told apart. NOT silent: the
   * caller reports these, because a dropped answer looks exactly like a
   * successful write from the outside.
   */
  dropped: string[];
};

/** PODIUM's word → the CRM's, for the two fields that block every held record. */
const CATEGORY_OUT: Record<Category, string> = { Mens: "MEN", Womens: "WOMEN", Mixed: "MIXED" };
const DIVISION_OUT: Record<Division, string> = { Rookie: "ROOKIE", Open: "OPEN", Pro: "PRO" };

/**
 * The CRM option that means this studio, for a person of this gender.
 *
 * The option list is gendered for some studios and not others: "BFT West Walk
 * Male" and "BFT West Walk  Female" are one studio with two doors, while "BFT
 * The Pearl" has one. PODIUM stores neither spelling — `toStudioName` strips
 * the prefix and the suffix on the way in, which is right for reading and
 * lossy for writing.
 *
 * So this walks the CRM's real options and answers only when it is certain.
 * Two variants and no gender to choose between them means NO WRITE: a person
 * filed under the wrong door of their own studio is worse than a blank,
 * because it looks deliberate.
 */
export function studioOption(
  studioName: string,
  gender: "Male" | "Female" | null,
  options: readonly string[]
): string | null {
  const wanted = studioName.trim().toLowerCase();
  if (!wanted) return null;

  const matches = options.filter((label) => {
    const bare = label
      .replace(/^BFT\s+/i, "")
      .replace(/\s+(male|female)$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return bare === wanted;
  });

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  if (!gender) return null;
  const gendered = matches.filter((label) => new RegExp("\\s" + gender + "$", "i").test(label));
  return gendered.length === 1 ? gendered[0] : null;
}

/** One option-typed field, written only if the CRM actually offers that option. */
function option(
  id: string,
  value: string,
  wrap: "one" | "many",
  label: string,
  options: FieldOptions,
  into: CrmFieldWrite[],
  dropped: string[]
): void {
  const allowed = options[id];
  // An id with no option list is an id the CRM did not describe. Writing an
  // unchecked value into a picklist is how a field ends up holding a string no
  // form can ever produce again.
  if (!allowed || !allowed.includes(value)) {
    dropped.push(label);
    return;
  }
  into.push({ id, value: wrap === "many" ? [value] : value });
}

/**
 * The body that finishes a held registration.
 *
 * `options` comes from the CRM itself rather than from a constant in here, so a
 * studio added to the form next month is writable the same afternoon, and a
 * value the form no longer offers is refused rather than stored.
 */
export function completionFields(answers: CompletionAnswers, options: FieldOptions): CompletionBody {
  const fields: CrmFieldWrite[] = [];
  const dropped: string[] = [];

  if (answers.category) {
    option(FIELD.category, CATEGORY_OUT[answers.category], "many", "category", options, fields, dropped);
  }
  if (answers.division) {
    option(FIELD.division, DIVISION_OUT[answers.division], "many", "division", options, fields, dropped);
  }

  const teamName = answers.teamName?.trim();
  if (teamName) fields.push({ id: FIELD.teamName, value: teamName });

  const partner = answers.partner;
  if (partner) {
    const name = partner.fullName.trim();
    if (name) fields.push({ id: FIELD.nameTwo, value: name });

    const email = partner.email?.trim().toLowerCase();
    if (email) fields.push({ id: FIELD.emailTwo, value: email });

    const phone = partner.phone?.trim();
    if (phone) fields.push({ id: FIELD.phoneTwo, value: phone });

    if (partner.gender) {
      option(FIELD.genderTwo, partner.gender, "one", "partner gender", options, fields, dropped);
    }
    if (partner.shirtSize) {
      option(FIELD.shirtTwo, partner.shirtSize, "one", "partner shirt size", options, fields, dropped);
    }

    // A ticked checkbox is the array of its ticked labels, and the label is the
    // CRM's to phrase — "I am a BFT member" today. Unticked is NOT written: see
    // rule 2. Somebody who left it blank in PODIUM did not thereby say no.
    if (partner.bftMember) {
      const labels = options[FIELD.bftMemberTwo];
      if (labels?.length === 1) fields.push({ id: FIELD.bftMemberTwo, value: [labels[0]] });
      else dropped.push("partner BFT membership");
    }

    if (partner.studioName) {
      const chosen = studioOption(partner.studioName, partner.gender, options[FIELD.studioTwo] ?? []);
      if (chosen) fields.push({ id: FIELD.studioTwo, value: [chosen] });
      else dropped.push("partner studio");
    }

    // The question the whole held state turns on. "Yes" is the CRM's own
    // wording, so it is looked up rather than typed.
    const yes = (options[FIELD.havePartner] ?? []).find((label) => /^yes$/i.test(label.trim()));
    if (yes) fields.push({ id: FIELD.havePartner, value: yes });
    else dropped.push("have partner");
  }

  // THE PARTNER'S DATE OF BIRTH IS NOT WRITTEN, and that is a decision rather
  // than an omission. It is the one DATE field in the set, and a date is the
  // one shape no read of the live CRM could settle for a write: the contacts
  // hold epoch milliseconds, which is what GHL RETURNS, not necessarily what
  // it accepts. PODIUM keeps the date on its own seat, where it is used.

  return { fields, dropped };
}

/** Does this stage name say the registration form is finished? Null if unclear. */
export function registeredFromStage(stageName: string): boolean | null {
  const stage = stageName.toLowerCase();
  // "Not Registered" is ruled out first, for the same reason `paymentFromStage`
  // rules out "not paid" first: the longer phrase contains the shorter one.
  if (/not\s*registered/.test(stage)) return false;
  if (/registered/.test(stage)) return true;
  return null;
}

export type StageMove = { pipelineId: string; stageId: string };

/**
 * Where a completed registration's opportunity should stand now, or null.
 *
 * Null is the ordinary answer in three cases and none of them is a failure: the
 * stage already says registered; no stage on this pipeline says registered
 * WITHOUT also changing what it says about money; or the stage cannot be read
 * at all, in which case this code has no business touching it.
 */
export function stageAfterCompleting(
  pipelines: readonly CrmPipeline[],
  currentStageId: string
): StageMove | null {
  for (const pipeline of pipelines) {
    const current = (pipeline.stages ?? []).find((stage) => stage.id === currentStageId);
    if (!current) continue;

    const money = paymentFromStage(pipeline.name, current.name);
    if (!money) return null; // Unreadable money means hands off entirely.
    // A REFUND IS NOT A REGISTRATION TO FINISH. They got their money back; the
    // state of their form is no longer a thing PODIUM has any business
    // advancing, and the refund pipeline has its own stages for its own story.
    if (money === "refunded") return null;
    if (registeredFromStage(current.name) === true) return null; // Already there.

    // THE SEARCH, and the guard in one. A candidate must agree with the current
    // stage about money — that is the whole of rule 1, written as a filter
    // rather than as a promise in a comment.
    const target = (pipeline.stages ?? []).find(
      (stage) =>
        stage.id !== current.id &&
        registeredFromStage(stage.name) === true &&
        paymentFromStage(pipeline.name, stage.name) === money
    );
    return target ? { pipelineId: pipeline.id, stageId: target.id } : null;
  }
  return null;
}
