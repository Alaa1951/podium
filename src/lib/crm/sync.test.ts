/**
 * One poll of the CRM.
 *
 * The claim is what these tests are really about. A fifteen-minute timer and a
 * Sync now button that a person presses during an event will eventually fire
 * at the same instant, and two polls working the same eighty-five records at
 * once is how a team gets created twice or a payment written twice. The guard
 * is a conditional UPDATE — the same idiom that starts a wave once — and the
 * concurrency test below is the only thing that proves it still works.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// `@/lib/revalidate-competition` is DELIBERATELY NOT MOCKED. `revalidatePath`
// throws outside a request, which is where a timer lives — and when `runSync`
// called it, the throw landed inside its try and turned a poll that had
// already written fifty-five teams into a reported failure. Leaving the real
// module in place means re-adding that call makes these tests fail, which is
// the only way the mistake announces itself.

const { claimSync, releaseSync, runSync, startCrmPoller, crmSyncEnabled } = await import("@/lib/crm/sync");

/**
 * A stand-in for the one `CrmSyncState` row whose `updateMany` honours its
 * WHERE — which is the whole point, since the claim IS the where clause.
 */
function fakeDb(overrides: Record<string, unknown> = {}) {
  const state = {
    id: "singleton",
    running: false,
    claimedAt: null as Date | null,
    lastCreated: 0,
    lastUpdated: 0,
    lastSkipped: 0,
    lastError: null as string | null,
    lastSuccessAt: null as Date | null,
  };

  return {
    state,
    crmSyncState: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.id !== state.id) return { count: 0 };
        if (Array.isArray(where.OR)) {
          const cutoff = (where.OR[1] as { claimedAt?: { lt: Date } })?.claimedAt?.lt;
          const free = state.running === false;
          const stale = Boolean(cutoff && state.claimedAt && state.claimedAt < cutoff);
          if (!free && !stale) return { count: 0 };
        }
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) (state as Record<string, unknown>)[key] = value;
        }
        return { count: 1 };
      }),
    },
    series: { findUnique: vi.fn(async () => ({ id: "series-1" })) },
    competitor: { findFirst: vi.fn(async (): Promise<object | null> => null) },
    crmIntake: { upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) },
    studio: {
      findMany: vi.fn(async (): Promise<{ id: string; name: string }[]> => []),
      create: vi.fn(async (): Promise<{ id: string }> => ({ id: "st-new" })),
      findUnique: vi.fn(async (): Promise<{ id: string } | null> => null),
    },
    team: {
      findMany: vi.fn(async () => []),
      // `nextTeamNumber` reads the highest number through this one.
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async (): Promise<object | null> => null),
      create: vi.fn(async () => ({ id: "t", number: 101, name: "X" })),
    },
    ...overrides,
  };
}

/** A CRM with nothing in it — enough to let a poll run to the end. */
function emptyClient() {
  return {
    listCustomFieldIds: vi.fn(async () => Object.values((await import("@/lib/crm/field-map")).FIELD)),
    listPipelines: vi.fn(async () => []),
    listContacts: vi.fn(async () => []),
    listOpportunities: vi.fn(async () => []),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CRM_SYNC_SERIES = "podium-bft-series-1";
  delete process.env.CRM_SYNC_ENABLED;
  delete process.env.CRM_SYNC_DRY_RUN;
});

describe("the switch", () => {
  // Absent means OFF, exactly like PORTRAITS_ENABLED. "true", "yes" and "1 "
  // are all somebody being approximate about turning on a live integration.
  it("is off unless it is exactly \"1\"", () => {
    expect(crmSyncEnabled()).toBe(false);
    process.env.CRM_SYNC_ENABLED = "true";
    expect(crmSyncEnabled()).toBe(false);
    process.env.CRM_SYNC_ENABLED = "1";
    expect(crmSyncEnabled()).toBe(true);
  });
});

describe("the claim", () => {
  it("is taken when nothing holds it", async () => {
    const db = fakeDb();
    await expect(claimSync(db as never, new Date())).resolves.toBe(true);
    expect(db.state.running).toBe(true);
  });

  // THE ONE THAT MATTERS. The timer and the button, at the same instant.
  it("is taken by exactly one of two overlapping polls", async () => {
    const db = fakeDb();
    const now = new Date();
    const results = await Promise.all([
      claimSync(db as never, now),
      claimSync(db as never, now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  // A process killed mid-poll would otherwise hold the claim for good and
  // lock the sync out permanently, with nothing to say why.
  it("is taken from a poll that died holding it", async () => {
    const db = fakeDb();
    const start = new Date("2026-09-22T10:00:00Z");
    await claimSync(db as never, start);
    expect(db.state.running).toBe(true);

    const soon = new Date("2026-09-22T10:05:00Z");
    await expect(claimSync(db as never, soon)).resolves.toBe(false);

    const muchLater = new Date("2026-09-22T11:00:00Z");
    await expect(claimSync(db as never, muchLater)).resolves.toBe(true);
  });

  it("is given back with what the poll did", async () => {
    const db = fakeDb();
    await claimSync(db as never, new Date());
    await releaseSync(db as never, new Date(), {
      ok: true,
      created: 54,
      updated: 2,
      waiting: 31,
      skipped: 0,
      reasons: {},
    });
    expect(db.state.running).toBe(false);
    expect(db.state.claimedAt).toBeNull();
    expect(db.state).toMatchObject({ lastCreated: 54, lastUpdated: 2, lastWaiting: 31, lastError: null });
  });
});

describe("runSync", () => {
  it("refuses without a target competition rather than guessing one", async () => {
    delete process.env.CRM_SYNC_SERIES;
    const result = await runSync({ prisma: fakeDb() as never, client: emptyClient() as never });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("CRM_SYNC_SERIES");
  });

  it("refuses when the named competition does not exist", async () => {
    const db = fakeDb({ series: { findUnique: vi.fn(async () => null) } });
    const result = await runSync({ prisma: db as never, client: emptyClient() as never });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("podium-bft-series-1");
  });

  // Busy is not a failure — it is the guard working. Reporting it as an error
  // would fill the log with alarms every time somebody pressed the button.
  it("reports busy, not failure, when another poll holds the claim", async () => {
    const db = fakeDb();
    await claimSync(db as never, new Date());
    const result = await runSync({ prisma: db as never, client: emptyClient() as never });
    expect(result).toMatchObject({ ok: true, busy: true, created: 0, updated: 0 });
  });

  it("gives the claim back even when the CRM call fails", async () => {
    const db = fakeDb();
    const angry = {
      ...emptyClient(),
      listContacts: vi.fn(async () => {
        throw new Error("CRM request failed: HTTP 503.");
      }),
    };
    const result = await runSync({ prisma: db as never, client: angry as never });
    expect(result.ok).toBe(false);
    // Released, or the next poll and every poll after it would find it busy.
    expect(db.state.running).toBe(false);
    expect(db.state.lastError).toContain("503");
  });

  // A dry run must be safe to point at production, which means it takes no
  // claim at all — it cannot collide with anything because it changes nothing.
  it("takes no claim and writes nothing in a dry run", async () => {
    const db = fakeDb();
    const result = await runSync({
      prisma: db as never,
      client: emptyClient() as never,
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(db.state.running).toBe(false);
    expect(db.crmSyncState.updateMany).not.toHaveBeenCalled();
    expect(db.team.create).not.toHaveBeenCalled();
  });

  // THE REGRESSION. A poll that does real work has to REPORT that it worked.
  // The first version wrote every team and then reported failure, because it
  // refreshed the page cache from a timer that has no request to refresh.
  it("reports success after a poll that actually created something", async () => {
    const { FIELD } = await import("@/lib/crm/field-map");
    const db = fakeDb();
    const client = {
      ...emptyClient(),
      listPipelines: vi.fn(async () => [
        { id: "p1", name: "Podium Series 1", stages: [{ id: "s1", name: "Paid – Registered" }] },
      ]),
      listContacts: vi.fn(async () => [
        {
          id: "c1",
          contactName: "Sample Person",
          customFields: [
            { id: FIELD.category, value: ["MEN"] },
            { id: FIELD.division, value: ["OPEN"] },
          ],
        },
      ]),
      listOpportunities: vi.fn(async () => [
        { id: "o1", contactId: "c1", pipelineId: "p1", pipelineStageId: "s1", status: "open" },
      ]),
    };

    const result = await runSync({ prisma: db as never, client: client as never });

    expect(result).toMatchObject({ ok: true, created: 1 });
    expect(db.team.create).toHaveBeenCalled();
    // And the claim came back, with the success recorded against it.
    expect(db.state.running).toBe(false);
    expect(db.state.lastError).toBeNull();
    expect(db.state.lastCreated).toBe(1);
  });

  // A pair from a studio PODIUM has not heard of must not lose their
  // membership. `approveSignup` already founds a studio the same way for a
  // self-registered athlete, so this is the established rule, not a new one.
  it("founds a studio it has never heard of, and reuses one it has", async () => {
    const { FIELD } = await import("@/lib/crm/field-map");
    const db = fakeDb();
    db.studio.findMany.mockResolvedValue([{ id: "st-pearl", name: "The Pearl" }]);

    const client = {
      ...emptyClient(),
      listPipelines: vi.fn(async () => [
        { id: "p1", name: "Podium Series 1", stages: [{ id: "s1", name: "Paid – Registered" }] },
      ]),
      listContacts: vi.fn(async () => [
        {
          id: "c1",
          contactName: "Sample Person",
          customFields: [
            { id: FIELD.category, value: ["MEN"] },
            { id: FIELD.division, value: ["OPEN"] },
            { id: FIELD.nameTwo, value: "Second Person" },
            // One from a studio we know, one from a studio we do not.
            { id: FIELD.studioOne, value: ["BFT The Pearl"] },
            { id: FIELD.studioTwo, value: ["BFT Lusail"] },
          ],
        },
      ]),
      listOpportunities: vi.fn(async () => [
        { id: "o1", contactId: "c1", pipelineId: "p1", pipelineStageId: "s1", status: "open" },
      ]),
    };

    const result = await runSync({ prisma: db as never, client: client as never });
    expect(result).toMatchObject({ ok: true, created: 1 });

    // The known one was reused — founding it again would be a duplicate under
    // a different id, and the unique index is the only thing that would say so.
    expect(db.studio.create).toHaveBeenCalledTimes(1);
    expect(db.studio.create).toHaveBeenCalledWith({
      data: { name: "Lusail" },
      select: { id: true },
    });

    const seats = (db.team.create.mock.calls[0] as unknown as [{ data: { competitors: { create: { studioId: string | null }[] } } }])[0].data.competitors.create;
    expect(seats[0].studioId).toBe("st-pearl");
    expect(seats[1].studioId).toBe("st-new");
  });

  // EVERY custom field survives, not just the sixteen this code reads. Two
  // are unmapped today and BFT MENA adds to that form; without the snapshot
  // they would be read, ignored, and gone.
  it("keeps the whole CRM contact, including the fields it does not read", async () => {
    const { FIELD } = await import("@/lib/crm/field-map");
    const db = fakeDb();
    const contact = {
      id: "c1",
      contactName: "Sample Person",
      customFields: [
        { id: FIELD.category, value: ["MEN"] },
        { id: FIELD.division, value: ["OPEN"] },
        // Neither of these is mapped to a column anywhere.
        { id: FIELD.genderOne, value: "Male" },
        { id: FIELD.havePartner, value: "Yes" },
      ],
    };
    const client = {
      ...emptyClient(),
      listPipelines: vi.fn(async () => [
        { id: "p1", name: "Podium Series 1", stages: [{ id: "s1", name: "Paid – Registered" }] },
      ]),
      listContacts: vi.fn(async () => [contact]),
      listOpportunities: vi.fn(async () => [
        { id: "o1", contactId: "c1", pipelineId: "p1", pipelineStageId: "s1", status: "open" },
      ]),
    };

    await runSync({ prisma: db as never, client: client as never });

    const written = (db.team.create.mock.calls[0] as unknown as [{ data: { rawPayload: unknown } }])[0].data.rawPayload;
    expect(written).toEqual(contact);
  });

  // ADOPTION. A pair who signed themselves up already has a team, with no
  // externalId — so the unique index saw no collision and this used to make a
  // SECOND one. Two rows for two people is invisible until payment lands, and
  // then it is two lines on the board and every report figure doubled.
  it("adopts a team the same pair already has instead of making another", async () => {
    const { FIELD } = await import("@/lib/crm/field-map");
    const db = fakeDb();
    db.competitor.findFirst.mockResolvedValue({
      id: "c1",
      teamId: "signup-team",
      email: "one@example.com",
      userId: "u1",
    });
    db.team.findUnique.mockResolvedValue({
      id: "signup-team",
      externalId: null,
      competitors: [{ email: "one@example.com" }, { email: "two@example.com" }],
    });

    const client = {
      ...emptyClient(),
      listPipelines: vi.fn(async () => [
        { id: "p1", name: "Podium Series 1", stages: [{ id: "s1", name: "Paid – Registered" }] },
      ]),
      listContacts: vi.fn(async () => [
        {
          id: "crm-1",
          contactName: "One Person",
          email: "One@Example.com",
          customFields: [
            { id: FIELD.category, value: ["MEN"] },
            { id: FIELD.division, value: ["OPEN"] },
            { id: FIELD.nameTwo, value: "Two Person" },
            { id: FIELD.emailTwo, value: "Two@Example.com" },
          ],
        },
      ]),
      listOpportunities: vi.fn(async () => [
        { id: "o1", contactId: "crm-1", pipelineId: "p1", pipelineStageId: "s1", status: "open" },
      ]),
    };

    const result = await runSync({ prisma: db as never, client: client as never });

    expect(result).toMatchObject({ ok: true, created: 0, updated: 1 });
    expect(db.team.create).not.toHaveBeenCalled();
    // The existing team becomes the CRM's, money and all.
    expect(db.team.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "signup-team" },
        data: expect.objectContaining({
          externalId: "crm-1",
          source: "ghl",
          paymentStatus: "paid",
        }),
      })
    );
  });

  // One matching email means the PARTNER changed, and which pair is the real
  // entry is a person's decision. A poll must not pick — and must not make a
  // second team either.
  it("refuses to adopt or duplicate when only one person matches", async () => {
    const { FIELD } = await import("@/lib/crm/field-map");
    const db = fakeDb();
    db.competitor.findFirst.mockResolvedValue({
      id: "c1",
      teamId: "signup-team",
      email: "one@example.com",
      userId: "u1",
    });
    db.team.findUnique.mockResolvedValue({
      id: "signup-team",
      externalId: null,
      competitors: [{ email: "one@example.com" }, { email: "somebody-else@example.com" }],
    });

    const client = {
      ...emptyClient(),
      listPipelines: vi.fn(async () => [
        { id: "p1", name: "Podium Series 1", stages: [{ id: "s1", name: "Paid – Registered" }] },
      ]),
      listContacts: vi.fn(async () => [
        {
          id: "crm-1",
          contactName: "One Person",
          email: "one@example.com",
          customFields: [
            { id: FIELD.category, value: ["MEN"] },
            { id: FIELD.division, value: ["OPEN"] },
            { id: FIELD.nameTwo, value: "Two Person" },
            { id: FIELD.emailTwo, value: "two@example.com" },
          ],
        },
      ]),
      listOpportunities: vi.fn(async () => [
        { id: "o1", contactId: "crm-1", pipelineId: "p1", pipelineStageId: "s1", status: "open" },
      ]),
    };

    const result = await runSync({ prisma: db as never, client: client as never });

    expect(result).toMatchObject({ ok: true, created: 0, updated: 0 });
    expect(db.team.create).not.toHaveBeenCalled();
    expect(db.team.update).not.toHaveBeenCalled();
  });

  // An unfinished registration is still somebody who paid and expects to
  // compete. It is held where staff can see and chase it, not dropped.
  it("holds an unfinished registration instead of dropping it", async () => {
    const { FIELD } = await import("@/lib/crm/field-map");
    const db = fakeDb();
    const client = {
      ...emptyClient(),
      listPipelines: vi.fn(async () => [
        { id: "p1", name: "Podium Series 1", stages: [{ id: "s1", name: "Paid – Not Registered" }] },
      ]),
      listContacts: vi.fn(async () => [
        {
          id: "c1",
          contactName: "Unfinished Person",
          email: "chase@example.com",
          // No category and no division: the shape thirty-two real records
          // are in, and the shape that cannot become a team.
          customFields: [{ id: FIELD.teamName, value: "Half A Team" }],
        },
      ]),
      listOpportunities: vi.fn(async () => [
        { id: "o1", contactId: "c1", pipelineId: "p1", pipelineStageId: "s1", status: "open" },
      ]),
    };

    const result = await runSync({ prisma: db as never, client: client as never });

    expect(result).toMatchObject({ ok: true, created: 0, waiting: 1 });
    expect(db.team.create).not.toHaveBeenCalled();
    const upsert = db.crmIntake.upsert.mock.calls[0] as unknown as [{ create: object }];
    expect(upsert[0].create).toMatchObject({
      externalId: "c1",
      contactName: "Unfinished Person",
      email: "chase@example.com",
      teamName: "Half A Team",
      missing: "no category and no division",
    });
    // The snapshot is kept on a held row too: somebody who never finishes
    // their form is exactly the registration a dispute gets read back from.
    expect((upsert[0].create as { rawPayload: { id: string } }).rawPayload).toMatchObject({
      id: "c1",
    });
  });

  // THE WHOLE POINT OF HOLDING THEM. A held row is not a dead end: the moment
  // the CRM form gains its category and division, the next poll turns it into
  // a real team and the row goes. Nobody re-types anything.
  it("promotes a held registration as soon as the CRM finishes it", async () => {
    const { FIELD } = await import("@/lib/crm/field-map");
    const db = fakeDb();

    const base = {
      listCustomFieldIds: vi.fn(async () => Object.values(FIELD)),
      listPipelines: vi.fn(async () => [
        { id: "p1", name: "Podium Series 1", stages: [{ id: "s1", name: "Paid – Registered" }] },
      ]),
      listOpportunities: vi.fn(async () => [
        { id: "o1", contactId: "c1", pipelineId: "p1", pipelineStageId: "s1", status: "open" },
      ]),
    };
    const unfinished = {
      ...base,
      listContacts: vi.fn(async () => [{ id: "c1", contactName: "Sample Person", customFields: [] }]),
    };
    const finished = {
      ...base,
      listContacts: vi.fn(async () => [
        {
          id: "c1",
          contactName: "Sample Person",
          customFields: [
            { id: FIELD.category, value: ["MEN"] },
            { id: FIELD.division, value: ["OPEN"] },
          ],
        },
      ]),
    };

    const before = await runSync({ prisma: db as never, client: unfinished as never });
    expect(before).toMatchObject({ created: 0, waiting: 1 });
    expect(db.team.create).not.toHaveBeenCalled();

    const after = await runSync({ prisma: db as never, client: finished as never });
    expect(after).toMatchObject({ created: 1, waiting: 0 });
    expect(db.team.create).toHaveBeenCalledTimes(1);
    // And it stopped waiting: both the create's own cleanup and the mirror
    // sweep would remove it, and it must not survive either.
    expect(db.crmIntake.deleteMany).toHaveBeenCalledWith({
      where: { seriesId: "series-1", externalId: "c1" },
    });
  });

  // The table mirrors the CRM. Without this, a contact deleted there — or
  // finished by some path this poll did not see — sits on the chase list
  // forever and somebody rings a person who sorted themselves out weeks ago.
  it("clears held rows the CRM no longer has", async () => {
    const db = fakeDb();
    await runSync({ prisma: db as never, client: emptyClient() as never });
    expect(db.crmIntake.deleteMany).toHaveBeenCalledWith({
      where: { seriesId: "series-1", externalId: { notIn: [] } },
    });
  });

  // A REHEARSAL MUST NOT SOUND LIKE A WRITE. The dry run reports the counts a
  // real poll WOULD produce — that is what makes it useful — so the poller's
  // completion line once read "[CRM:poll] created 56" while nothing had been
  // written. It frightened the person watching the log, and worse: it meant
  // the real line afterwards proved nothing, because a rehearsal could say
  // the same words. Found by a human reading a live journal, not by a test.
  // It drives the POLLER, not `runSync` — the offending line lives in the
  // interval's completion callback, and a test that called `runSync` here
  // passed happily with the bug still in place.
  it("says nothing on the poll line during a dry run", async () => {
    const { FIELD } = await import("@/lib/crm/field-map");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers();
    let stop = () => {};
    try {
      // A dry run over a CRM with something in it. An EMPTY one plans zero
      // creates, and the offending line was guarded on the count being
      // non-zero — so an empty fixture never reached the bug and the first
      // version of this test passed with it still in place.
      const client = {
        ...emptyClient(),
        listPipelines: vi.fn(async () => [
          { id: "p1", name: "Podium Series 1", stages: [{ id: "s1", name: "Paid – Registered" }] },
        ]),
        listContacts: vi.fn(async () => [
          {
            id: "c1",
            contactName: "Sample Person",
            customFields: [
              { id: FIELD.category, value: ["MEN"] },
              { id: FIELD.division, value: ["OPEN"] },
            ],
          },
        ]),
        listOpportunities: vi.fn(async () => [
          { id: "o1", contactId: "c1", pipelineId: "p1", pipelineStageId: "s1", status: "open" },
        ]),
      };

      stop = startCrmPoller({
        prisma: fakeDb() as never,
        client: client as never,
        dryRun: true,
        pollMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(1000);

      const lines = info.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain("[CRM:dry-run]");
      expect(lines).not.toContain("[CRM:poll]");
    } finally {
      stop();
      vi.useRealTimers();
      info.mockRestore();
    }
  });

  // And the other half of the same property: a REAL poll that wrote something
  // must say so, or part C of a switch-on has no evidence at all.
  it("announces a real poll that created something", async () => {
    const { FIELD } = await import("@/lib/crm/field-map");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers();
    let stop = () => {};
    try {
      const client = {
        ...emptyClient(),
        listPipelines: vi.fn(async () => [
          { id: "p1", name: "Podium Series 1", stages: [{ id: "s1", name: "Paid – Registered" }] },
        ]),
        listContacts: vi.fn(async () => [
          {
            id: "c1",
            contactName: "Sample Person",
            customFields: [
              { id: FIELD.category, value: ["MEN"] },
              { id: FIELD.division, value: ["OPEN"] },
            ],
          },
        ]),
        listOpportunities: vi.fn(async () => [
          { id: "o1", contactId: "c1", pipelineId: "p1", pipelineStageId: "s1", status: "open" },
        ]),
      };

      stop = startCrmPoller({ prisma: fakeDb() as never, client: client as never, pollMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);

      const said = info.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(said).toContain("[CRM:poll]");
      expect(said).toContain("created 1");
      expect(said).not.toContain("[CRM:dry-run]");
    } finally {
      stop();
      vi.useRealTimers();
      info.mockRestore();
    }
  });

  // A field deleted or rebuilt in the CRM form reads as empty everywhere, and
  // the sync would go on writing that emptiness one poll at a time.
  it("stops before deciding anything when the field map no longer fits", async () => {
    const db = fakeDb();
    const renamed = { ...emptyClient(), listCustomFieldIds: vi.fn(async () => ["something-else"]) };
    const result = await runSync({ prisma: db as never, client: renamed as never });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing or renamed/);
    expect(db.team.create).not.toHaveBeenCalled();
    expect(db.state.running).toBe(false);
  });
});
