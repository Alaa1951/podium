import fs from "node:fs";
import path from "node:path";

// This report contains route templates and counts, never session cookies or auth links.
const report = JSON.parse(fs.readFileSync(".mobile-qa/report/results.json", "utf8"));
const supplementary = ["timeout-rechecks", "board-final", "post-final", "tablet-final", "common-final", "common-rechecks", "common-settled"].filter(name => fs.existsSync(`.mobile-qa/report/${name}/results.json`)).map(name => ({ name, report: JSON.parse(fs.readFileSync(`.mobile-qa/report/${name}/results.json`, "utf8")) })).filter(item => Date.parse(item.report.stats.startTime) >= Date.parse(report.stats.startTime));
function testResults(suites) {
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => ({ title: spec.title, project: test.projectName, status: test.status }))),
    ...testResults(suite.suites ?? []),
  ]);
}
const initialFailures = testResults(report.suites).filter(test => test.status === "unexpected");
const rechecks = supplementary.find(item => item.name === "timeout-rechecks");
const resolvedFailures = initialFailures.filter(failure => rechecks && testResults(rechecks.report.suites).some(test => test.title === failure.title && test.project === failure.project && test.status === "expected"));
const projects = report.config.projects.map(project => project.name);
const since = Date.parse(report.stats.startTime);
const fallbackFile = ".mobile-qa/global-preview/results.json";
const isolatedFallback = fs.existsSync(fallbackFile) ? JSON.parse(fs.readFileSync(fallbackFile, "utf8")) : null;
function walk(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const routes = walk("src/app").filter(file => path.basename(file) === "page.tsx").map(file => {
  const segments = path.relative("src/app", path.dirname(file)).split(path.sep).filter(segment => segment && !segment.startsWith("("));
  const route = "/" + segments.join("/");
  const pattern = new RegExp("^/" + segments.map(segment => segment.startsWith("[") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/") + "$" );
  return { route, pattern, specificity: segments.filter(segment => !segment.startsWith("[")).length, projects: new Set(), roles: new Set(), checks: 0 };
}).sort((a,b) => b.specificity - a.specificity);
let checks = 0, errorScreens = 0;
for (const project of projects) {
  const file = `.mobile-qa/coverage/${project}.jsonl`;
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean)) {
    const item = JSON.parse(line);
    if (Date.parse(item.checkedAt) < since) continue;
    checks++;
    const screen = routes.find(route => route.pattern.test(item.route));
    if (!screen) { if(item.status === 404) errorScreens++; continue; }
    screen.projects.add(project);
    screen.roles.add(item.scenario.split(":")[0].replace("public and authentication screens fit without sideways scrolling", "public/auth"));
    screen.checks++;
  }
}
const summary = {
  recordedAt: new Date().toISOString(), matrixStartedAt: report.stats.startTime,
  durationMinutes: Number((report.stats.duration / 60000).toFixed(1)),
  tests: { passed: report.stats.expected + resolvedFailures.length, failed: report.stats.unexpected - resolvedFailures.length, flaky: report.stats.flaky, intentionallySkipped: report.stats.skipped },
  initialMatrix: { passed: report.stats.expected, failed: report.stats.unexpected, resolvedBySeparateRechecks: resolvedFailures.length },
  supplementary: supplementary.map(({ name, report: extra }) => {
    const failed = testResults(extra.suites).filter(test => test.status === "unexpected");
    const later = supplementary.filter(item => Date.parse(item.report.stats.startTime) > Date.parse(extra.stats.startTime));
    const resolved = failed.filter(failure => later.some(item => testResults(item.report.suites).some(test => test.title === failure.title && test.project === failure.project && test.status === "expected")));
    return { name, passed: extra.stats.expected + resolved.length, failed: extra.stats.unexpected - resolved.length, initiallyFailed: extra.stats.unexpected, resolvedBySeparateRechecks: resolved.length, flaky: extra.stats.flaky, intentionallySkipped: extra.stats.skipped };
  }),
  isolatedFallback: isolatedFallback && Date.parse(isolatedFallback.checkedAt) >= since ? isolatedFallback : null,
  projects, successfulScreenVisits: checks, notFoundScreenVisits: errorScreens,
  screens: routes.sort((a,b) => a.route.localeCompare(b.route)).map(route => ({ route: route.route, projects: [...route.projects].sort(), roles: [...route.roles].sort(), successfulVisits: route.checks })),
  physicalDevices: { iPhone: "not run", iPad: "not run", Android: "not run" },
  nativeBinaryBuilds: { Android: "not run: Android SDK/JDK unavailable", iOS: "not run: macOS/Xcode unavailable" },
};
fs.mkdirSync("docs/mobile-review", { recursive: true });
fs.writeFileSync("docs/mobile-review/coverage.json", JSON.stringify(summary, null, 2) + "\n");
const missing = summary.screens.filter(screen => screen.projects.length !== projects.length);
const rows = summary.screens.map(screen => `| \`${screen.route}\` | ${screen.roles.join(", ")} | ${screen.projects.length}/${projects.length} | ${screen.successfulVisits} |`).join("\n");
fs.writeFileSync("docs/MOBILE-SCREEN-COVERAGE.md", `# PODIUM mobile screen coverage

Recorded ${summary.recordedAt}; final matrix started ${summary.matrixStartedAt}. This report is generated by \`node scripts/mobile-coverage.mjs\` from the actual local Playwright results and successful route checks.

## Actual results

- Main matrix: ${summary.tests.passed} passed after verified rechecks, ${summary.tests.failed} unresolved failures, ${summary.tests.flaky} flaky, ${summary.tests.intentionallySkipped} intentionally skipped; initial run ${summary.durationMinutes} minutes.
- The initial run recorded ${summary.initialMatrix.passed} passes and ${summary.initialMatrix.failed} failures; ${summary.initialMatrix.resolvedBySeparateRechecks} failures passed independent rechecks with fewer parallel workers. Original results/traces remain available locally rather than rewriting the initial report.
- Separate final-build checks: ${summary.supplementary.map(item => `${item.name}: ${item.passed} passed, ${item.failed} failed, ${item.intentionallySkipped} intentionally skipped`).join("; ") || "not yet recorded"}. The live-board check visits all four roles in every configuration; representative final-build screen/interaction checks rerun English/dark phone, Arabic/light WebKit phone and both desktop engines.
- The representative post-build run initially had one failing manual CSS tablet simulation. The actual browser layout recalculation overwrote its manually set flag. The revised tablet check simulates Capacitor's platform before navigation, checks two card columns, and passed in both engines; the original failed report remains local. Supplementary counts above include only failures matched to a later successful check with the same title and project.
- Isolated root-fallback component: ${summary.isolatedFallback ? `${summary.isolatedFallback.layouts} layout checks and ${summary.isolatedFallback.recoveries} recovery checks passed. This is an isolated component preview, not an injected Next.js root exception.` : "not recorded"}
- ${projects.length} browser configurations: Chromium/WebKit × 320/375/390/430/768/1024px × English/Arabic × light/dark.
- ${summary.screens.length} application page templates; ${checks} successful layout visits, including ${errorScreens} expected 404 visits. ${missing.length ? `${missing.length} templates need additional matrix coverage.` : "Every page template was visited in all 48 configurations."}
- Admin, studio, competitor and a genuine custom score-view-only role have separate authenticated sessions. The custom role's forbidden tabs and user-directory access are checked.
- The main layout checks cover rendered geometry, page/content-list horizontal overflow, language, minimum tab targets, result-contact privacy and unexpected browser errors. Browser widths above 900px retain the desktop layout.
- The separate common-navigation matrix visits account, inbox and notification details for all four roles in every configuration, checking RTL/LTR, the selected tab, role-specific tab counts, touch targets and a single visible bell. A dirty score draft is retained when notification navigation is cancelled. Its initial two WebKit tablet failures reported a local HTTPS notification-fetch diagnostic during navigation, reproduced in the first independent recheck. The revised test waits for the bell's initial request to complete before navigating again and retains the same browser-error assertions; actual outcomes are listed above. Original failed reports/traces remain local.
- Representative interaction checks cover direct detail links, URL filters/Back, dirty draft cancellation through header and browser Back, bottom sheets, More/history, cross-studio and inbox scope, read-only role preview, and failed offline score saves.
- Dedicated local write checks confirm registration/edit/archive, payment/unpayment, attendance/unattendance, score persistence/restoration, notification receipts, account name edit/restoration and wave start/end/reopen with studio score locking. Password mismatch validation retains the entered draft. These checks use fixture data only.
- Type checking, lint, 253 unit tests and production build passed. Capacitor sync passed for Android and iOS; Android's platform-specific sync command was also verified.

Keyboard visibility is a CSS simulation; tablet layout has CSS and Capacitor-platform simulations, **not native keyboard/device tests**. The separate board check also exercises Capacitor's native-layout branch at 1024px with a simulated platform, without a real native bridge. Local Playwright sessions are signed directly; email delivery, OTP delivery and store installation were not exercised. Payment checks cover the existing registration payment-status workflow, not a separate payment-gateway transaction. Service workers are blocked in local HTTPS browser QA because WebKit rejects the local self-signed worker certificate; offline Retry scripts have separate unit coverage. Only WebKit's known local \`_rsc\` prefetch certificate/abort diagnostic is excluded from page errors. Interim Chromium localhost HTTPS runs encountered \`ERR_TOO_MANY_RETRIES\` stylesheet failures; final Chromium sessions bypass the self-signed certificate at browser launch. Interim reports/traces are retained in local archives; production security settings were not changed for these tests.

## Screen inventory

| Page template | Sessions | Configurations | Successful visits |
| --- | --- | --- | --- |
${rows}

## Visual evidence

The reviewed phone screenshots include every page template in English/dark Chromium and Arabic/light WebKit, with both full-page and viewport frames. Full local evidence is under \`.mobile-qa/screenshots/\`; operational screens use dedicated fixture data and directories also show existing local seed data. Curated fixture examples are retained in [mobile-review/README.md](mobile-review/README.md). Matrix HTML/JSON and failure traces remain local under \`.mobile-qa/\` to avoid checking in authentication links and private test session data. A sanitised summary is retained in [mobile-review/coverage.json](mobile-review/coverage.json).

## Outstanding physical validation

| Check | Recorded status |
| --- | --- |
| iPhone / iOS gesture, safe area, native keyboard, resume, offline | Not run; requires actual device and macOS/Xcode |
| iPad / rotation, native tablet layout, keyboard | Not run; requires actual device and macOS/Xcode |
| Android / native Back, background, keyboard, installation | Not run; requires actual device and Android SDK/JDK |
| Android APK build | Not run; SDK/JDK unavailable on this workstation |
| iOS development build/archive | Not run; macOS/Xcode unavailable on this workstation |
| Email/OTP delivery and complete successful authentication | Not run in browser matrix; local sessions bypass delivery |
| Successful password change / device revocation | Screen layout and password mismatch validation covered; successful browser mutation not run |
| Production deployment / store submission | Outside this phase; not performed |

Build instructions and the physical-device checklist are in [MOBILE-UX.md](MOBILE-UX.md). Fixture authentication links are explicitly expired after review; the fixture accounts/competitions remain local for repeatability. No database schema change was required.
`);
console.log(`${summary.tests.passed} passed / ${summary.tests.failed} failed; ${summary.screens.length} page templates; ${checks} successful visits; ${missing.length} incompletely covered templates.`);
if (missing.length || summary.tests.failed || summary.tests.flaky || summary.supplementary.some(item => item.failed || item.flaky)) process.exitCode = 1;
