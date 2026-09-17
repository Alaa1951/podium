# PODIUM: Apple release status

Verified through the public App Store Connect API on **17 September 2026**.
The existing app remains **PODIUM — BFT MENA**, ID `6812904157`, SKU
`PODIUM-001`, primary locale `en-GB`, bundle `app.podium.bftmena`, team
`VSXS43495X`. No new app, signing setup or native build is needed.

## Completed

| Item | Verified result |
| --- | --- |
| Signed upload | [iOS run 35177203441](https://github.com/Alaa1951/podium/actions/runs/35177203441), artifact `podium-ios-2-1` |
| Existing build | Marketing version **1.0**, actual Apple build **2.1**, `VALID`; expires 15 December 2026 |
| Export compliance | `usesNonExemptEncryption=false`; the shell uses Apple's WebView HTTPS and has no bundled non-exempt encryption |
| TestFlight | Internal group **PODIUM Internal** contains build 2.1; `READY_FOR_BETA_TESTING` |
| Store version | 1.0 remains `PREPARE_FOR_SUBMISSION`; build 2.1 selected; release set to **Manual** |
| English description | Exact full description from [MOBILE-PLAY.md](MOBILE-PLAY.md) |
| Keywords | `fitness,competition,leaderboard,workout,results,scores,games,gym` |
| Promotional text | Follow the BFT MENA competition series with live leaderboards, team scores and published results. Every wave, every division, all in one place. |
| Support / privacy URL | `https://podium.bftmiddleeast.com/privacy` |
| Category / copyright | **Health & Fitness** / **BFT MENA** |
| Age rating | Content questionnaire saved; Apple calculated **4+** |
| Pricing / availability | **Free**, Qatar base territory; all **175** territories available, all current prices zero, new territories enabled |
| Screenshots | Two iPhone and two iPad images uploaded, committed and delivery `COMPLETE`, leaderboard first |
| Project checks | `npm run verify` passed: type-check, lint, all 208 tests and production build; local smoke passed public 200, guest inbox 401 and signed-in inbox 200 |

Apple rejects edits to `whatsNew` for the first release (`STATE_ERROR:
Attribute 'whatsNew' cannot be edited at this time`). The requested text is
**First release.**; it is recorded here but the unsupported first-version
field stays empty. No App Store review or external beta review was submitted.

## Screenshots

Images and `manifest.json` are outside Git in
`C:\Users\Alaa\podium-signing\store-assets\apple\`:

| Display set | Dimensions | Order |
| --- | --- | --- |
| `APP_IPHONE_65` | 1242 × 2688 portrait | `iphone-1-womens-rookie.png`, `iphone-2-mens-pro.png` |
| `APP_IPAD_PRO_3GEN_129` | 2048 × 2732 portrait | `ipad-1-womens-rookie.png`, `ipad-2-mens-pro.png` |

Both pairs are actual headless captures of the live
`/results/podium-series-1/Womens/Rookie` and
`/results/podium-series-1/Mens/Pro` pages. Rendering uses 414 × 896 at 3×
and 1024 × 1366 at 2×; encoding removes alpha without stretching or resizing.
There were no existing screenshot sets. Portrait satisfies these sets;
landscape is not additionally required. Apple's
[specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
allow 6.5-inch iPhone screenshots when 6.9-inch screenshots are absent, and
these iPad dimensions for the required 13-inch family.

## Remaining human actions

1. **Provide the real internal tester email.** It must be an eligible App
   Store Connect user with access to PODIUM. No tester has been invited and
   the placeholder `pod-testers@bftmena.com` was not used. Once supplied, the
   IDE can add the tester via API to the existing internal group. If the user
   does not exist, the Account Holder first grants appropriate app access.
2. **Publish App Privacy labels in App Store Connect.** Apple's official
   [OpenAPI specification **4.4.1**](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip) contains no App Privacy/data-usage label
   endpoints. Privacy-policy URL editing is supported and completed; the
   nutrition-label questionnaire requires the console. Use the answer sheet
   below and check it against the production policy before publishing.
3. **Install the internal build on a real iPhone/iPad.** Test public results,
   staff sign-in, Arabic, airplane-mode fallback and, after the web release,
   announcement audience filtering and read persistence across devices.
4. **Check required review information in the console**, including an actual
   review contact and any requested staff demo access. Those personal details
   were not provided and have not been invented. Confirm any outstanding
   account agreements, rights or territory-specific compliance prompts.
5. **Approve Submit for Review in chat only after the remaining checks are
   green.** The IDE must not submit without explicit human approval. Manual
   release also requires a deliberate release action after approval.

### App Privacy answer sheet

In **App Store Connect → PODIUM → App Privacy**, declare data collected:

| Data | Purpose | Linked to identity | Tracking |
| --- | --- | --- | --- |
| Contact Info → Email Address | App Functionality (accounts / operational sign-in) | Yes | No |
| Contact Info → Name | App Functionality (accounts / competition display) | Yes | No |
| Identifiers → Device ID | App Functionality (sign-in security / trusted-device protection) | Yes, associated with account security records | No |

No analytics, advertising, marketing, selling or third-party sharing.
Traffic is encrypted in transit. Data access/correction/deletion contact:
`admin@bftmiddleeast.com`. Do not select “No data collected”: signed-in users
provide account and security data. Apple's
[privacy instructions](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
describe the console publication step. The labels have **not** been published
or verified by the IDE; this prevents a fully green submission report.

### TestFlight invitation and public-link flow

Manage the prepared group in
[PODIUM TestFlight](https://appstoreconnect.apple.com/apps/6812904157/testflight).
This is a management link, not a public installation link. After the real
tester is added, accept Apple's invitation on the device and install using
the TestFlight app or the invitation's redemption flow.

Internal groups do **not** have public join links. For a public link, an
external group must be created and the first build approved for external beta
testing; then enable its Public Link and share the generated
`https://testflight.apple.com/join/...` URL. No external group or beta-review
submission was created. See Apple's
[TestFlight guide](https://developer.apple.com/testflight/) and
[internal tester requirements](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers).

## API and screenshot tools

The API client uses Node's ES256 signing with a raw P1363 signature; no JWT
dependency is needed. Set `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` to the
existing team key, issuer and local `.p8` file. It reads the key in memory and
never prints tokens or key bytes. Optional `ASC_APP_ID` defaults to PODIUM.

```bash
node scripts/asc-api.mjs '/v1/builds?filter[app]=6812904157&include=buildBetaDetail,preReleaseVersion'
```

To deliberately recapture screenshots, make `playwright` and `sharp`
available, or set `PODIUM_CAPTURE_MODULES` to the bundled runtime's
`node_modules` directory. Chrome is the default; `PODIUM_CAPTURE_BROWSER`
can choose another installed Playwright browser channel.

```bash
node scripts/capture-store-screenshots.mjs "$HOME/podium-signing/store-assets/apple"
node scripts/upload-apple-screenshots.mjs "$HOME/podium-signing/store-assets/apple"
```

The uploader reserves assets, sends Apple's requested byte chunks and headers,
commits their MD5 checksums, polls delivery and orders the leaderboard pair.
It reuses completed identical images and refuses to replace differing files
without review. These tools never submit for review.

All six iOS and four Android GitHub secrets are already configured. Signing
material stays under `C:\Users\Alaa\podium-signing\ios\`; the distribution
certificate expires **17 September 2027**. Existing CSR/package scripts are
available for a deliberate future renewal, not for this release. The verified
[mobile-ios.yml](../.github/workflows/mobile-ios.yml) retains marketing version
1.0 and advances build numbers as `<run number>.<attempt>`. Reuse 2.1 now.

Announcements reach both shells through the live site. Production is still
manual/gated; see [MOBILE-DEPLOY.md](MOBILE-DEPLOY.md) for the prepared migration,
restart, smoke check and rollback steps. No production deployment was performed.
