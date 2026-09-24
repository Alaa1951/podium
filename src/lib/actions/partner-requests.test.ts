/**
 * Asking, and answering.
 *
 * Two properties carry the weight here: only the person asked can answer (the
 * authorisation lives in the `where` of the statement that writes), and two
 * people accepting at the same instant cannot both win.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  requireRole: vi.fn(),
  can: vi.fn(),
  rate: vi.fn(),
  findProfile: vi.fn(),
  countRequests: vi.fn(),
  findRequest: vi.fn(),
  createRequest: vi.fn(),
  updateRequests: vi.fn(),
  updateProfiles: vi.fn(),
  transaction: vi.fn(),
  linkPair: vi.fn(),
  candidateExists: vi.fn(),
  email: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireRole: mocks.requireRole, can: mocks.can }));
vi.mock("@/lib/rate-limit", () => ({ checkRate: mocks.rate, MINUTE_MS: 60_000 }));
vi.mock("@/lib/partners", () => ({ linkPair: mocks.linkPair }));
vi.mock("@/lib/partner-directory", () => ({ partnerCandidateExists: mocks.candidateExists }));
vi.mock("@/lib/email", () => ({ sendPartnerRequestEmail: mocks.email }));
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.audit,
  AUDIT: {
    partnerRequestSent: "partner.request_sent",
    partnerRequestAccepted: "partner.request_accepted",
    partnerRequestDeclined: "partner.request_declined",
    partnerRequestWithdrawn: "partner.request_withdrawn",
  },
}));
vi.mock("@/lib/security", () => ({ getBaseUrl: () => "https://podium.test" }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    seriesParticipant: { findUnique: mocks.findProfile, updateMany: mocks.updateProfiles },
    partnerRequest: {
      count: mocks.countRequests,
      findFirst: mocks.findRequest,
      create: mocks.createRequest,
      updateMany: mocks.updateRequests,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/participation", () => ({ resolveMySeries: mocks.resolve, meHref: (id: string, suffix = "") => `/me${suffix}?series=${id}` }));
vi.mock("@/lib/enter-pair", () => ({ enterPairIfReady: async () => ({ entered: false }) }));
vi.mock("@/lib/revalidate-competition", () => ({ revalidateCompetitionViews: vi.fn() }));

import {
  acceptPartnerRequest,
  declinePartnerRequest,
  sendPartnerRequest,
  withdrawPartnerRequest,
} from "@/lib/actions/partner-requests";

const me = { id: "me", email: "me@example.com", name: "Sara", role: "competitor" };
const myProfile = { division: "Open", category: "Womens", partnerUserId: null };
const theirProfile = {
  division: "Open",
  category: "Womens",
  user: { email: "mona@example.com", name: "Mona" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue({ id: "s1", status: "scheduled" });
  mocks.requireRole.mockResolvedValue(me);
  mocks.can.mockReturnValue(true);
  mocks.rate.mockReturnValue({ ok: true });
  mocks.countRequests.mockResolvedValue(0);
  mocks.findRequest.mockResolvedValue(null);
  mocks.candidateExists.mockResolvedValue(true);
  mocks.createRequest.mockResolvedValue({ id: "r1" });
  mocks.updateRequests.mockResolvedValue({ count: 1 });
  mocks.updateProfiles.mockResolvedValue({ count: 1 });
  mocks.audit.mockResolvedValue(undefined);
  mocks.email.mockResolvedValue(undefined);
  mocks.findProfile.mockImplementation(async ({ where }: { where: { seriesId_userId: { userId: string } } }) =>
    where.seriesId_userId.userId === "me" ? myProfile : theirProfile
  );
});

describe("asking somebody", () => {
  it("records the ask with a symmetric pair key and tells them", async () => {
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({ ok: true });

    const data = mocks.createRequest.mock.calls[0][0].data;
    expect(data).toMatchObject({ fromUserId: "me", toUserId: "them", division: "Open" });
    // Sorted, so the pair reads the same whichever way round the asking went.
    expect(data.pairKey).toBe("me:them");
    expect(data.openPairKey).toBe(data.pairKey);

    expect(mocks.email).toHaveBeenCalledWith(
      expect.objectContaining({ email: "mona@example.com", fromName: "Sara" })
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "partner.request_sent", targetId: "them" })
    );
  });

  it("stands even when the email does not go out", async () => {
    mocks.email.mockRejectedValue(new Error("SMTP down"));
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({ ok: true });
    expect(mocks.audit).toHaveBeenCalled();
  });

  it("refuses an admin looking through somebody else's eyes", async () => {
    mocks.requireRole.mockResolvedValue({ ...me, viewAs: { byAdminId: "boss" } });
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it("refuses without the permission", async () => {
    mocks.can.mockReturnValue(false);
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("refuses asking yourself", async () => {
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "me" })).toEqual({ ok: false, error: "INVALID_INPUT" });
  });

  it("throttles the sender and the recipient independently", async () => {
    mocks.rate.mockReturnValueOnce({ ok: false });
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({ ok: false, error: "TRY_LATER" });

    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(me);
    mocks.can.mockReturnValue(true);
    mocks.rate.mockReturnValueOnce({ ok: true }).mockReturnValueOnce({ ok: false });
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({ ok: false, error: "TRY_LATER" });
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it("needs a level and a category before it can ask anyone", async () => {
    mocks.findProfile.mockResolvedValue({ division: null, category: null, partnerUserId: null });
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({
      ok: false,
      error: "PROFILE_INCOMPLETE",
    });
  });

  it("refuses once this athlete already has a partner", async () => {
    mocks.findProfile.mockResolvedValue({ ...myProfile, partnerUserId: "someone" });
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({
      ok: false,
      error: "ALREADY_LINKED",
    });
  });

  it("caps how many asks may be outstanding", async () => {
    mocks.countRequests.mockResolvedValue(5);
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({
      ok: false,
      error: "TOO_MANY_PENDING",
    });
  });

  it("will not let me ask again after they said no", async () => {
    mocks.findRequest.mockResolvedValue({ id: "old" });
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({
      ok: false,
      error: "DECLINED_BEFORE",
    });
    expect(mocks.findRequest.mock.calls[0][0].where).toMatchObject({
      fromUserId: "me",
      toUserId: "them",
      status: "declined",
    });
  });

  it("refuses an id that is not a candidate, however it was learned", async () => {
    mocks.candidateExists.mockResolvedValue(false);
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "stranger" })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(mocks.createRequest).not.toHaveBeenCalled();
  });

  it("tells the two directions of an open request apart", async () => {
    mocks.createRequest.mockRejectedValue(new Error("Unique constraint failed"));

    mocks.findRequest.mockResolvedValueOnce(null).mockResolvedValueOnce({ fromUserId: "me" });
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({
      ok: false,
      error: "ALREADY_REQUESTED",
    });

    mocks.findRequest.mockResolvedValueOnce(null).mockResolvedValueOnce({ fromUserId: "them" });
    expect(await sendPartnerRequest({ seriesId: "s1", toUserId: "them" })).toEqual({
      ok: false,
      error: "THEY_ASKED_YOU",
    });
  });
});

describe("accepting", () => {
  /** Runs the transaction body against one tx client. */
  function runTx(tx: Record<string, unknown>) {
    mocks.transaction.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn(tx));
  }

  const request = { id: "r1", fromUserId: "them", toUserId: "me" };

  function txClient(over: Record<string, unknown> = {}) {
    return {
      $queryRaw: vi.fn(),
      partnerRequest: {
        findFirst: vi.fn().mockResolvedValue(request),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      competitor: { findFirst: vi.fn().mockResolvedValue(null) },
      seriesParticipant: { findMany: vi.fn().mockResolvedValue(["them", "me"].map(userId => ({ userId, division: "Open", category: "Womens", user: { status: "active", archivedAt: null, approvalStatus: "approved" } }))), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      ...over,
    };
  }

  it("links the two, on the same transaction client", async () => {
    const tx = txClient();
    runTx(tx);

    expect(await acceptPartnerRequest({ seriesId: "s1", requestId: "r1" })).toEqual({ ok: true });

    expect(mocks.linkPair).toHaveBeenCalledWith("them", "me", "s1", tx);
    // Both profiles claimed conditionally — this is the race guard.
    for (const call of tx.seriesParticipant.updateMany.mock.calls) {
      expect(call[0].where.partnerUserId).toBeNull();
    }
  });

  it("cancels every other open ask either of them had", async () => {
    const tx = txClient();
    runTx(tx);

    await acceptPartnerRequest({ seriesId: "s1", requestId: "r1" });

    const cancel = tx.partnerRequest.updateMany.mock.calls.at(-1)![0];
    expect(cancel.where).toMatchObject({ status: "pending", id: { not: "r1" } });
    expect(cancel.where.OR).toEqual([
      { fromUserId: { in: ["them", "me"] } },
      { toUserId: { in: ["them", "me"] } },
    ]);
    expect(cancel.data.status).toBe("cancelled");
  });

  it("refuses a request addressed to somebody else", async () => {
    const tx = txClient({
      partnerRequest: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
    });
    runTx(tx);

    expect(await acceptPartnerRequest({ seriesId: "s1", requestId: "r1" })).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(mocks.linkPair).not.toHaveBeenCalled();
    // The recipient's own id is in the where — that IS the authorisation.
    expect(tx.partnerRequest.findFirst.mock.calls[0][0].where.toUserId).toBe("me");
  });

  it("lets only the first of two simultaneous answers through", async () => {
    const tx = txClient({
      partnerRequest: {
        findFirst: vi.fn().mockResolvedValue(request),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    runTx(tx);

    expect(await acceptPartnerRequest({ seriesId: "s1", requestId: "r1" })).toEqual({
      ok: false,
      error: "ALREADY_DECIDED",
    });
    expect(mocks.linkPair).not.toHaveBeenCalled();
  });

  it("refuses when either side got partnered a moment earlier", async () => {
    const tx = txClient({
      seriesParticipant: { findMany: vi.fn().mockResolvedValue(["them", "me"].map(userId => ({ userId, division: "Open", category: "Womens", user: { status: "active", approvalStatus: "approved" } }))), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    });
    runTx(tx);

    expect(await acceptPartnerRequest({ seriesId: "s1", requestId: "r1" })).toEqual({
      ok: false,
      error: "ALREADY_LINKED",
    });
    expect(mocks.linkPair).not.toHaveBeenCalled();
  });
});

describe("declining and withdrawing", () => {
  it("only the person asked may decline", async () => {
    expect(await declinePartnerRequest({ seriesId: "s1", requestId: "r1" })).toEqual({ ok: true });
    expect(mocks.updateRequests.mock.calls[0][0].where).toMatchObject({
      id: "r1",
      toUserId: "me",
      status: "pending",
    });
  });

  it("only the asker may withdraw", async () => {
    expect(await withdrawPartnerRequest({ seriesId: "s1", requestId: "r1" })).toEqual({ ok: true });
    expect(mocks.updateRequests.mock.calls[0][0].where).toMatchObject({
      id: "r1",
      fromUserId: "me",
      status: "pending",
    });
  });

  it("answering twice changes nothing the second time", async () => {
    mocks.updateRequests.mockResolvedValue({ count: 0 });
    expect(await declinePartnerRequest({ seriesId: "s1", requestId: "r1" })).toEqual({
      ok: false,
      error: "ALREADY_DECIDED",
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
