# PODIUM: Apple signing and TestFlight

This completes the iOS path described in [MOBILE.md](MOBILE.md). The native
shell continues to open the live site. The bundle ID is `app.podium.bftmena`,
Apple team is `VSXS43495X`, and the existing App Store Connect record is
**PODIUM — BFT MENA**, app ID `6812904157`, SKU `PODIUM-001`, English (U.K.).
Keep marketing version **1.0**. No new app record or identifier is needed.

## 1. Generate the CSR on Windows

From Git Bash in `D:/pudem`:

```bash
bash scripts/make-ios-csr.sh
```

Outputs live outside the repository, under `~/podium-signing/ios/`
(`C:\Users\Alaa\podium-signing\ios` on this machine):

- `podium-distribution.key`: private RSA key, retain securely.
- `podium-distribution.csr`: upload this CSR to Apple.

The CSR subject is `CN=PODIUM Distribution, O=BFT MENA, C=QA`. The script
refuses to overwrite an existing key or CSR. Reuse that CSR if already generated;
the certificate must match its private key. `IOS_SIGNING_DIR` can override the
directory for an isolated test or a deliberate future renewal.

## 2. Human step: create the distribution certificate

With MAHMOUD MANNAA (Account Holder), or an Admin with certificate access:

1. Open [Apple Developer account](https://developer.apple.com/account/).
   Select team `VSXS43495X` and open **Certificates, Identifiers & Profiles**.
2. **Certificates → + → Apple Distribution → Continue**. This is a distribution
   certificate, not an Apple Development or Developer ID certificate.
3. Upload `podium-distribution.csr`, then **Continue** and **Download**.
4. Save the downloaded `.cer` in `~/podium-signing/ios/`, for example as
   `distribution.cer`.

Apple downloads a `.cer`, not a `.p12`. The companion script below combines
the downloaded certificate with the local private key to create the `.p12`.

## 3. Human step: create the App Store profile

1. In the same team, open **Profiles → +**.
2. Under **Distribution**, choose **App Store Connect** (older UI labels may
   say App Store), then **Continue**.
3. Select the existing explicit App ID `app.podium.bftmena`.
4. Select the **Apple Distribution certificate created from this CSR**.
5. Name the profile exactly **PODIUM AppStore**, then **Generate → Download**.
6. Save it as `~/podium-signing/ios/PODIUM_AppStore.mobileprovision`.

The workflow validates profile name, team, bundle ID, expiration, distribution
type and its certificate's match to the imported private key before archiving.
See Apple's [profile creation steps](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile).

## 4. Human step: create the App Store Connect API key

1. Open [App Store Connect](https://appstoreconnect.apple.com/), using the account
   holding the existing PODIUM record.
2. Open **Users and Access → Integrations → App Store Connect API → Team Keys**.
3. If API access has not been enabled, the Account Holder first requests access.
4. Choose **+**, name it `PODIUM CI`, and select **Admin** access.
5. Generate the team key. Record its **Key ID** and the page's **Issuer ID**.
   Use a team key, since this workflow authenticates with both IDs.
6. Download `AuthKey_<KEY_ID>.p8` into `~/podium-signing/ios/` and back it up
   securely. Apple allows this private key download only once.

See Apple's [API key instructions](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api).

## 5. Package the signing secrets

From Git Bash, substitute the actual API key filename:

```bash
bash scripts/package-ios-signing.sh \
  "$HOME/podium-signing/ios/distribution.cer" \
  "$HOME/podium-signing/ios/PODIUM_AppStore.mobileprovision" \
  "$HOME/podium-signing/ios/AuthKey_<KEY_ID>.p8"
```

The script verifies the certificate is unexpired and matches the CSR key,
prompts twice for a non-empty P12 password, and creates
`~/podium-signing/ios/podium-distribution.p12` with explicit Apple Keychain-compatible
P12 encryption and MAC algorithms. It writes single-line base64
secret files in `~/podium-signing/ios/github-secrets/`. It prints filenames,
never the password or base64 contents. The API key argument is optional if it
has not been downloaded yet; encode it later with:

```bash
base64 < "$HOME/podium-signing/ios/AuthKey_<KEY_ID>.p8" | tr -d '\r\n' \
  > "$HOME/podium-signing/ios/github-secrets/ASC_API_KEY_P8_BASE64.txt"
```

In **Alaa1951/podium → Settings → Secrets and variables → Actions → New
repository secret**, add these **six repository secrets** (not variables):

| Secret name | Exact value |
| --- | --- |
| `IOS_DIST_P12_BASE64` | Contents of `github-secrets/IOS_DIST_P12_BASE64.txt` |
| `IOS_DIST_P12_PASSWORD` | The password supplied to the packaging script |
| `IOS_PROVISION_PROFILE_BASE64` | Contents of `github-secrets/IOS_PROVISION_PROFILE_BASE64.txt` |
| `ASC_KEY_ID` | Team API key's Key ID |
| `ASC_ISSUER_ID` | Team API key's Issuer ID |
| `ASC_API_KEY_P8_BASE64` | Contents of `github-secrets/ASC_API_KEY_P8_BASE64.txt` |

Alternatively, after `gh auth login`, upload the three encoded files without
printing them in the terminal:

```bash
for name in IOS_DIST_P12_BASE64 IOS_PROVISION_PROFILE_BASE64 ASC_API_KEY_P8_BASE64; do
  gh secret set "$name" --repo Alaa1951/podium \
    < "$HOME/podium-signing/ios/github-secrets/$name.txt"
done
gh secret set IOS_DIST_P12_PASSWORD --repo Alaa1951/podium
gh secret set ASC_KEY_ID --repo Alaa1951/podium
gh secret set ASC_ISSUER_ID --repo Alaa1951/podium
```

Those last three commands request the values interactively. Keys, passwords,
profiles, certificates and encoded files stay outside Git. The public
[ExportOptions.plist](../ios/App/ExportOptions.plist) contains only the team,
signing method and bundle-to-profile mapping.

## 6. Run the iOS workflow

The workflow must first be committed and pushed to the repository's default
branch so GitHub can discover its manual trigger. This does not deploy the
website; its existing gates and manual deployment remain in place.

```bash
gh workflow run mobile-ios.yml --repo Alaa1951/podium --ref main
gh run list --repo Alaa1951/podium --workflow mobile-ios.yml --limit 5
gh run watch <RUN_ID> --repo Alaa1951/podium --exit-status
```

Or use **Actions → mobile-ios → Run workflow**. Pushing an explicitly chosen
`ios-v*` tag also triggers it.

[mobile-ios.yml](../.github/workflows/mobile-ios.yml) uses `macos-15`, stable
Xcode 26, Node 24, `npm ci`, and Capacitor sync. Apple currently requires Xcode
26 or later and the iOS 26 SDK or later for uploads; the runner must provide
this toolchain ([Apple requirement](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)).
CI creates a temporary keychain, imports the certificate, installs the profile,
imports Apple's WWDR G3 intermediate from its certificate authority, and
configures **only the App Release target** for manual distribution signing.
Swift Package Manager dependencies retain their own signing configuration.
It archives with signing enabled, verifies the app signature, exports with
`method=app-store-connect`, and uploads the IPA using Apple's built-in
`xcrun altool --upload-package` with App Store Connect API-key authentication.
It inspects the installed altool help for the supported platform/authentication
spellings, using `--type ios-app-store` where available or the tool's iOS
platform spelling on other versions. See Apple's
[upload tools](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds).
No extra upload dependency or unsigned archive is used.

The CI-only build number is `<workflow run number>.<run attempt>` (for example
`1.1`, retry `1.2`); version stays `1.0` and Android versions stay unchanged.
After a newer build has uploaded, start a **new workflow run**, rather than
retrying an older run whose build number would be lower. Downloadable IPA and
dSYM artifacts are retained for 14 days. Signing files and API private key are
removed in an `always()` cleanup step.

## 7. Confirm TestFlight and test the shell

1. After upload succeeds, wait for Apple's processing. Upload success alone
   does not establish TestFlight visibility.
2. Open **My Apps → PODIUM — BFT MENA → TestFlight → iOS**. Confirm version
   **1.0** and the build number shown in the workflow summary.
3. Resolve any export-compliance questions presented by App Store Connect.
4. Add the build to an internal testing group and install it on a real iPhone.
5. Verify results open, sign-in works, the bell shows an addressed announcement,
   and marking it read survives reopening the app. Test airplane-mode fallback
   and Arabic layout too. External testers may require beta review.

These browser steps are human tasks. This workflow uploads for TestFlight; it
does not submit the app for production App Store review.

## Release status and web feature deployment

The workflow can only run after GitHub authentication, publication of the
workflow and installation of all six valid secrets. Certificate/profile and
API-key creation remain with the human account holder. macOS signing, export,
upload and TestFlight visibility cannot be verified from the Windows workspace.

The in-app announcements implementation and its migration ship through a
normal gated web deployment. Follow [MOBILE.md](MOBILE.md#in-app-announcements)
for migration and smoke checks; both store shells then receive the same feature.
