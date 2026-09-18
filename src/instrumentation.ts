/** Server-only timing metadata; no browser telemetry or private request data. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { startRequestTiming } = await import("./lib/request-timing");
    startRequestTiming();
  }
}
