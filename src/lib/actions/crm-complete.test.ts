/**
 * Finishing a held registration, from the action's side.
 *
 * `complete.test.ts` pins the rules about what may be written. This pins what
 * the action does around them, and three of these tests exist because getting
 * them wrong would be expensive rather than merely untidy:
 *
 *   IT NEVER CREATES THE TEAM ITSELF. The sync does, from the CRM. If this
 *   action ever starts writing a team, PODIUM holds a registration the record
 *   has never heard of, and every future poll has to be taught to leave it be.
 *
 *   IT BELIEVES NOTHING IT HAS NOT READ BACK. The write body's shape cannot be
 *   proved by any probe, so a write that stored nothing must report failure.
 *
 *   IT WRITES THE FIELDS BEFORE IT MOVES THE STAGE. The other order can file
 *   somebody as "registered" with nothing in their record.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  findIntake: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  runSync: vi.fn(),
  enabled: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireAccess: mocks.requireAccess }));
vi.mock("@/lib/prisma", () => ({ prisma: { crmIntake: { findFirst: mocks.findIntake } } }));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.audit,
  AUDIT: { crmRegistrationCompleted: "crm.registration_completed" },
}));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: mocks.revalidate }));
vi.mock("@/lib/crm/sync", () => ({ runSync: mocks.runSync, crmSyncEnabled: mocks.enabled }));

import { completeCrmRegistration } from "@/lib/actions/crm-complete";
import { FIELD } from "@/lib/crm/field-map";
import type { CrmClient } from "@/lib/crm/client";

const staff = { id: "admin-1", role: "admin", studioId: null, email: "hq@example.com" };

const OPTIONS = [
  { id: FIELD.category, name: "Category", dataType: "MULTIPLE_OPTIONS", options: ["MEN", "WOMEN", "MIXED"] },
  { id: FIELD.division, name: "Division", dataType: "MULTIPLE_OPTIONS", options: ["ROOKIE", "OPEN", "PRO"] },
  { id: FIELD.havePartner, name: "have_partner", dataType: "RADIO", options: ["Yes", "No - Looking for a partner"] },
];

const PIPELINES = [
  {
    id: "pipe-1",
    name: "Podium Series 1",
    stages: [
      { id: "s-paid-reg", name: "Paid – Registered" },
      { id: "s-paid-not", name: "Paid – Not Registered" },
    ],
  },
];

/** A client that stores what it is given, and reads it back the way GHL does. */
function fakeClient(over: Partial<CrmClient> = {}) {
  const order: string[] = [];
  const stored = new Map<string, string | string[]>();
  const client = {
    listCustomFields: vi.fn(async () => OPTIONS),
    listPipelines: vi.fn(async () => PIPELINES),
    listOpportunities: vi.fn(async () => [
      { id: "opp-1", contactId: "contact-1", pipelineId: "pipe-1", pipelineStageId: "s-paid-not", status: "open" },
    ]),
    listContacts: vi.fn(async () => []),
    listCustomFieldIds: vi.fn(async () => []),
    updateContactFields: vi.fn(async (_id: string, fields: { id: string; value: string | string[] }[]) => {
      order.push("write");
      for (const field of fields) stored.set(field.id, field.value);
    }),
    moveOpportunityStage: vi.fn(async () => {
      order.push("stage");
    }),
    getContact: vi.fn(async () => ({
      id: "contact-1",
      customFields: [...stored.entries()].map(([id, value]) => ({ id, value })),
    })),
    ...over,
  } as unknown as CrmClient;
  return { client, order, stored };
}

const INPUT = {
  intakeId: "intake-1",
  seriesId: "series-1",
  category: "Mens" as const,
  division: "Open" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAccess.mockResolvedValue(staff);
  mocks.enabled.mockReturnValue(true);
  mocks.findIntake.mockResolvedValue({
    id: "intake-1",
    externalId: "contact-1",
    contactName: "Abdulla Al-mazroey",
  });
  mocks.runSync.mockResolvedValue({ ok: true, created: 1, updated: 0, waiting: 0, skipped: 0 });
});

describe("the guards", () => {
  it("refuses somebody looking through another account's eyes", async () => {
    mocks.requireAccess.mockResolvedValue({ ...staff, viewAs: "studio-1" });
    const { client } = fakeClient();
    expect(await completeCrmRegistration(INPUT, client)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(client.updateContactFields).not.toHaveBeenCalled();
  });

  // The work list carries contact details for people who have not finished
  // registering. That is BFT MENA's, not a studio's, and the screen that shows
  // it is gated the same way.
  it("refuses a studio, whatever permissions it was given", async () => {
    mocks.requireAccess.mockResolvedValue({ ...staff, role: "studio_owner", studioId: "s1" });
    const { client } = fakeClient();
    expect(await completeCrmRegistration(INPUT, client)).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  // With no poller, nothing comes back — so the promise made to whoever pressed
  // the button ("this becomes a team") could not be kept.
  it("refuses while the sync is switched off", async () => {
    mocks.enabled.mockReturnValue(false);
    const { client } = fakeClient();
    expect(await completeCrmRegistration(INPUT, client)).toEqual({ ok: false, error: "DISABLED" });
  });

  it("will not write to a record belonging to another competition", async () => {
    mocks.findIntake.mockResolvedValue(null);
    const { client } = fakeClient();
    expect(await completeCrmRegistration(INPUT, client)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(client.updateContactFields).not.toHaveBeenCalled();
    // Scoped in the query itself rather than checked afterwards.
    expect(mocks.findIntake).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "intake-1", seriesId: "series-1" } })
    );
  });

  it("does not call the CRM at all when there is nothing to write", async () => {
    const { client } = fakeClient();
    const result = await completeCrmRegistration(
      { intakeId: "intake-1", seriesId: "series-1" },
      client
    );
    expect(result).toEqual({ ok: false, error: "NOTHING_TO_WRITE" });
    expect(client.updateContactFields).not.toHaveBeenCalled();
  });
});

describe("the write", () => {
  it("writes the missing answers and moves the stage, in that order", async () => {
    const { client, order, stored } = fakeClient();
    const result = await completeCrmRegistration(INPUT, client);

    expect(result.ok).toBe(true);
    expect(stored.get(FIELD.category)).toEqual(["MEN"]);
    expect(stored.get(FIELD.division)).toEqual(["OPEN"]);
    // Fields first. The other order files somebody as registered with an empty
    // record, and a failure halfway would leave exactly that.
    expect(order).toEqual(["write", "stage"]);
    expect(client.moveOpportunityStage).toHaveBeenCalledWith("opp-1", "pipe-1", "s-paid-reg");
  });

  // 🔴 The team is the SYNC's to create, from the CRM. Nothing here writes one.
  it("never creates the team itself — it asks the sync to", async () => {
    const { client } = fakeClient();
    await completeCrmRegistration(INPUT, client);
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
  });

  it("says so plainly when the sync made them a team", async () => {
    const { client } = fakeClient();
    const result = await completeCrmRegistration(INPUT, client);
    expect(result.ok && result.message).toMatch(/team now/i);
  });

  // A poll already running is not a failure: the record is in the CRM, and the
  // next poll finds it. Saying "failed" here would send staff back to redo a
  // write that already landed.
  it("treats a busy sync as a wait, not a failure", async () => {
    mocks.runSync.mockResolvedValue({ ok: false, busy: true, created: 0, updated: 0, waiting: 0, skipped: 0 });
    const { client } = fakeClient();
    const result = await completeCrmRegistration(INPUT, client);
    expect(result.ok).toBe(true);
    expect(result.ok && result.message).toMatch(/next one/i);
  });

  it("reports what it could not write instead of letting it pass unsaid", async () => {
    const narrowed = [
      { ...OPTIONS[0] },
      { ...OPTIONS[1], options: ["OPEN", "PRO"] },
      { ...OPTIONS[2] },
    ];
    const { client } = fakeClient({ listCustomFields: vi.fn(async () => narrowed) });
    const result = await completeCrmRegistration(
      { ...INPUT, division: "Rookie" },
      client
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.message).toMatch(/Could not write: division/);
  });
});

describe("the read-back", () => {
  // The shape of a GHL write body cannot be proved by a probe — the API
  // resolves the record before it validates the body, so a wrong shape and a
  // right one both come back the same. This is the only proof there is.
  it("fails when the CRM stored nothing, rather than reporting success", async () => {
    const { client } = fakeClient({
      updateContactFields: vi.fn(async () => {}), // accepted, stored nothing
    });
    expect(await completeCrmRegistration(INPUT, client)).toEqual({
      ok: false,
      error: "NOT_READ_BACK",
    });
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it("fails when the contact cannot be read back at all", async () => {
    const { client } = fakeClient({ getContact: vi.fn(async () => null) });
    expect(await completeCrmRegistration(INPUT, client)).toEqual({
      ok: false,
      error: "NOT_READ_BACK",
    });
  });

  // Checked THROUGH the sync's own reader, so this proves the round trip and
  // not merely that a string was stored somewhere.
  it("fails when what came back does not mean what was sent", async () => {
    const { client } = fakeClient({
      getContact: vi.fn(async () => ({
        id: "contact-1",
        customFields: [{ id: FIELD.category, value: ["MENS"] }, { id: FIELD.division, value: ["OPEN"] }],
      })),
    });
    expect(await completeCrmRegistration(INPUT, client)).toEqual({
      ok: false,
      error: "NOT_READ_BACK",
    });
  });
});

describe("failures", () => {
  it("never lets a CRM error carry the body it sent", async () => {
    const { client } = fakeClient({
      updateContactFields: vi.fn(async () => {
        throw new Error("422 rejected: {\"email\":\"someone@example.com\"}");
      }),
    });
    const result = await completeCrmRegistration(INPUT, client);
    expect(result).toEqual({ ok: false, error: "CRM_FAILED" });
    expect(JSON.stringify(result)).not.toMatch(/someone@example.com/);
  });

  it("does not move the stage when the fields never landed", async () => {
    const { client } = fakeClient({
      updateContactFields: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    await completeCrmRegistration(INPUT, client);
    expect(client.moveOpportunityStage).not.toHaveBeenCalled();
  });

  // A record with no opportunity has no stage to move. The fields are still
  // worth writing — they are what makes it a team.
  it("writes the fields even when there is no opportunity to move", async () => {
    const { client } = fakeClient({ listOpportunities: vi.fn(async () => []) });
    const result = await completeCrmRegistration(INPUT, client);
    expect(result.ok).toBe(true);
    expect(client.updateContactFields).toHaveBeenCalled();
    expect(client.moveOpportunityStage).not.toHaveBeenCalled();
  });
});
