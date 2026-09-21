/**
 * Linking a pair, and unlinking them.
 *
 * The test that earns its place here is the symmetry one. `linkPair` writes
 * ten columns on both profiles; if `unlinkPair` ever clears nine of them, two
 * people who split keep each other's phone number and shirt size for ever and
 * the finder still hides them from each other. Nothing would throw, and it
 * would only ever surface as a support ticket — so the key sets are compared
 * directly, and adding an eleventh column to one side fails until it is added
 * to the other.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  updateProfile: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    athleteProfile: { update: mocks.updateProfile },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/email", () => ({ sendPartnerInviteEmail: vi.fn() }));
vi.mock("@/lib/security", () => ({
  getBaseUrl: () => "https://podium.test",
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
}));

import { linkPair, unlinkPair } from "@/lib/partners";

const person = (id: string) => ({
  name: `Name ${id}`,
  email: `${id}@example.com`,
  phone: "+97455500000",
  athleteProfile: { dateOfBirth: new Date("1995-01-01"), sex: "f", shirtSize: "M", bftMember: true },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUser.mockImplementation(async ({ where }: { where: { id: string } }) => person(where.id));
  mocks.updateProfile.mockImplementation((args: unknown) => args);
  mocks.transaction.mockResolvedValue([]);
});

/** The `data` payload of each of the two writes a call makes. */
function payloads(): Record<string, unknown>[] {
  // Both helpers go through prisma.$transaction with an array of update args
  // when they are given the default client.
  const batch = mocks.transaction.mock.calls[0][0] as { data: Record<string, unknown> }[];
  return batch.map((write) => write.data);
}

describe("the two are mirrors", () => {
  it("clears exactly what linking writes", async () => {
    await linkPair("a", "b");
    const linked = Object.keys(payloads()[0]).sort();

    vi.clearAllMocks();
    mocks.updateProfile.mockImplementation((args: unknown) => args);
    mocks.transaction.mockResolvedValue([]);

    await unlinkPair("a", "b");
    const cleared = Object.keys(payloads()[0]).sort();

    // `teamName` is cleared on the way out and never written on the way in —
    // what a pair competes as is settled when they are entered, not linked.
    expect(cleared).toEqual([...linked, "teamName"].sort());
  });
});

describe("linking", () => {
  it("gives each side the other's details, both ways", async () => {
    await linkPair("a", "b");
    const [first, second] = payloads();

    expect(first).toMatchObject({
      partnerUserId: "b",
      lookingForPartner: false,
      partnerEmail: "b@example.com",
      partnerSex: "f",
      partnerShirtSize: "M",
      partnerBftMember: true,
    });
    expect(second).toMatchObject({ partnerUserId: "a", partnerEmail: "a@example.com" });
  });

  it("does nothing when one of them is gone", async () => {
    mocks.findUser.mockResolvedValue(null);
    await linkPair("a", "b");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("runs on a caller's transaction when given one", async () => {
    const tx = { user: { findUnique: mocks.findUser }, athleteProfile: { update: vi.fn() } };
    await linkPair("a", "b", tx as never);
    expect(tx.athleteProfile.update).toHaveBeenCalledTimes(2);
    // Never its own transaction inside somebody else's — nesting is refused.
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("unlinking", () => {
  it("puts both of them back to looking, with nothing of the other left", async () => {
    await unlinkPair("a", "b");
    for (const data of payloads()) {
      expect(data).toMatchObject({
        partnerUserId: null,
        partnerLinkedAt: null,
        lookingForPartner: true,
        teamName: null,
        partnerEmail: null,
        partnerPhone: null,
        partnerShirtSize: null,
        partnerBftMember: false,
      });
    }
  });

  it("reads nothing, so a closed account cannot stop it", async () => {
    mocks.findUser.mockResolvedValue(null);
    await unlinkPair("a", "b");
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});
