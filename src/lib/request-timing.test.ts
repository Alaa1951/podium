import { channel } from "node:diagnostics_channel";
import { createServer } from "node:http";
import { expect, test, vi } from "vitest";
import { startRequestTiming, timingRoute } from "./request-timing";

test("timing labels remove all personal route values and query strings", () => {
  expect(timingRoute("/series/private-event/registrations/person-id?email=secret@example.com")).toBe("/series/[series]/registrations/detail");
  expect(timingRoute("/api/series/private-event/export?token=secret")).toBe("/api/series/[series]/export");
  expect(timingRoute("/users/private-id")).toBe("/users/detail");
  expect(timingRoute("/unknown/private-value")).toBe("/other");
  expect(timingRoute("/_next/static/private.js")).toBeNull();
});

test("collects bounded aggregate durations and errors without headers or identifiers", () => {
  const write = vi.fn(); let time = 0;
  const stop = startRequestTiming({ write, now: () => time });
  const begin = channel("http.server.request.start"), finish = channel("http.server.response.finish");
  try {
    for (const duration of [100, 1200]) {
      const request = { url: "/users/private-id?password=secret", method: "GET", headers: { rsc: "1", cookie: "private-cookie" } };
      const event = { request, response: { statusCode: duration > 1000 ? 500 : 200 } };
      begin.publish(event); time += duration; finish.publish(event);
    }
  } finally { stop(); }
  expect(write).toHaveBeenCalledTimes(1);
  const line = write.mock.calls[0][0];
  expect(line).not.toMatch(/private-id|secret|cookie|password/);
  expect(JSON.parse(line.replace("[REQUEST_TIMING] ", "")).routes).toEqual([
    { route: "/users/detail", kind: "rsc", count: 2, maxMs: 1200, slow: 1, errors: 1, meanMs: 650 },
  ]);
});

test("installed Node HTTP server emits the timing events for actual responses", async () => {
  const write = vi.fn(); const stop = startRequestTiming({ write });
  const server = createServer((_request, response) => response.end("ok"));
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local port");
    expect(await (await fetch(`http://127.0.0.1:${address.port}/account`)).text()).toBe("ok");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    stop();
  }
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0]).toContain('"route":"/account"');
});
