import { channel } from "node:diagnostics_channel";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";

/** Fixed labels only: no account IDs, slugs, searches, cookies or IP addresses. */
export function timingRoute(url: string): string | null {
  const path = url.split("?", 1)[0];
  if (path.startsWith("/_next/") || path.startsWith("/brand/") || path === "/api/health") return null;
  const competition = path.match(/^\/(series|studio)\/[^/]+\/(registrations|teams|waves|scores|results|settings|studios|board)(\/|$)/);
  if (competition) return `/${competition[1]}/[series]/${competition[2]}${competition[3] ? "/detail" : ""}`;
  const api = path.match(/^\/api\/series\/[^/]+\/(board|export)$/);
  if (api) return `/api/series/[series]/${api[1]}`;
  for (const base of ["/api/notifications", "/api/auth", "/api/results", "/series", "/studio", "/users", "/studios", "/roles", "/audit", "/account", "/me", "/my-wave", "/results", "/notifications", "/announcements", "/login", "/verify", "/privacy"]) {
    if (path === base) return base;
    if (path.startsWith(`${base}/`)) return `${base}/detail`;
  }
  return path === "/" ? "/" : "/other";
}

type Sample = { route: string; kind: string; count: number; totalMs: number; maxMs: number; slow: number; errors: number };
type RequestEvent = { request: IncomingMessage; response: ServerResponse };

/** Aggregate real requests instead of creating diagnostic login sessions.
 * Node's HTTP channels observe the Next server behind the HTTPS proxy without
 * wrapping its handler or changing responses. At most one small log per 30s.
 */
export function startRequestTiming({ write = (line: string) => console.info(line), now = () => performance.now(), flushMs = 30_000 } = {}) {
  const starts = new WeakMap<IncomingMessage, { time: number; route: string; kind: string }>();
  const samples = new Map<string, Sample>();
  const begin = (message: unknown) => {
    const { request } = message as RequestEvent;
    const route = timingRoute(request.url ?? "");
    if (!route) return;
    const kind = request.method === "POST" ? "write" : request.headers.rsc === "1" ? "rsc" : route.startsWith("/api/") ? "api" : "document";
    starts.set(request, { time: now(), route, kind });
  };
  const finish = (message: unknown) => {
    const { request, response } = message as RequestEvent;
    const started = starts.get(request);
    if (!started) return;
    starts.delete(request);
    const key = `${started.route}:${started.kind}`;
    // Fixed route vocabulary plus a hard cap keeps diagnostics bounded.
    if (!samples.has(key) && samples.size >= 100) return;
    const sample = samples.get(key) ?? { route: started.route, kind: started.kind, count: 0, totalMs: 0, maxMs: 0, slow: 0, errors: 0 };
    const elapsed = Math.max(0, now() - started.time);
    sample.count++;
    sample.totalMs += elapsed;
    sample.maxMs = Math.max(sample.maxMs, elapsed);
    sample.slow += Number(elapsed >= 1000);
    sample.errors += Number(response.statusCode >= 500);
    samples.set(key, sample);
  };
  const flush = () => {
    if (!samples.size) return;
    const routes = [...samples.values()].map(({ totalMs, ...sample }) => ({ ...sample, maxMs: Math.round(sample.maxMs), meanMs: Math.round(totalMs / sample.count) }));
    samples.clear();
    write(`[REQUEST_TIMING] ${JSON.stringify({ routes })}`);
  };
  const requestStart = channel("http.server.request.start");
  const responseFinish = channel("http.server.response.finish");
  requestStart.subscribe(begin);
  responseFinish.subscribe(finish);
  const timer = setInterval(flush, flushMs);
  timer.unref();
  return () => { clearInterval(timer); requestStart.unsubscribe(begin); responseFinish.unsubscribe(finish); flush(); };
}
