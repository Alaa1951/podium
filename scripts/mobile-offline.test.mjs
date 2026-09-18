import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

const nativePage = readFileSync(new URL("../capacitor-web/offline.html", import.meta.url), "utf8");
const nativeScript = nativePage.match(/<script>([\s\S]*?)<\/script>/)[1];

describe("installed app offline recovery", () => {
  test.each([
    ["/studio/mobile-qa-live/teams?q=Mobile", "/studio/mobile-qa-live/teams?q=Mobile"],
    ["//untrusted.invalid/path", "/login"],
    ["https://untrusted.invalid/path", "/login"],
    ["/\\untrusted.invalid/path", "/login"],
    ["/verify?email=private", "/login"],
    [null, "/login"],
  ])("recovers only a valid internal route (%s)", async (saved, expected) => {
    const location = { href: "" };
    const context = vm.createContext({ location, window: { Capacitor: { registerPlugin: () => ({ get: async () => ({ value: saved }) }) } } });
    vm.runInContext(nativeScript, context);
    await vm.runInContext("retry()", context);
    expect(location.href).toBe("https://podium.bftmiddleeast.com" + expected);
  });
  test("loads the official Capacitor runtime before accessing Preferences", () => {
    expect(nativePage.indexOf('src="capacitor.js"')).toBeLessThan(nativePage.indexOf("registerPlugin('Preferences')"));
  });
});

test("browser offline recovery returns to the last internal screen", async () => {
  const listeners = {};
  const context = vm.createContext({ self: { addEventListener: (name, handler) => { listeners[name] = handler; } }, fetch: async () => { throw new Error("offline"); }, Response });
  vm.runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  let response;
  listeners.fetch({ request: { method: "GET", mode: "navigate" }, respondWith: promise => { response = promise; } });
  const html = await (await response).text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [saved, expected] of [["/users?q=Mobile", "/users?q=Mobile"], ["//untrusted.invalid", "/login"], ["/login", "/login"]]) {
    let destination;
    const page = vm.createContext({ localStorage: { getItem: () => saved }, location: { replace: value => { destination = value; } } });
    vm.runInContext(script, page);
    vm.runInContext("retry()", page);
    expect(destination).toBe(expected);
  }
});
