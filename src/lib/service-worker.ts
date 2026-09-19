type Container = Pick<ServiceWorkerContainer, "register" | "getRegistrations">;

/**
 * The web gets the install/offline worker. The store shells do not: their
 * WebView would have to start the worker before every navigation, and the
 * shell has its own offline page (capacitor-web/offline.html). Phones that
 * registered it before this change drop it on their next launch.
 */
export async function syncServiceWorker(native: boolean, container: Container | undefined) {
  if (!container) return;
  if (native) {
    const registrations = await container.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    return;
  }
  await container.register("/sw.js");
}
