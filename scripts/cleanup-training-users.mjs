/** Archive exact-domain test accounts using the app's reversible deletion convention. */
import fs from 'node:fs';
import path from 'node:path';
import mariadb from 'mariadb';
import { readDbCredentials, requirePassword, redactSecrets } from './db-credentials.mjs';
import { isTestAddress, json } from './training-copy-core.mjs';
try { process.loadEnvFile(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const args = process.argv.slice(2), flag = n => args[args.indexOf('--' + n) + 1];
if (!args.includes('--target') || !flag('target')) throw new Error('--target <training slug> is required');
const apply = args.includes('--apply');
if (apply && flag('confirm-domain') !== 'bftmena.com') throw new Error('--confirm-domain bftmena.com is required');
const credentials = requirePassword(readDbCredentials());
const db = await mariadb.createConnection({ host: credentials.host, user: credentials.user, password: credentials.password, database: credentials.database, allowPublicKeyRetrieval: ["localhost", "127.0.0.1", "::1"].includes(credentials.host), port: Number(credentials.port), timezone: 'Z', connectTimeout: 5000 });
try {
  await db.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  await db.beginTransaction();
  const target = (await db.query('SELECT id FROM Series WHERE slug = ? AND isTraining = 1 AND archivedAt IS NULL FOR UPDATE', [flag('target')]))[0];
  if (flag('target') === 'podium-bft-series-1') throw new Error('PROTECTED_LIVE_COMPETITION');
  if (!target) throw new Error('VERIFIED_TRAINING_TARGET_REQUIRED');
  const users = Array.from(await db.query("SELECT * FROM User WHERE LOWER(TRIM(email)) LIKE '%@bftmena.com' AND archivedAt IS NULL FOR UPDATE"));
  const references = await db.query("SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'User'");
  const accountOwned = new Set(['Account', 'OtpChallenge', 'TrustedDevice', 'LoginEvent', 'AuthToken', 'NotificationRead']);
  const eligible = [], protectedAccounts = [];
  for (const user of users) {
    const reasons = [];
    if (!isTestAddress(user.email)) reasons.push('DOMAIN_MISMATCH');
    if (user.role !== 'competitor') reasons.push('STAFF_OR_ADMIN');
    if (user.requestedSeriesId && user.requestedSeriesId !== target.id) reasons.push('OTHER_SIGNUP');
    // Include unlinked registrations and named partners, not just foreign keys.
    if ((await db.query('SELECT c.id FROM Competitor c JOIN Team t ON t.id=c.teamId WHERE LOWER(TRIM(c.email))=LOWER(TRIM(?)) AND t.seriesId<>? LIMIT 1', [user.email, target.id])).length) reasons.push('OTHER_COMPETITION_EMAIL');
    if ((await db.query('SELECT id FROM SeriesParticipant WHERE LOWER(TRIM(partnerEmail))=LOWER(TRIM(?)) AND seriesId<>? LIMIT 1', [user.email, target.id])).length) reasons.push('OTHER_PARTNER_EMAIL');
    for (const { tbl, col } of references) {
      if (accountOwned.has(tbl) || (tbl === 'AthleteProfile' && col === 'userId')) continue;
      if (tbl === 'UserAccessRole' && col === 'userId') {
        if ((await db.query("SELECT 1 FROM UserAccessRole ur JOIN AccessRole ar ON ar.id=ur.accessRoleId WHERE ur.userId=? AND ar.key <> 'athlete' LIMIT 1", [user.id])).length) reasons.push('PRIVILEGED_ROLE');
        continue;
      }
      let extra = ''; const params = [user.id];
      if (['SeriesParticipant', 'Team', 'PartnerRequest'].includes(tbl)) { extra = ' AND (seriesId IS NULL OR seriesId<>?)'; params.push(target.id); }
      if (tbl === 'Competitor') { extra = ' AND teamId IN (SELECT id FROM Team WHERE seriesId<>?)'; params.push(target.id); }
      if ((await db.query(`SELECT 1 FROM \`${tbl}\` WHERE \`${col}\`=?${extra} LIMIT 1`, params)).length) reasons.push(`${tbl}.${col}`);
    }
    if (reasons.length) protectedAccounts.push({ id: user.id, reasons }); else eligible.push(user);
  }
  const report = { targetId: target.id, matching: users.length, eligible: eligible.map(u => u.id), protected: protectedAccounts, mode: 'archive-and-disable' };
  console.log(json(report));
  if (!apply) { await db.rollback(); console.log('DRY RUN — no accounts changed.'); }
  else {
    const dir = path.resolve('db-backups'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'training-test-accounts-' + Date.now() + '.json');
    fs.writeFileSync(file, json({ report, users: eligible }), { flag: 'wx', mode: 0o600 });
    for (const user of eligible) await db.query("UPDATE User SET archivedAt=NOW(3), status='disabled', updatedAt=NOW(3) WHERE id=? AND role='competitor' AND LOWER(TRIM(email)) LIKE '%@bftmena.com'", [user.id]);
    await db.commit(); console.log(json({ archived: eligible.length, protected: protectedAccounts.length, backup: file }));
  }
} catch (e) { await db.rollback(); console.error(redactSecrets(e.message, credentials)); process.exitCode = 1; }
finally { await db.end(); }
