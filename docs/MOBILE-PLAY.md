# PODIUM: remaining Google Play human steps

Return to [MOBILE.md](MOBILE.md) for the native shell architecture and builds.
The Play record already exists for `app.podium.bftmena` under **TRUST CREATIVES**.
The existing signed `C:\Users\Alaa\podium-signing\app-release.aab` is versionCode
**1**. Use it for the first internal-testing upload; do not change its version
or regenerate signing keys for this step.

## Main store listing

The browser's previously typed description text was unsaved. Preserve these
texts exactly and save the listing after uploading the assets.

Short description:

```text
Live leaderboards, scores and results for the PODIUM BFT MENA series.
```

Full description:

```text
PODIUM is the official live companion for the BFT MENA competition series.

Follow every wave as it happens: the leaderboards update live while each event runs,
so you always know who is on the podium.

- Live leaderboards: standings refresh while the competition is running
- Every category and division: Womens, Mens and Mixed across Rookie, Open and Pro
- Find your team fast: search by team and filter by studio
- Published results: revisit the final standings of every finished competition
- Four studios, one series: Corniche, Gharrafa, The Pearl and West Walk

No account is needed to follow the results. No ads, no tracking - just the competition.

For competitors, coaches, studios and fans of BFT MENA: from the first wave to the
final podium, PODIUM keeps the whole series in your pocket.
```

In **Play Console → Main store listing**, upload these five files from
`C:\Users\Alaa\podium-signing\store-assets\`, then choose **Save**:

| Listing field | File |
| --- | --- |
| App icon | `app-icon-512.png` (512 × 512) |
| Feature graphic | `feature-graphic.jpg` (1024 × 500) |
| Phone screenshots | `phone-1-womens-rookie.png`, `phone-2-mens-pro.png` (1080 × 1920) |
| 7-inch tablet screenshot | `tablet-1-womens-rookie.png` (1920 × 1080) |

## App content

In **Play Console → App content**, complete the supplied declarations:

- Privacy policy URL: `https://podium.bftmiddleeast.com/privacy`.
- Ads: **No**.
- Data safety: collects **Email** and **Name** for accounts; **Device ID** for
  app functionality / security only. Email and Name are linked to identity.
  No tracking or analytics; encrypted in transit; no sharing; no selling;
  deletion requests via `admin@bftmiddleeast.com`.

These are the release brief's declarations for the human to enter and check
against the production policy, rather than an automated console submission.

## Internal testing

In **Testing → Internal testing**, create a release, upload the existing signed
`app-release.aab`, add tester email addresses and save/publish the internal test
according to the console prompts. Install using the test opt-in link. Confirm
public results, staff sign-in, announcements and read persistence after the
gated web deployment. The IDE does not perform these console steps.

## Automation status — 17 September 2026

The existing signed AAB and listing assets remain ready. Store-listing asset
upload/Save, App content declarations, and the internal-testing release with
real tester emails are still human tasks. No Play Console write was made.
Play Developer API access / a linked service-account credential has not been
provided for this task. If future API automation is wanted, the Account Holder
must first enable/link the API and grant that account app access; this does
not block the human console release. Keep the first AAB versionCode **1**.

Apple's existing build is ready for internal testing; see
[MOBILE-APPLE.md](MOBILE-APPLE.md). Announcements production steps are prepared
in [MOBILE-DEPLOY.md](MOBILE-DEPLOY.md); the production deployment remains manual.
