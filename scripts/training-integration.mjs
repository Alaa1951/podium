/** Local MySQL integration. Creates/drops ONLY a randomly named test schema. No live connection. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import mariadb from 'mariadb';
import { readDbCredentials } from './db-credentials.mjs';
import { fingerprint } from './training-copy-core.mjs';
process.loadEnvFile();
const schemaIndex = process.argv.indexOf('--baseline-sql');
if (schemaIndex < 0) throw new Error('--baseline-sql <pre-migration schema SQL> is required');
const credentials = readDbCredentials();
if (!['localhost', '127.0.0.1', '::1'].includes(credentials.host)) throw new Error('LOCAL_DATABASE_ONLY');
const name = 'pudem_training_test_' + randomUUID().replaceAll('-', '').slice(0, 12);
const db = await mariadb.createConnection({ host: credentials.host, user: credentials.user, password: credentials.password, port: Number(credentials.port), allowPublicKeyRetrieval: true, multipleStatements: true, timezone: 'Z' });
const query = (sql, params) => db.query(sql, params);
const cli = (script, args) => spawnSync(process.execPath, ['scripts/' + script, ...args], { encoding: 'utf8', env: { ...process.env, MYSQL_DATABASE: name } });
const copyArgs = ['--source', 'podium-bft-series-1', '--target', 'training'];
const graph = async id => ({
  series: Array.from(await query('SELECT * FROM Series WHERE id=?', [id])),
  teams: Array.from(await query('SELECT * FROM Team WHERE seriesId=? ORDER BY id', [id])),
  seats: Array.from(await query('SELECT * FROM Competitor WHERE teamId IN (SELECT id FROM Team WHERE seriesId=?) ORDER BY id', [id])),
  scores: Array.from(await query('SELECT * FROM Score WHERE teamId IN (SELECT id FROM Team WHERE seriesId=?) ORDER BY id', [id])),
  values: Array.from(await query('SELECT * FROM ZoneEntry WHERE scoreId IN (SELECT id FROM Score WHERE teamId IN (SELECT id FROM Team WHERE seriesId=?)) ORDER BY id', [id])),
  locks: Array.from(await query('SELECT * FROM ZoneScore WHERE scoreId IN (SELECT id FROM Score WHERE teamId IN (SELECT id FROM Team WHERE seriesId=?)) ORDER BY id', [id])),
  audits: Array.from(await query('SELECT * FROM ScoreAudit WHERE scoreId IN (SELECT id FROM Score WHERE teamId IN (SELECT id FROM Team WHERE seriesId=?)) ORDER BY id', [id])),
  entries: Array.from(await query('SELECT * FROM SeriesParticipant WHERE seriesId=? ORDER BY id', [id])),
  requests: Array.from(await query('SELECT * FROM PartnerRequest WHERE seriesId=? ORDER BY id', [id])),
  waves: Array.from(await query('SELECT * FROM Wave WHERE seriesId=? ORDER BY id', [id])),
});
try {
  await query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await query('USE `' + name + '`');
  await query(fs.readFileSync(process.argv[schemaIndex + 1], 'utf8'));
  await query("INSERT INTO Series (id,name,slug,competitionDate,status,updatedAt) VALUES ('source','Podium BFT Series 1','podium-bft-series-1','2026-10-01','live',NOW(3)),('target','Training','training','2026-10-02','scheduled',NOW(3))");
  await query("INSERT INTO User (id,email,name,role,status,requestedSeriesId,updatedAt) VALUES ('a','a@bftmena.com','Athlete A','competitor','active','source',NOW(3)),('b','b@example.com','Athlete B','competitor','active','source',NOW(3)),('solo','solo@example.com','Solo','competitor','active','source',NOW(3)),('test','test@bftmena.com','Test','competitor','active','target',NOW(3)),('admin','admin@bftmena.com','Admin','admin','active',NULL,NOW(3))");
  await query("INSERT INTO AthleteProfile(id,userId,division,category,partnerUserId,updatedAt) VALUES ('ap-a','a','Open','Mixed','b',NOW(3)),('ap-b','b','Open','Mixed','a',NOW(3)),('ap-solo','solo','Rookie','Mixed',NULL,NOW(3))");
  await query("INSERT INTO Team(id,seriesId,number,name,category,division,paymentStatus,amountMinor,updatedAt) VALUES ('original','source',101,'Original','Mixed','Open','paid',10000,NOW(3)),('old-test','target',101,'Old test','Mixed','Open','pending',NULL,NOW(3))");
  await query("INSERT INTO Competitor(id,teamId,position,fullName,normalizedName,email,userId) VALUES ('seat-a','original',1,'Athlete A','athlete a','a@bftmena.com','a'),('seat-b','original',2,'Athlete B','athlete b','b@example.com','b'),('old-seat','old-test',1,'Test','test','test@bftmena.com','test')");
  await query("INSERT INTO Team(id,seriesId,number,name,category,division,paymentStatus,amountMinor,updatedAt) VALUES ('imported','source',102,'Imported pair','Mixed','Open','paid',10000,NOW(3))");
  await query("INSERT INTO Competitor(id,teamId,position,fullName,normalizedName,email) VALUES ('import-a','imported',1,'Imported A','imported a','purchaser@example.com'),('import-b','imported',2,'Imported B','imported b','purchaser@example.com')");
  await query("INSERT INTO Score(id,teamId,status,updatedAt) VALUES ('real-score','original','submitted',NOW(3)),('old-score','old-test','draft',NOW(3))");
  await query("INSERT INTO Zone(id,seriesId,number,name) VALUES ('source-zone','source',1,'Strength'),('target-zone','target',1,'Strength')");
  await query("INSERT INTO ZoneInput(id,zoneId,position,label) VALUES ('source-input','source-zone',1,'Reps'),('target-input','target-zone',1,'Reps')");
  await query("INSERT INTO ZoneEntry(id,scoreId,inputId,value) VALUES ('source-value','real-score','source-input',99),('old-value','old-score','target-input',5)");
  await query("INSERT INTO ZoneScore(id,scoreId,zoneId,status,updatedAt) VALUES ('source-lock','real-score','source-zone','submitted',NOW(3)),('old-lock','old-score','target-zone','draft',NOW(3))");
  await query("INSERT INTO ScoreAudit(id,scoreId,field,oldValue,newValue) VALUES ('source-audit','real-score','reps','98','99'),('old-audit','old-score','reps','4','5')");
  await query("INSERT INTO PartnerRequest(id,fromUserId,toUserId,pairKey,openPairKey,status) VALUES ('request','a','b','a:b','a:b','pending')");
  const originalRows = async () => {
    const tables = ['User', 'Team', 'Competitor', 'Score', 'AthleteProfile'];
    return Promise.all(tables.map(t => query('SELECT * FROM `' + t + '` ORDER BY id').then(r => Array.from(r))));
  };
  const old = fingerprint(await originalRows());
  await query(fs.readFileSync('prisma/migrations/20260924120000_series_participants/migration.sql', 'utf8'));
  assert.equal(fingerprint(await originalRows()), old, 'migration must not change identity, registration, payment or result rows');
  assert.equal(Number((await query("SELECT COUNT(*) AS c FROM SeriesParticipant WHERE seriesId='source'"))[0].c), 3);
  assert.equal((await query("SELECT seriesId FROM PartnerRequest WHERE id='request'"))[0].seriesId, 'source');
  const sourceBefore = fingerprint(await graph('source'));
  const targetBefore = fingerprint(await graph('target'));
  let r = cli('copy-training.mjs', copyArgs); assert.equal(r.status, 0, r.stderr);
  assert.equal(fingerprint(await graph('target')), targetBefore, 'dry-run writes nothing');
  r = cli('copy-training.mjs', [...copyArgs, '--apply', '--confirm-target-id', 'source', '--mark-training']); assert.notEqual(r.status, 0);
  assert.equal(fingerprint(await graph('target')), targetBefore);
  await query("CREATE TRIGGER fail_training_insert BEFORE INSERT ON Competitor FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TEST_ROLLBACK'");
  r = cli('copy-training.mjs', [...copyArgs, '--apply', '--confirm-target-id', 'target', '--mark-training']); assert.notEqual(r.status, 0);
  assert.equal(fingerprint(await graph('target')), targetBefore, 'failed copy rolls back deletion and all inserts');
  await query('DROP TRIGGER fail_training_insert');
  r = cli('copy-training.mjs', [...copyArgs, '--apply', '--confirm-target-id', 'target', '--mark-training']); assert.equal(r.status, 0, r.stderr);
  const result = r.stdout.trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).find(row => row?.applied);
  assert.ok(result?.rollback);
  const copied = await graph('target');
  assert.equal(copied.teams.length, 2); assert.equal(copied.entries.length, 3); assert.equal(copied.seats.length, 4); assert.equal(copied.scores.length, 0);
  assert.equal(copied.teams[0].paymentStatus, 'paid'); assert.equal(copied.teams[0].waveId, null);
  assert.deepEqual(copied.seats.filter(c => c.userId).map(c => c.userId).sort(), ['a', 'b']);
  assert.equal(copied.seats.filter(c => c.email === 'purchaser@example.com' && c.userId === null).length, 2, 'shared contact email never merges imported athlete seats');
  assert.equal(fingerprint(await graph('source')), sourceBefore, 'source remains identical after cloning');
  await query("INSERT INTO Score(id,teamId,status,updatedAt) VALUES ('trial-score',?,'submitted',NOW(3))", [copied.teams[0].id]);
  await query("INSERT INTO ZoneEntry(id,scoreId,inputId,value) VALUES ('trial-result','trial-score','target-input',42)");
  await query("UPDATE Team SET paymentStatus='pending' WHERE seriesId='target'");
  const trial = await graph('target');
  assert.equal(fingerprint(await graph('source')), sourceBefore, 'training score and payment changes leave source untouched');
  r = cli('copy-training.mjs', [...copyArgs, '--apply', '--confirm-target-id', 'target', '--mark-training']); assert.notEqual(r.status, 0, 're-run must refuse to erase test progress');
  assert.equal(fingerprint(await graph('target')), fingerprint(trial));
  r = cli('copy-training.mjs', ['--source','training','--target','podium-bft-series-1','--apply','--confirm-target-id','source','--mark-training']); assert.notEqual(r.status,0);
  if (process.argv.includes('--ui')) await (await import('./training-browser.mjs')).verifyTrainingBrowser(name, query);
  r = cli('cleanup-training-users.mjs', ['--target','training']); assert.equal(r.status,0,r.stderr);
  assert.equal((await query("SELECT status FROM User WHERE id='test'"))[0].status,'active');
  r = cli('cleanup-training-users.mjs', ['--target','training','--apply','--confirm-domain','bftmena.com']); assert.equal(r.status,0,r.stderr);
  assert.equal((await query("SELECT status FROM User WHERE id='test'"))[0].status,'disabled');
  assert.equal((await query("SELECT status FROM User WHERE id='a'"))[0].status,'active');
  assert.equal((await query("SELECT status FROM User WHERE id='admin'"))[0].status,'active');
  assert.equal(fingerprint(await graph('source')), sourceBefore, 'cleanup must preserve every source competition row');
  await query(fs.readFileSync(result.rollback,'utf8'));
  assert.equal(fingerprint(await graph('target')), targetBefore, 'scoped rollback restores old Training exactly');
  assert.equal(fingerprint(await graph('source')), sourceBefore);
  console.log('PASS: migration, dry-run, target guards, injected failure rollback, shared users, independent scores/payments, repeat protection, protected domain cleanup, exact scoped restore, source fingerprints.');
} finally {
  // The only drop target was generated here and was never supplied through env/arguments.
  if (!/^pudem_training_test_[a-f0-9]{12}$/.test(name)) throw new Error('INVALID_TEST_SCHEMA');
  await query('DROP DATABASE IF EXISTS `' + name + '`'); await db.end();
}
