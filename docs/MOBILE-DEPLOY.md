# PODIUM: prepared announcements deployment

**Preparation only.** Run this on the production VPS when the operator decides
to ship. It follows [OPERATIONS.md](OPERATIONS.md#production--hostinger-vps):
manual `/root/scripts/deploy.sh`, then the migration from the newly checked-out
commit, then restart `podium.service`. The native shells load the live site
and need no rebuild for this web feature.

The release includes `20260917030000_notifications`. It adds `Notification`
and `NotificationRead`; it does not rewrite competition scores or accounts.
The new inbox requires these tables even though `/api/health` can return 200
before they exist.

## Operator commands

Before shipping, confirm the intended `origin/main` commit has a successful
`podium/gates` status and take a fresh production database backup using the
existing VPS backup procedure. Verify the backup exists in `/opt/backups`
and record the current commit and retained working build for rollback.
The deploy script already enforces the gate; do not use `--force`.

As root on the VPS, with the existing production datasource environment
available to Prisma (`/opt/podium/.env` is read by `prisma7.config.ts`):

```bash
set -euo pipefail
/root/scripts/deploy.sh
cd /opt/podium
npx prisma migrate deploy
npx prisma migrate status
systemctl restart podium.service
systemctl is-active --quiet podium.service
curl --fail --silent --show-error https://podium.bftmiddleeast.com/api/health
curl --fail --silent --show-error --output /dev/null https://podium.bftmiddleeast.com/privacy
node scripts/smoke-mobile-release.mjs https://podium.bftmiddleeast.com
```

The existing deploy script restarts the new build before migrations; perform
this during a short maintenance window and run migration/restart immediately
after it completes. Never leave the new inbox serving without its tables.
No server-side deploy script was inspected or modified by this preparation.

The smoke script expects `/privacy` and `/results` 200, database health 200,
and guest `/api/notifications` 401. To also test a real signed-in inbox 200,
save the **Cookie header value only**, from a current production session, in
a private file outside the repository (restrict permissions to its owner):

```bash
PODIUM_SMOKE_COOKIE_FILE=/root/podium-signing/production-session-cookie.txt \
  node scripts/smoke-mobile-release.mjs https://podium.bftmiddleeast.com
```

The path is an example; create the private file deliberately and never commit
or paste its contents. The check prints no cookies, messages or account data,
validates private/no-store cookie-sensitive caching for the signed-in inbox,
and performs no read-receipt or announcement writes. Without a cookie file
it explicitly reports the authenticated check as skipped. Delete the file
after the check. A 401 here means the session is missing, expired or disabled;
a 500 suggests the migration or datasource needs attention.

## Functional smoke and rollback

After deployment, send one scoped test announcement as BFT MENA. Confirm a
recipient in that studio sees it and another studio does not. Mark it read,
reopen on a second device, repeat role/all audiences and English/Arabic, and
confirm a read-only role preview does not change unread state. Install the
existing internal Android/iOS builds to check the same flow in each shell.

The deploy script automatically restores its retained working build if its
post-restart health check fails. Migration and inbox checks happen afterward
and are **not covered** by that health rollback. If they fail, stop serving
the new feature and restore the recorded working build through the existing
VPS rollback procedure, then restart `podium.service` and check health/results.
Do not force a failed gate or repeatedly restart code against missing tables.

The migration is additive: an application rollback can leave these new
tables in place. Do not drop tables or edit `_prisma_migrations` to undo it.
For a failed/partial migration, inspect `prisma migrate status` and the error
before recovery. Restore the recorded database backup only if recovery
requires it; restoring replaces newer data and requires the operator's
explicit decision. No rollback or production database command was run here.
