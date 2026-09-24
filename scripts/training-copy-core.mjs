/** Pure cloning rules shared by the dry-run and the writer. No account writes. */
import { randomUUID, createHash } from 'node:crypto';
export const newId = () => 'tr_' + randomUUID().replaceAll('-', '');
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
export const fingerprint = value => createHash('sha256').update(json(value)).digest('hex');
export function assertTargets(source, target, confirmTargetId) {
  if (!source || !target) throw new Error('SOURCE_OR_TARGET_NOT_FOUND');
  if (target.slug === 'podium-bft-series-1') throw new Error('PROTECTED_LIVE_COMPETITION');
  if (source.id === target.id) throw new Error('SOURCE_IS_TARGET');
  if (source.archivedAt || source.isTraining) throw new Error('INVALID_SOURCE');
  if (target.archivedAt) throw new Error('TARGET_ARCHIVED');
  if (confirmTargetId && confirmTargetId !== target.id) throw new Error('TARGET_ID_MISMATCH');
  if (target.trainingCopiedAt || target.trainingSourceId) throw new Error('TARGET_ALREADY_COPIED: the rehearsal has already been seeded; refusing to erase subsequent tests');
}
export function planCopy(source, targetId, now = new Date()) {
  const teams = source.Team.filter(t => !t.archivedAt);
  if (!teams.length && !source.SeriesParticipant.some(p => !p.archivedAt)) throw new Error('SOURCE_EMPTY');
  const teamIds = new Map(teams.map(t => [t.id, newId()]));
  const seen = new Set();
  const seats = source.Competitor.filter(c => teamIds.has(c.teamId)).map(c => {
    const key = c.userId ? 'user:' + c.userId : c.email ? 'email:' + c.email.trim().toLowerCase() : null;
    if (key && seen.has(key)) throw new Error('DUPLICATE_SOURCE_ATHLETE');
    if (key) seen.add(key);
    return { ...c, id: newId(), teamId: teamIds.get(c.teamId), photoPath: null };
  });
  // Email catches a mixture of linked and unlinked seats referring to the same person.
  const emails = seats.map(c => c.email?.trim().toLowerCase()).filter(Boolean);
  if (new Set(emails).size !== emails.length) throw new Error('DUPLICATE_SOURCE_EMAIL');
  const active = source.SeriesParticipant.filter(p => !p.archivedAt);
  const members = new Set(active.map(p => p.userId));
  if (seats.some(c => c.userId && !members.has(c.userId))) throw new Error('SOURCE_MEMBERSHIP_MISSING: run the participation migration and repair missing memberships first');
  return {
    Team: teams.map(t => ({ ...t, id: teamIds.get(t.id), seriesId: targetId,
      source: 'seed', externalId: 'training:' + t.id,
      rawPayload: json({ trainingCopy: { sourceSeriesId: t.seriesId, sourceTeamId: t.id, copiedAt: now.toISOString() } }),
      wave: 1, waveId: null, station: null, attendedAt: null, scoreEdits: 0,
      groupPortraitPath: null, confirmedById: null, billingNumber: null,
      paymentNote: 'Training snapshot — no financial transaction', createdAt: now, updatedAt: now,
    })),
    Competitor: seats,
    SeriesParticipant: active.map(p => ({ ...p, id: newId(), seriesId: targetId,
      partnerUserId: p.partnerUserId && members.has(p.partnerUserId) ? p.partnerUserId : null,
      createdAt: now, updatedAt: now })),
  };
}
export function isTestAddress(email) {
  return typeof email === 'string' && email.trim().toLowerCase().split('@').length === 2 && email.trim().toLowerCase().endsWith('@bftmena.com');
}
