# Mobile navigation and iPhone header follow-up

## Findings and changes

- Dynamic tabs had no `loading.tsx` boundary, so a tap waited for the entire server response without visible feedback. Added streaming boundaries inside the shared platform/competition/studio layouts and immediate pending feedback on tab/detail links. Tabs remain usable while the next screen loads. No private page data is cached across requests.
- Parent layouts and pages independently resolved the same session, permissions and competition state. React request-scoped memoization now shares those reads within one render, while subsequent requests still resolve current permissions and state.
- A studio's single-competition lookup loaded and counted all its competitions. The database query now selects the requested slug with the same studio membership condition. A single team's score detail now sends one team row, fetches only its audit history and skips the account/grant directory used by the list screen. Peer score comparisons retain their original source data.
- A document-wide mutation observer rescanned every table after timer/notification changes. It now labels only affected tables, batches changes per animation frame and skips desktop work. An unrelated eight-tick timer produced zero table rescans in browser checks.
- Installed iOS headers are fixed above the scrolling content with a reserved layout offset. All headers use the shared safe-area value. If an old iOS shell reports a zero top inset in portrait, a conservative fallback reserves 64px on phones or 24px on iPads; a real system inset replaces the fallback, and landscape does not retain portrait padding. iOS device orientation prevents keyboard resizing from removing this clearance. This web correction also reaches existing installed shells; no native rebuild is required for these changes.

## Actual validation

- Local types, lint, 263 unit tests and production build passed. The local count includes 21 unrelated Play publishing tests that remain outside this web release.
- 26 new browser regression checks passed; four desktop-only combinations intentionally skip phone-specific checks. Chromium and WebKit exercised 320, 390, 430, 768 and 1024px, including RTL, scroll, direct detail routes, tappable Back, keyboard-height simulation, interruptible delayed navigation and bounded table work.
- Existing detail/Back/filter, cross-studio denial, read-only role preview, payment, attendance, score persistence/restoration and notification tests: 11 passed after one independent WebKit recheck; four non-applicable cases intentionally skipped. The initial suite required assertions appropriate to streamed 404 content and visible controls because Next preserves hidden transition content. One local WebKit draft check failed during streaming/hydration and passed an unchanged isolated recheck; retained reports include that failure.
- With an artificial 1.2s network delay, both admin and studio navigation had switched to the destination and shown its loading state by the 150ms observation. Before the change, both still showed the old screen with no pending feedback; completion took about 1.55s. This measures tap feedback, not a claim that complete server data arrives in 150ms.
- Native iOS layout/orientation and missing insets were simulated in browsers. Physical iPhone/iPad safe-area and keyboard verification remains pending; no real-device success is claimed.

Local evidence: `.mobile-qa/report/navigation-fix/`, `.mobile-qa/report/navigation-scope-recheck/`, `.mobile-qa/report/navigation-dirty-recheck/`, `.mobile-qa/navigation-before.json`, `.mobile-qa/navigation-after.json` and `.mobile-qa/navigation-review/`.
