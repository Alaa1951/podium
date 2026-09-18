# Cold loading and repeated mobile requests

This follow-up addresses the report that every screen still feels slow after the warm-tab fixes. The earlier 127–342ms measurement started after a 2.5-second preparation interval; it did not measure first launch or an immediate first tap.

## Measured before this change

- Live service was unloaded. `/api/health` database samples were 1–3ms. Public login took about 12ms directly on the server and 74ms through HTTPS from the server. These are public endpoints, not proof of authenticated screen latency.
- From this workstation, new-browser public login reached interactive setup in roughly 0.7–1.0s in repeat Chromium/WebKit contexts; the first Chromium connection took 3.65s, including about 2.7s before DNS started. Subsequent public document loads took about 0.19–0.32s. Browser/OS startup and transport time must not be attributed to SQL.
- A controlled local production admin cold load (150ms RTT, 2Mbps, 4x CPU, HTTP/1.1 proxy) transferred about 1.07MB and hydrated in 3.17s on a warmed server. A wave tap immediately afterward took 942ms. The existing full-prefetch benchmark had waited before tapping.
- The root layout preloaded all seven font files at high priority: about 414KB compressed. Automatic-theme branding eagerly loaded both themes and hidden mobile sidebar images, about 372KB of PNGs. An ablation blocking fonts reduced hydration to 2.03s; this is diagnostic evidence, not a proposed font removal or a measurement of the final code.
- CSV export links were Next navigation links and requested the export before the user clicked. The bell downloaded a full notification feed on every route. Native activation could discard route data after a brief system interruption.

## Changes

- Keep every existing font, weight and `font-display: swap`; request faces when used rather than preloading all seven on every page.
- Lazy-load branding so CSS-hidden themes and sidebars do not compete with navigation scripts. Preserve artwork and theme switching.
- Use download anchors for CSV exports, preventing speculative data exports.
- Request an authorized unread summary for the notification badge; load message bodies when the inbox opens. Deduplicate visible refresh triggers and refresh after successful notification changes.
- Refresh the native route once after at least 30 seconds in the background, when online and without unsaved edits. Distinguish real backgrounding from iOS inactivity or Android pause-only system dialogs.
- Use both monotonic and wall time for the background duration, because the browser's monotonic clock can pause while a phone sleeps. A clock adjustment may cause one harmless refresh, never repeated activation refreshes.
- Aggregate actual production request durations every 30 seconds through Node HTTP diagnostics. Log only fixed route labels, request kind, counts, mean/max duration, slow counts and server-error counts. No slugs, person IDs, searches, cookies, IPs or bodies are recorded; no response is modified. Idle periods produce no log.

## Reproduction and limits

The rebuilt application was measured without blocking any requests. Under the same throttled local conditions, warm-server/empty-browser-cache mobile hydration was 2.492/2.499s versus 3.175s before. The immediate first tab took 552/627ms versus 942ms. Transfer fell to 509/511KB from 1.072MB; fonts fell from seven/413KB to four/213KB, with no hidden-logo downloads or speculative exports. A separate first-server-request sample was 2.889s with 475ms TTFB and is not mixed into the warm-server comparison. Desktop hydration was 2.442s versus the earlier 3.766s sample. These are small controlled samples, not a guarantee of phone/network latency; mobile cold hydration is still about 2.5s under this deliberately slow connection/CPU profile.

The timing instrumentation was verified against the actual local production server. Sample wave RSC requests averaged 55ms (max 81ms); score requests averaged 63ms (max 106ms), with no server errors in that sample. This supports separating server processing from transfer/hydration work, and does not prove production authenticated requests are equally fast.

Final integrated `npm run verify` passed types, lint, 309 tests and production build. The workspace contains 21 unrelated publishing tests excluded from this release. Notification browser checks passed six cases on Chromium/WebKit at 390/1024px; two mobile combinations deliberately skip the desktop-panel scenario. They verify request counts, a confirmed local read, delayed-response races, route dismissal and read-only role preview. Resume tests include locked-phone clock suspension and clock adjustments.

All eight final asset/export browser cases passed on Chromium/WebKit, 390/1024px, English/dark and Arabic/light. They verify font preloads absent, hidden artwork unfetched, correct visible branding, no speculative export and a completed CSV download that leaves the page in place. CSV uses the server's existing `Content-Disposition` header; a redundant `download` attribute suppressed the click request in tested WebKit and was removed before release.

Cold-profile scripts and private local fixtures remain in ignored `.mobile-qa/`. Compare the same server, viewport, network and CPU settings, start a fresh browser context and tap as soon as hydration completes. Do not wait for tab prefetches before measuring the immediate first tap. Check both Chromium and WebKit, mobile/desktop, light/dark, and that unused logos and export requests are absent.

Production timing can be inspected with `journalctl -u podium --since '5 minutes ago' --no-pager | grep REQUEST_TIMING` after a user navigates normally. These are server response durations, not phone render or full network measurements. Browser simulation does not establish physical-device performance.

Implementation references: installed Next 16.3.4 font/image/instrumentation documentation and [Node HTTP diagnostic channels](https://nodejs.org/api/diagnostics_channel.html#event-httpserverrequeststart). The Node channel integration is covered by an actual local HTTP response test; the upstream HTTP channels are marked experimental.
