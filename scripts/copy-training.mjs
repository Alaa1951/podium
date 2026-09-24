/**
 * One-time same-database rehearsal copy. Defaults to dry-run.
 * node scripts/copy-training.mjs --source <slug> --target <slug>
 * node scripts/copy-training.mjs --source <slug> --target <slug> --apply --confirm-target-id <id> --mark-training
 * Does not create or update accounts, or write anything in the source competition.
 */
import fs from 'node:fs';
import path from 'node:path';
import mariadb from 'mariadb';
import { readDbCredentials, requirePassword, redactSecrets } from './db-credentials.mjs';
import { assertTargets, planCopy, fingerprint, json } from './training-copy-core.mjs';
try { process.loadEnvFile(path.join(process.cwd(), '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf('--' + name); return i < 0 ? null : args[i + 1]; };
const sourceSlug = flag('source'), targetSlug = flag('target'), apply = args.includes('--apply');
if (!sourceSlug || !targetSlug) throw new Error('Name both --source and --target. No implicit competition is allowed.');
const credentials = requirePassword(readDbCredentials());
const conn = await mariadb.createConnection({ host: credentials.host, user: credentials.user, password: credentials.password, database: credentials.database, allowPublicKeyRetrieval: ["localhost", "127.0.0.1", "::1"].includes(credentials.host), port: Number(credentials.port), connectTimeout: 5000, timezone: 'Z' });
// Every row below is selected through its owning competition. Table names are fixed.
async function snapshot(id, locked = false) {
  const sub = 'SELECT id FROM Team WHERE seriesId = ?';
  const scoreSub = `SELECT id FROM Score WHERE teamId IN (${sub})`;
  const seatSub = `SELECT id FROM Competitor WHERE teamId IN (${sub})`;
  const rows = (table, where, values = [id]) => conn.query(`SELECT * FROM \`${table}\` WHERE ${where} ORDER BY id${locked ? " FOR UPDATE" : ""}`, values).then(r => Array.from(r));
  return {
    Series: await rows('Series', 'id = ?'),
    Team: await rows('Team', 'seriesId = ?'),
    Competitor: await rows('Competitor', `teamId IN (${sub})`),
    Score: await rows('Score', `teamId IN (${sub})`),
    ZoneEntry: await rows('ZoneEntry', `scoreId IN (${scoreSub})`),
    ZoneScore: await rows('ZoneScore', `scoreId IN (${scoreSub})`),
    ScoreAudit: await rows('ScoreAudit', `scoreId IN (${scoreSub})`),
    Wave: await rows('Wave', 'seriesId = ?'),
    CrmIntake: await rows('CrmIntake', 'seriesId = ?'),
    SeriesParticipant: await rows('SeriesParticipant', 'seriesId = ?'),
    PartnerRequest: await rows('PartnerRequest', 'seriesId = ?'),
    PortraitJob: await rows('PortraitJob', `teamId IN (${sub}) OR competitorId IN (${seatSub})`, [id, id]),
    CompetitorPortrait: await rows('CompetitorPortrait', `competitorId IN (${seatSub})`),
    TeamPortrait: await rows('TeamPortrait', `teamId IN (${sub})`),
  };
}
async function insert(table, row) {
  const keys = Object.keys(row);
  await conn.query(`INSERT INTO \`${table}\` (${keys.map(k => '`' + k + '`').join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => {
    const v = row[k]; return v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) ? json(v) : v;
  }));
}
try {
  await conn.beginTransaction();
  // Only lock the target. Source is a consistent read, so live score entry keeps running.
  const source = (await conn.query('SELECT * FROM Series WHERE slug = ?', [sourceSlug]))[0];
  const target = (await conn.query('SELECT * FROM Series WHERE slug = ? FOR UPDATE', [targetSlug]))[0];
  assertTargets(source, target, flag('confirm-target-id'));
  if (process.env.CRM_SYNC_ENABLED === '1' && process.env.CRM_SYNC_SERIES === target.slug) throw new Error('CRM_TARGET_IS_TRAINING');
  const beforeSource = await snapshot(source.id), beforeTarget = await snapshot(target.id, true);
  const plan = planCopy(beforeSource, target.id);
  const report = {
    database: `${credentials.host}:${credentials.port}/${credentials.database}`,
    source: { id: source.id, name: source.name, slug: source.slug },
    target: { id: target.id, name: target.name, slug: target.slug, isTraining: Boolean(target.isTraining) },
    delete: Object.fromEntries(Object.entries(beforeTarget).filter(([k]) => k !== 'Series').map(([k, rows]) => [k, rows.length])),
    copy: Object.fromEntries(Object.entries(plan).map(([k, rows]) => [k, rows.length])),
    usersCreated: 0, usersDeleted: 0, scoresCopied: 0,
    unlinkedSharedEmailGroups: [...new Set(plan.Competitor.filter(c => !c.userId && c.email).map(c => c.email.trim().toLowerCase()))].filter(email => plan.Competitor.filter(c => c.email?.trim().toLowerCase() === email).length > 1).length,
    sourceFingerprint: fingerprint(beforeSource), targetFingerprint: fingerprint(beforeTarget),
  };
  console.log(json(report));
  if (!apply) { await conn.rollback(); console.log('DRY RUN — no data changed.'); }
  else {
    if (flag('confirm-target-id') !== target.id) throw new Error('APPLY_REQUIRES_EXACT_TARGET_ID');
    if (!target.isTraining && !args.includes('--mark-training')) throw new Error('APPLY_REQUIRES_MARK_TRAINING');
    if (await conn.query("SELECT id FROM PortraitJob WHERE status = 'running' AND (teamId IN (SELECT id FROM Team WHERE seriesId = ?) OR competitorId IN (SELECT id FROM Competitor WHERE teamId IN (SELECT id FROM Team WHERE seriesId = ?)))", [target.id, target.id]).then(r => r.length)) throw new Error('TRAINING_PORTRAIT_JOB_RUNNING');
    // A scoped SQL rollback and manifest are saved before the first delete.
    const dir = path.resolve('db-backups'); fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const base = path.join(dir, `training-${target.id}-${stamp}`);
    fs.writeFileSync(base + '.json', json({ version: 1, report, beforeTarget }), { mode: 0o600, flag: 'wx' });
    const deleteTarget = [
      `DELETE FROM PortraitJob WHERE teamId IN (SELECT id FROM Team WHERE seriesId = ${conn.escape(target.id)}) OR competitorId IN (SELECT id FROM Competitor WHERE teamId IN (SELECT id FROM Team WHERE seriesId = ${conn.escape(target.id)}))`,
      ...['Team', 'Wave', 'CrmIntake', 'PartnerRequest', 'SeriesParticipant'].map(table => `DELETE FROM \`${table}\` WHERE seriesId = ${conn.escape(target.id)}`),
    ];
    const restoreOrder = ['Wave', 'Team', 'Competitor', 'Score', 'ZoneEntry', 'ZoneScore', 'ScoreAudit', 'CrmIntake', 'SeriesParticipant', 'PartnerRequest', 'PortraitJob', 'CompetitorPortrait', 'TeamPortrait'];
    const statements = ['START TRANSACTION', `SELECT id FROM Series WHERE id = ${conn.escape(target.id)} FOR UPDATE`, ...deleteTarget];
    for (const table of restoreOrder) for (const row of beforeTarget[table]) {
      const keys = Object.keys(row);
      statements.push(`INSERT INTO \`${table}\` (${keys.map(k => '`' + k + '`').join(',')}) VALUES (${keys.map(k => conn.escape(row[k] && typeof row[k] === 'object' && !(row[k] instanceof Date) && !Buffer.isBuffer(row[k]) ? json(row[k]) : row[k])).join(',')})`);
    }
    statements.push(`UPDATE Series SET ${Object.keys(target).filter(k => k !== 'id').map(k => '`' + k + '`=' + conn.escape(target[k])).join(',')} WHERE id = ${conn.escape(target.id)}`, 'COMMIT');
    fs.writeFileSync(base + '.rollback.sql', '-- Restores ONLY the named Training competition; replaces its later test runs.\n' + statements.join(';\n') + ';\n', { mode: 0o600, flag: 'wx' });
    for (const sql of deleteTarget) await conn.query(sql);
    for (const table of ['SeriesParticipant', 'Team', 'Competitor']) for (const row of plan[table]) await insert(table, row);
    await conn.query('UPDATE Series SET isTraining = 1, signupOpen = 0, resultsPublicAt = NULL, trainingSourceId = ?, trainingCopiedAt = NOW(3), updatedAt = NOW(3) WHERE id = ?', [source.id, target.id]);
    const after = await snapshot(target.id);
    for (const table of ['SeriesParticipant', 'Team', 'Competitor']) if (after[table].length !== plan[table].length) throw new Error('COUNT_MISMATCH:' + table);
    if (after.Score.length || after.Wave.length) throw new Error('OPERATIONAL_STATE_NOT_EMPTY');
    if (fingerprint(await snapshot(source.id)) !== report.sourceFingerprint) throw new Error('SOURCE_CHANGED_IN_TRANSACTION');
    await conn.commit();
    console.log(json({ applied: true, backup: base + '.json', rollback: base + '.rollback.sql', copy: report.copy }));
  }
} catch (error) {
  await conn.rollback();
  console.error(redactSecrets(error instanceof Error ? error.message : String(error), credentials));
  process.exitCode = 1;
} finally { await conn.end(); }
