import { describe, expect, it } from "vitest";
import { FIELD, type CrmContact } from "./field-map";
import { planPaidRegistrationMerge } from "./merge-plan";

const contact = (id: string, email: string, fields: Record<string, unknown> = {}): CrmContact => ({
  id, firstName: id, email, customFields: Object.entries(fields).map(([id, value]) => ({ id, value })),
});
const registration = () => ({ ...contact("captain", "captain@example.test", {
  [FIELD.nameTwo]: "Partner", [FIELD.emailTwo]: "payer@example.test", [FIELD.phoneTwo]: "66123456",
  [FIELD.birthTwo]: "2000-01-02", [FIELD.shirtTwo]: "XS", [FIELD.shirtOne]: "L",
  [FIELD.genderOne]: "Male", [FIELD.genderTwo]: "Female", [FIELD.studioTwo]: ["BFT The Pearl"],
}), phone: "+97466543210", dateOfBirth: "1990-03-04" });
const payer = () => ({ ...contact("payer", "payer@example.test", { [FIELD.paidAmount]: "199.50", [FIELD.invoice]: "invoice-1" }), phone: "0097466123456" });
const team = { name: "Existing Team", category: "Mixed", division: "Open" };

describe("paid registration merge planning", () => {
  it("moves each person's custom fields to the correct seat when the partner paid", () => {
    const plan = planPaidRegistrationMerge({ team, registration: registration(), payer: payer(), other: registration() });
    const fields = Object.fromEntries(plan.body.customFields.map(f => [f.id, f.value]));
    expect(plan.payerPositionInTeam).toBe(2);
    expect(plan.body.dateOfBirth).toBe("2000-01-02");
    expect(fields).toMatchObject({ [FIELD.nameTwo]: "captain", [FIELD.emailTwo]: "captain@example.test",
      [FIELD.birthTwo]: "1990-03-04", [FIELD.shirtOne]: "XS", [FIELD.shirtTwo]: "L",
      [FIELD.genderOne]: "Female", [FIELD.genderTwo]: "Male", [FIELD.teamName]: team.name });
    expect(fields[FIELD.paidAmount]).toBeUndefined();
    expect(fields[FIELD.invoice]).toBeUndefined();
    expect(plan.payment).toEqual({ amount: "199.50", invoice: "invoice-1" });
  });
  it("keeps the original registering payer and fills missing data from the reversed registration", () => {
    const original = registration();
    const extra = payer();
    extra.customFields!.push({ id: FIELD.emailTwo, value: "captain@example.test" });
    const plan = planPaidRegistrationMerge({ team, registration: original, payer: original, other: extra });
    expect(plan.payerEmail).toBe("captain@example.test");
    expect(plan.partnerEmail).toBe("payer@example.test");
    expect(plan.payerPositionInTeam).toBe(1);
  });
  it("refuses a different payer, ambiguous shared email, or conflicting identity details", () => {
    expect(() => planPaidRegistrationMerge({ team, registration: registration(), payer: contact("stranger", "other@example.test"), other: registration() })).toThrow("Payer");
    const shared = registration();
    shared.customFields!.find(f => f.id === FIELD.emailTwo)!.value = "captain@example.test";
    expect(() => planPaidRegistrationMerge({ team, registration: shared, payer: payer(), other: shared })).toThrow("distinct");
    expect(() => planPaidRegistrationMerge({ team, registration: registration(), payer: { ...payer(), phone: "+97466999999" }, other: registration() })).toThrow("phone");
    expect(() => planPaidRegistrationMerge({ team, registration: registration(), payer: { ...payer(), dateOfBirth: "1999-01-01" }, other: registration() })).toThrow("birth");
  });
});
