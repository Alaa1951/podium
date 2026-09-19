import { describe, expect, it, vi } from "vitest";
import { syncServiceWorker } from "@/lib/service-worker";

function container(existing = 0) {
  const registrations = Array.from({ length: existing }, () => ({ unregister: vi.fn().mockResolvedValue(true) }));
  return {
    registrations,
    register: vi.fn().mockResolvedValue({}),
    getRegistrations: vi.fn().mockResolvedValue(registrations),
  };
}

describe("service worker per platform", () => {
  it("registers the install/offline worker in a browser", async () => {
    const sw = container();
    await syncServiceWorker(false, sw as never);
    expect(sw.register).toHaveBeenCalledWith("/sw.js");
  });

  it("never registers inside the native shell", async () => {
    const sw = container();
    await syncServiceWorker(true, sw as never);
    expect(sw.register).not.toHaveBeenCalled();
  });

  it("removes a worker a store install registered before", async () => {
    const sw = container(2);
    await syncServiceWorker(true, sw as never);
    sw.registrations.forEach((registration) => expect(registration.unregister).toHaveBeenCalled());
    expect(sw.register).not.toHaveBeenCalled();
  });

  it("does nothing where service workers are unavailable", async () => {
    await expect(syncServiceWorker(true, undefined)).resolves.toBeUndefined();
    await expect(syncServiceWorker(false, undefined)).resolves.toBeUndefined();
  });
});
