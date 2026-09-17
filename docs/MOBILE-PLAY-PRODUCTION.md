# PODIUM: first public Google Play release

## Current handoff: version 3, 17 September 2026

This section supersedes the historical version 1 preparation below.

- Internal release `3 (1.0)` is live; its track and testers were left unchanged.
- Console automation worked without crashes in this session.
- Privacy policy URL verified saved: `https://podium.bftmiddleeast.com/privacy`.
- Ads verified saved: no ads.
- IARC verified completed: Everyone, PEGI 3, generic 3+; no new questionnaire needed.
- Health apps is already actioned with **Activity and fitness** selected and no
  medical features selected. It was inspected and left unchanged.
- App content still shows **3 declarations needing attention**.
- Sign-in instructions were entered exactly as requested, including that no
  demo credentials exist. Google rejected Add with "Your changes couldn't be
  saved" and flagged its required full-access checkbox. That checkbox says:
  "Sign-in details in this declaration provide full access to all the features
  and content within this app, including premium or paid content". It was not
  checked because invite-only email OTP instructions do not supply reviewer
  access. The rejected draft was discarded; no sign-in declaration was saved.
- Target audience is blocked by Google until sign-in details are completed.
  Intended groups: 13–15, 16–17, 18+; no under-13; not appealing to children;
  listing matches app. These answers have not been saved.
- Data safety was saved **as draft**, not submitted. All ten handling sections
  are complete: Name, Email, User IDs, Phone number, Other info (DOB/categories),
  Purchase history (registration fees), Fitness info (exercise competition scores),
  App interactions, Other user-generated content (staff notes/announcements), and
  Device or other IDs. Collected, not shared, not ephemeral; Phone number and
  staff content optional, other selected categories required; encrypted transport;
  no in-app account creation;
  external enterprise staff accounts; deletion request URL is the privacy page.
  Google blocks final Save until target audience is completed.
- Google Play does not expose Apple's "linked to identity" field in these
  handling forms. No identity-linkage answer was invented.
- The owner confirmed phone numbers, dates of birth, registration fees and
  team exercise competition scores. Local English/Arabic privacy text was updated
  to cover these and operational records; this change is **not deployed** yet.
- The owner authorized a live admin named **Google Play Review** using
  `google-play-review@bftmiddleeast.com`, then chose an account-specific OTP
  exception instead of disabling OTP globally. `OTP_EXEMPT_EMAILS` is implemented
  only after successful staff password verification. Twelve focused authentication
  tests, type checking and lint pass; the full suite passes **239 tests** and
  the production build succeeds. Provisioning helper:
  `scripts/create-play-review-account.mjs` (transactional user + audit record,
  random password printed once, no reset of existing accounts).
- **No reviewer account exists from this work yet** and no password has been
  generated. No live environment/database has been changed. The local `.env`
  connects to localhost and is not the live service. The production environment
  file and a usable server connection are still needed; no saved SSH connection
  or attached server terminal was available.
- Reviewer instructions prepared for use **after** creating and verifying the
  actual account (credentials go in the private fields, not this document):

  > Use staff sign-in with the review email/password provided. This review account
  > has full admin access and does not require email OTP or payment. Other accounts
  > are organizer-issued; no self-signup. The app records participant names,
  > contact emails/phones, DOB and registration fee records. Competition scores
  > compare teams' exercise performance during training. No medical features.
  > Public leaderboards/results are available without an account.

- Owner selected worldwide. Production country availability was saved for all
  176 listed countries/regions plus Rest of world. Publishing overview verifies
  both changes under "Changes not yet submitted for review". "Send app for
  review" is disabled until required app setup is complete.
- Production is inactive; no promotion was run and no review submission is claimed.
- No Apple changes, version changes, tester changes, listing saves or secret
  files were made in this session.

### Production script

`--production` promotes the already committed internal version read from
`android/app/build.gradle`, without rewriting internal testing or store assets.
For Qatar only, after completing App content and selecting Qatar in the console:

```powershell
node scripts/play-publish.mjs --production --countries=QA --dry-run
node scripts/play-publish.mjs --production --countries=QA
node scripts/play-publish.mjs --production --countries=QA --verify-only
```

For multiple countries, pass their explicit comma-separated two-letter codes.
Use `--include-rest-of-world` only if that option was deliberately selected in
the console. Worldwide requires selecting all supported countries in the console
and passing the corresponding explicit list; rest of world alone is not worldwide.

The script reads `/countryAvailability/production` and rejects any mismatch
before changing the production release. Google's API only permits release-level
`countryTargeting` on `inProgress` production releases, so a `completed` release
omits that field and uses the console's track availability. The availability API
is read-only. Production validation and commit are followed by verification in
a fresh edit; uncertain commits are not retried automatically. API `completed`
does not independently prove a review submission; inspect Publishing overview.

Validation: 21 focused publishing tests passed, script syntax check passed,
production dry run reads `3 (1.0)` and makes no API calls.

### Required console completion

1. Policy and programmes → App content → Sign-in details → Yes → Add details.
   Supply existing reusable reviewer/demo access to restricted screens, verify
   that it actually provides full access, then Add and Save. The current
   no-credentials instructions cannot meet Google's required attestation.
2. Target audience and content → select 13–15, 16–17, 18+; no children appeal;
   accurate listing → finish and Save.
3. Data safety → review the saved draft, resolve any additional collected data
   categories, confirm deletion instructions, then final Save. Check that App
   content has zero declarations needing attention.
4. Worldwide country setup is saved: all 176 countries/regions plus Rest of
   world. Do not replace this with Qatar-only targeting. The final API promotion
   must use the complete saved country list and `--include-rest-of-world`.
5. Run the production command above with that country list. If Google rejects
   the first production publication via API, use Production → Create new release
   → Add from library → select version 3 → release name `3 (1.0)` → Next →
   resolve console errors → Save. In Publishing overview, Send changes for
   review and verify the visible review status. Do not upload another AAB.

Google checks reviewer access, declared privacy/data practices, audience and
ratings, listing accuracy, app behavior and policy compliance. Review can take
a few hours to seven days, or longer in exceptional cases; the clock has not
started for this production release.

References: [track/countryTargeting API](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks),
[read-only country availability](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.countryavailability),
[review access requirements](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en),
[review timing](https://support.google.com/googleplay/android-developer/answer/9859654?hl=en-419).

## Historical version 1 preparation

The owner requested public distribution on 17 September 2026, superseding the
earlier internal-only restriction. Package: `app.podium.bftmena`. Reuse the
already uploaded signed versionCode 1, release `1 (1.0)`. Leave Apple unchanged.
Do not save the old unsaved browser listing draft or re-upload listing assets.

## Current preparation

- Internal version 1 was uploaded and its persisted hashes verified. The owner
  reported that installation and app operation worked.
- Privacy URL saved: `https://podium.bftmiddleeast.com/privacy`.
- Ads: no. Advertising ID: no. Government app: no.
- Financial-services features: none. Competition registration fee records are
  purchase history, not banking/wallet/lending features.
- Health declaration: activity and fitness; no medical functionality selected.
- Owner selected target audience 18+. Console requires sign-in details first.
- Owner explicitly approved IARC terms. Questionnaire saved with online sports
  content, no violence/sexual content/offensive language/drugs, no free user
  communication, age-restricted products, location sharing, digital purchases,
  cash rewards, browser/search-engine functionality, news or education focus.
  Calculated ratings: Everyone / PEGI 3 / generic 3+.
- Data safety is being prepared, not yet completed. Automatic approval review
  rejected saving the Name and Email handling answers without explicit owner
  confirmation of the disclosures. Do not bypass that rejection.
- Production has not been released or submitted for review.

## Data safety draft for owner confirmation

Grounding: `prisma/schema.prisma` (User, Competitor, Team, Score, Notification,
NotificationRead, security/audit records), authentication implementation and
the published privacy policy. Disclosure covers the controlled WebView as well
as the shell. No data is processed only ephemerally: these records are stored.
All listed data is collected; no third-party sharing is selected, following
the published policy and Google's service-provider/user-initiated exemptions.
TLS encryption is enabled. Requests for deletion use the privacy contact.

| Play data type | Evidence / purpose | Draft collection choice |
| --- | --- | --- |
| Name | Account names and mandatory competitor names; functionality/account management | Required |
| Email address | Account/competitor email; functionality/account management/sign-in security | Required |
| User IDs | Account identifiers and authenticated scope; functionality/account management/security | Required |
| Phone number | Optional competitor contact field; functionality | Optional |
| Other personal info | DOB, membership/language and required competition categories; functionality | Required overall because competition categories are mandatory |
| Purchase history | Registration amount/currency/payment status/billing reference; functionality | Required for registration records |
| Fitness info | Competition scores and athletic performance/results; functionality | Required for competition records |
| App interactions | Login/audit events and announcement read receipts; functionality/security | Required |
| Other user-generated content | Authorized staff-entered notes/announcements/team content; functionality/developer communications | Optional |
| Device or other IDs | Hashed device fingerprints and security identifiers; functionality/account management/security | Required |

These are proposed answers, not a claim that the Data safety declaration has
been submitted. The owner must confirm actual operations, especially collection
control, external services/sharing and any data practices outside the code.
Google requires required collection if any supported version requires it.

Accounts are provisioned by organizers rather than open self-registration.
The draft describes enterprise staff accounts and organizer-invited competitors.
No public account-creation flow is claimed. The privacy link supplies a data
deletion request contact; no automatic 90-day deletion or independent security
certification is claimed.

## Review access and distribution remaining

Google needs access to restricted staff/competitor areas. Provide a dedicated
review account and a way to complete OTP without access to the owner's inbox.
Never publish personal account credentials or disable OTP globally. Any demo
access must be isolated from real data and privileged production changes.

Finish target audience, category/contact details, country availability and any
remaining declarations. Prepare the production release using the existing
bundle, verify warnings and submit to Google review. Only a verified review
status supports a statement that submission succeeded; public visibility
depends on Google's approval and supported country/device eligibility.

Sources: [review requirements](https://support.google.com/googleplay/android-developer/answer/9859455),
[Data safety definitions](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en-GB),
[account deletion](https://support.google.com/googleplay/android-developer/answer/13327111),
[IARC terms](https://web.iarcservices.com/terms).
