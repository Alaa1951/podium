import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "@/lib/access";
import { systemRole } from "@/lib/permissions/system-roles";

/** What a studio holds by default: the Gym/Studio role. */
const DEFAULT_STUDIO_PERMISSIONS: string[] = systemRole("gym-studio")!.permissions;

const mocks = vi.hoisted(() => ({ user: vi.fn(), studio: vi.fn(), create: vi.fn(), read: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), rate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/notifications", () => ({ getNotificationUser: mocks.user, markVisibleNotificationsRead: mocks.read }));
vi.mock("@/lib/prisma", () => ({ prisma: { studio: { findFirst: mocks.studio }, notification: { create: mocks.create } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRate: mocks.rate, MINUTE_MS: 60000 }));
vi.mock("@/lib/audit", () => ({ AUDIT: { announcementSent: "notification.sent" }, recordAudit: mocks.audit }));

import { markNotificationsRead, sendAnnouncement } from "@/lib/actions/notifications";

const studio: CurrentUser = { id: "staff", email: "staff@example.test", name: null, role: "studio", studioId: "own", locale: "en", permissions: DEFAULT_STUDIO_PERMISSIONS };
const input = { title: "Update", body: "New wave time", audience: "studio", audienceStudioId: "own" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(studio);
  mocks.studio.mockResolvedValue({ id: "own" });
  mocks.rate.mockReturnValue({ ok: true });
  mocks.create.mockResolvedValue({ id: "n1" });
});

describe("send action security", () => {
  it("does not write for another studio or a global audience", async () => {
    expect(await sendAnnouncement({ ...input, audienceStudioId: "other" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await sendAnnouncement({ title: input.title, body: input.body, audience: "all" })).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("refuses spoofed authors and read-only admin previews", async () => {
    expect(await sendAnnouncement({ ...input, createdBy: "admin" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    mocks.user.mockResolvedValue({ ...studio, role: "admin", viewAs: { byAdminId: "real-admin" } });
    expect(await sendAnnouncement(input)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("derives the sender from the server account and records the audience in the audit", async () => {
    expect(await sendAnnouncement(input)).toEqual({ ok: true });
    expect(mocks.create).toHaveBeenCalledWith({ data: { ...input, audienceRole: null, createdBy: "staff" }, select: { id: true } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "staff", action: "notification.sent", targetId: "n1" }));
  });
  it("refuses inactive studio audiences and throttles repeat sends", async () => {
    mocks.studio.mockResolvedValue(null);
    expect(await sendAnnouncement(input)).toEqual({ ok: false, error: "INVALID_INPUT" });
    mocks.studio.mockResolvedValue({ id: "own" });
    mocks.rate.mockReturnValue({ ok: false });
    expect(await sendAnnouncement(input)).toEqual({ ok: false, error: "TRY_LATER" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("read action security", () => {
  it("rejects guests and previews before writing", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await markNotificationsRead(["n1"])).toEqual({ ok: false, error: "FORBIDDEN" });
    mocks.user.mockResolvedValue({ ...studio, viewAs: { byAdminId: "admin" } });
    expect(await markNotificationsRead(["n1"])).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("passes unique validated IDs and the server account to the scoped receipt writer", async () => {
    expect(await markNotificationsRead(["n1", "n1"])).toEqual({ ok: true });
    expect(mocks.read).toHaveBeenCalledWith(studio, ["n1"]);
    expect(await markNotificationsRead(Array(101).fill("n1"))).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});
