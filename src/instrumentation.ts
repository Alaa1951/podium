/** Server-only timing metadata; no browser telemetry or private request data. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NODE_ENV === "production") {
    const { startRequestTiming } = await import("./lib/request-timing");
    startRequestTiming();
  }

  // The portrait worker. NOT gated on production, because it has to be
  // runnable locally to be worth anything — gated instead on the feature's own
  // switch, which is absent in production while the store review runs.
  const { portraitsEnabled, startPortraitRunner } = await import("./lib/portraits/runner");
  if (portraitsEnabled()) startPortraitRunner();
}
