import { describe, expect, it } from "vitest";

import { DEFAULT_STUDIO_PERMISSIONS, type CurrentUser } from "@/lib/access";
import { announcementSchema, canComposeAnnouncements, canSendAnnouncement, notificationScope } from "@/lib/notification-access";

const studio: CurrentUser = { id: "sender", email: "staff@example.test", name: null, role: "studio", studioId: "west-walk", locale: "en", permissions: DEFAULT_STUDIO_PERMISSIONS };
const content = { title: "Schedule update", body: "Your next wave starts at 10:00." };

describe("announcement authority", () => {
  it("lets a default studio account send only to its own studio", () => {
    expect(canSendAnnouncement(studio, { ...content, audience: "studio", audienceStudioId: "west-walk" })).toBe(true);
    expect(canSendAnnouncement(studio, { ...content, audience: "studio", audienceStudioId: "the-pearl" })).toBe(false);
    expect(canSendAnnouncement(studio, { ...content, audience: "all" })).toBe(false);
    expect(canSendAnnouncement(studio, { ...content, audience: "role", audienceRole: "competitor" })).toBe(false);
  });
  it("allows admins to select every audience", () => {
    const admin = { ...studio, role: "admin" as const, studioId: null, permissions: [] };
    expect(canSendAnnouncement(admin, { ...content, audience: "all" })).toBe(true);
    expect(canSendAnnouncement(admin, { ...content, audience: "role", audienceRole: "studio" })).toBe(true);
    expect(canSendAnnouncement(admin, { ...content, audience: "studio", audienceStudioId: "the-pearl" })).toBe(true);
  });
  it("refuses previews, competitors, missing studios and custom roles without send permission", () => {
    const input = { ...content, audience: "studio" as const, audienceStudioId: "west-walk" };
    expect(canSendAnnouncement({ ...studio, viewAs: { byAdminId: "admin" } }, input)).toBe(false);
    expect(canSendAnnouncement({ ...studio, role: "competitor" }, input)).toBe(false);
    expect(canSendAnnouncement({ ...studio, studioId: null }, input)).toBe(false);
    expect(canSendAnnouncement({ ...studio, permissions: ["announcements.view"] }, input)).toBe(false);
    expect(canComposeAnnouncements({ ...studio, permissions: [] })).toBe(false);
  });
});

describe("announcement validation", () => {
  it("rejects spoofed authors, mismatched audience fields, invalid roles and blank content", () => {
    for (const input of [
      { ...content, audience: "all", createdBy: "admin" },
      { ...content, audience: "all", audienceStudioId: "west-walk" },
      { ...content, audience: "role", audienceRole: "owner" },
      { ...content, audience: "studio", audienceStudioId: "" },
      { ...content, audience: "all", title: "   " },
      { ...content, audience: "all", body: "x".repeat(4001) },
    ]) expect(announcementSchema.safeParse(input).success).toBe(false);
  });
});

describe("inbox scope", () => {
  it("never grants admins recipient access to other roles or studios", () => {
    expect(notificationScope({ role: "admin", studioId: null })).toEqual({ OR: [{ audience: "all" }, { audience: "role", audienceRole: "admin" }] });
  });
  it("includes only the current role and assigned studio, with no null-studio fallback", () => {
    expect(notificationScope({ role: "competitor", studioId: "west-walk" })).toEqual({ OR: [{ audience: "all" }, { audience: "role", audienceRole: "competitor" }, { audience: "studio", audienceStudioId: "west-walk" }] });
    expect(notificationScope({ role: "studio", studioId: null }).OR).toHaveLength(2);
  });
});
