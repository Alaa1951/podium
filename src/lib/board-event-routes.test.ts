import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  user: null as { role: string; permissions: string[] } | null,
  state: null as { series: { id: string }; phase: "before" | "live" | "results" | "public" } | null,
  stream: vi.fn(() => new Response("notification")),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => fixture.user }));
vi.mock("@/lib/series-state", () => ({ getSeriesState: async () => fixture.state }));
vi.mock("@/lib/board-stream", () => ({ boardEventResponse: fixture.stream }));

import { GET as signedIn } from "@/app/api/series/[series]/events/route";
import { GET as wall } from "@/app/api/live/[series]/events/route";

const context = { params: Promise.resolve({ series: "event-slug" }) };
const request = () => new Request("http://localhost/events");

describe("board event route access", () => {
  beforeEach(() => {
    fixture.user = null;
    fixture.state = { series: { id: "event-id" }, phase: "before" };
    fixture.stream.mockClear();
  });

  it("requires a session on the signed-in stream", async () => {
    expect((await signedIn(request(), context)).status).toBe(401);
    expect(fixture.stream).not.toHaveBeenCalled();
  });

  it("hides the field before opening from ordinary signed-in accounts", async () => {
    fixture.user = { role: "competitor", permissions: [] };
    expect((await signedIn(request(), context)).status).toBe(403);
    expect(fixture.stream).not.toHaveBeenCalled();
  });

  it("a live signed-in viewer subscribes to the resolved ID when using a slug", async () => {
    fixture.user = { role: "competitor", permissions: [] };
    fixture.state!.phase = "live";
    const req = request();
    expect((await signedIn(req, context)).status).toBe(200);
    expect(fixture.stream).toHaveBeenCalledWith(req, "event-id");
  });

  it.each(["before", "results"] as const)("the anonymous %s stream remains inaccessible", async (phase) => {
    fixture.state!.phase = phase;
    expect((await wall(request(), context)).status).toBe(404);
    expect(fixture.stream).not.toHaveBeenCalled();
  });

  it.each(["live", "public"] as const)("the anonymous %s wall subscribes to the resolved series", async (phase) => {
    fixture.state!.phase = phase;
    const req = request();
    expect((await wall(req, context)).status).toBe(200);
    expect(fixture.stream).toHaveBeenCalledWith(req, "event-id");
  });
});
