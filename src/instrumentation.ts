/** Server-only timing metadata; no browser telemetry or private request data. */
export async function register() {
  // Keep Node-only imports inside the runtime branch so the development
  // Edge bundle excludes native modules such as sharp and child_process.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "production") {
      const { startRequestTiming } = await import("./lib/request-timing");
      startRequestTiming();
    }

    // The portrait worker. NOT gated on production, because it has to be
    // runnable locally to be worth anything — gated instead on the feature's own
    // switch, which is absent in production while the store review runs.
    const { portraitsEnabled, startPortraitRunner } = await import("./lib/portraits/runner");
    if (portraitsEnabled()) startPortraitRunner();

    // The CRM poll, on the same terms: its own switch, absent in production
    // until somebody turns it on, and runnable locally so it can be tried
    // against a real CRM before it is ever pointed at a real competition.
    const { crmSyncEnabled, startCrmPoller } = await import("./lib/crm/sync");
    if (crmSyncEnabled()) startCrmPoller();
  }
}
