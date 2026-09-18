# PODIUM mobile experience review

This change keeps the existing Capacitor applications and server data model. It adds an application layout for mobile browsers through 900px and for installed Capacitor applications at every width. Desktop browsers above 900px retain their sidebar, tables and inline editing workflows. Native tablets use additional card columns where space permits.

## Interface and navigation

- Platform tabs: dashboard, competitions, users and More. Competition tabs: competitors/teams, waves, score entry, results and More. Tabs come from the server's permission-filtered menu.
- Competitors: My team, My wave, Results and Account. Accounts with a live wave grant can open My wave from their personal navigation.
- More is a full-screen destination backed by browser history. The competition title opens its overview; detail screens keep their section selected.
- Standalone administrator account/inbox pages retain the four platform tabs with More selected. Competitor and studio inbox details keep Account selected. Opening the full mobile inbox through the bell asks before abandoning a dirty form; desktop notification dialogs keep the current form mounted.
- Registration, person, score, result, studio, account, role, wave, audit, announcement and notification details have addressable routes. Longer editors use `/edit` routes; zone definitions use `/settings/zones/[id]/edit`.
- Search/filter values remain in the URL. Opening a detail saves the list's URL and scroll position for Back. Direct links have a parent fallback. Private person links use the actual competitor identifier, with server scope checks.
- Small selections use a modal bottom sheet with focus management. Primary form actions stay above the bottom navigation; the section bar hides while the keyboard is shown. Controls have mobile touch targets of at least 48px, form text of at least 16px, RTL support and reduced-motion styles. Pinch zoom remains enabled.
- Tables that remain on mobile become vertical labelled cards; major operational lists have compact card summaries and independent detail screens. Text, form rows and grids wrap instead of concealing overflow.
- The live board retains its wall-display frame on desktop. Mobile uses the permission-filtered competition navigation for administrators and participating studios, or personal navigation for competitors and other studios. Studio overview links stay in their own competition scope.
- Live board bracket choices use a bottom sheet on mobile, leaving room for the ranking and wave summary. The compact rank/team/total header stays aligned with the result cards.

The tab design follows [Apple's tab bar guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars). PODIUM typography, brand colours and light/dark themes are retained.

## Installed application integration

The official Capacitor 8 [App](https://capacitorjs.com/docs/apis/app), [Keyboard](https://capacitorjs.com/docs/apis/keyboard), Status Bar and [Preferences](https://capacitorjs.com/docs/apis/preferences) integrations run only in installed applications. Browser equivalents retain normal route history, viewport sizing and network feedback.

Android Back closes an open sheet/More before navigating; top-level home screens move the app to the background. iOS enables the WebView back/forward gesture against the same route history. Dirty forms ask before abandoning changes, including browser Back. Login success replaces authentication destinations rather than pushing another login entry. A resumed application refreshes only when online and no dirty form is open.

Safe-area insets and dynamic viewport sizing protect the notch and home indicator. Offline Retry restores a validated internal route, falling back to login. `mobile:sync` copies the official Capacitor runtime into the local error page before synchronising native assets. iOS includes the Preferences UserDefaults privacy declaration, reason `CA92.1`.

Inside Capacitor, official keyboard events control the section bar; the browser's visual-viewport heuristic cannot overwrite them when native resize changes the window height. Network feedback stays below the header and clear of primary Save actions. The finisher timer begins with consistent server/browser content, then captures the current time when pressed.

## Local review and repeatable tests

Local fixture generation is restricted to a localhost database. It creates dedicated `mobile-e2e` accounts, studios, competitions, people, waves, announcements and a custom view-only role. It does not rebuild or delete existing competitions. Authentication screens use short-lived fixture links; expire them after review. The tests sign local fixture sessions directly, so they do not prove delivery of login emails or OTP messages.

```powershell
npm ci
npx playwright install chromium webkit
npm run mobile:fixtures
npm run dev -- --hostname 127.0.0.1 --port 3100
# In another terminal:
npm run test:mobile
npm run verify
node scripts/mobile-fixtures.mjs --expire-auth
```

The test matrix includes Chromium and WebKit, 320/375/390/430/768/1024px, English/Arabic and light/dark: 48 projects. Public/authentication and each role's screen layout run in every project. Behaviour scenarios run at representative phone widths; tablet scenarios simulate Capacitor's platform at 1024px and check two card columns. They do not use a real native bridge. Skips at other widths are intentional and are not recorded as successful device tests.

After the matrix finishes, run `node scripts/mobile-coverage.mjs` to regenerate the sanitised screen inventory and counts from its actual report. Browser assertions also check public control contrast and list scroll restoration. Account validation and dedicated fixture account editing run without sending messages to other users.

For a production build, serve it locally through HTTPS (the production security policy upgrades requests to HTTPS), then set `MOBILE_QA_URL` to that local HTTPS origin and `MOBILE_QA_PRODUCTION=1`. HTTPS certificate bypass in Playwright applies only to the local review server; production application security headers remain enabled. The config rejects remote review hosts.

Local HTTPS QA blocks service workers because WebKit rejects the self-signed worker certificate; offline Retry scripts have unit coverage. Only WebKit's known local prefetch certificate/abort diagnostic is excluded from page errors. Native keyboard, native service-worker recovery and hardware Back still require device validation.

Chromium review sessions also bypass the self-signed certificate at browser launch to avoid local `ERR_TOO_MANY_RETRIES` stylesheet failures. This applies only to localhost HTTPS QA; application headers and production TLS remain enabled. The root fallback has its own Arabic/English layout, safe insets and validated recovery path without depending on the failed layout's providers or stylesheets. Isolated component previews validate its layout/recovery; a real Next.js root exception was not injected.

Reports, screenshots and retained failure traces are generated under `.mobile-qa/` and are excluded from source control. See [MOBILE-SCREEN-COVERAGE.md](MOBILE-SCREEN-COVERAGE.md) for recorded coverage and actual results.

## Build test installations

The remote start URL remains the existing production login URL. A native build alone therefore does **not** expose un-deployed web changes. For test installations, use a separately deployed HTTPS review environment and a test build configured to its authorised host; restore production configuration before preparing an eventual release. No production deployment or store submission is included in this work.

In an isolated test checkout, set `server.url` and the explicit host in `server.allowNavigation` in `capacitor.config.ts` to the review origin. Update the fallback origin in `capacitor-web/index.html` and `capacitor-web/offline.html` to that same HTTPS origin, then run `mobile:sync`. All three must agree so offline Retry stays in the review environment. The checked-in defaults remain production; none of those test-host changes is made by this task.

Android with Android Studio, Android SDK and JDK 21:

```powershell
npm ci
npm run mobile:sync -- android
cd android
.\gradlew.bat assembleDebug
```

Install `android/app/build/outputs/apk/debug/app-debug.apk` on a test phone/tablet. Existing release signing and publishing procedures remain in [MOBILE.md](MOBILE.md); do not rotate keys or run the publishing workflows as part of this review.

iOS on a Mac with the project's supported Xcode:

```sh
npm ci
npm run mobile:sync -- ios
npm run mobile:ios
```

Select a development signing team and run on iPhone/iPad, or create a development archive for an authorised test device. Check the privacy resource in the target. Store upload is a separate phase.

## Required physical device review

No physical-device checks are implied by WebKit or by changing a CSS native flag. Before release, run the same registration, payment, check-in, wave lock, score save, notification and account flows on real iPhone, iPad and Android devices. Check notch/home indicator, rotation, native keyboard, keyboard dismissal, edge Back/Android Back, dirty-draft cancellation, resume and real loss of connectivity. Record OS/device/build, steps, screenshots and outcome. Desktop browser checks must also pass.
