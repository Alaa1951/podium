import { describe, expect, it } from 'vitest';
import { assertTargets, planCopy, isTestAddress } from './training-copy-core.mjs';
const source = { id: 'real', slug: 'podium-bft-series-1' }, target = { id: 'test', slug: 'training' };
const rows = () => ({ Team: [{ id: 'team', seriesId: 'real', number: 101, paymentStatus: 'paid', amountMinor: 7500, waveId: 'wave', station: 3, attendedAt: new Date(), source: 'ghl', externalId: 'crm', scoreEdits: 1 }], Competitor: [{ id: 'seat', teamId: 'team', position: 1, userId: 'same-user', email: 'a@example.com', photoPath: '/api/portraits/x' }], SeriesParticipant: [{ id: 'entry', seriesId: 'real', userId: 'same-user', partnerUserId: null }] });
describe('one-time rehearsal', () => {
  it('refuses identical targets, wrong confirmation, and the protected live slug', () => {
    expect(() => assertTargets(source, source)).toThrow('PROTECTED_LIVE_COMPETITION');
    expect(() => assertTargets({ id: 'x' }, { id: 'x' })).toThrow('SOURCE_IS_TARGET');
    expect(() => assertTargets(source, target, 'real')).toThrow('TARGET_ID_MISMATCH');
    expect(() => assertTargets(source, { ...target, trainingCopiedAt: new Date() })).toThrow('TARGET_ALREADY_COPIED');
  });
  it('creates new competition rows, reuses identities, preserves payment state without making charges, resets operation', () => {
    const input = rows(), before = structuredClone(input), plan = planCopy(input, 'test');
    expect(input).toEqual(before);
    expect(plan.Team[0]).toMatchObject({ seriesId: 'test', paymentStatus: 'paid', amountMinor: 7500, waveId: null, station: null, attendedAt: null, source: 'seed', scoreEdits: 0 });
    expect(plan.Team[0].id).not.toBe('team'); expect(plan.Competitor[0].teamId).toBe(plan.Team[0].id);
    expect(plan.Competitor[0]).toMatchObject({ userId: 'same-user', photoPath: null });
    expect(plan.SeriesParticipant[0]).toMatchObject({ seriesId: 'test', userId: 'same-user' });
    expect(Object.keys(plan).sort()).toEqual(['Competitor', 'SeriesParticipant', 'Team']);
  });
  it('fails before deletion if the source has duplicate registrations or a missing shared membership', () => {
    const dup = rows(); dup.Competitor.push({ ...dup.Competitor[0], id: 'dup' }); expect(() => planCopy(dup, 'test')).toThrow('DUPLICATE_SOURCE_ATHLETE');
    const missing = rows(); missing.SeriesParticipant = []; expect(() => planCopy(missing, 'test')).toThrow('SOURCE_MEMBERSHIP_MISSING');
  });
  it('copies athletes without teams as well, and never brings in archived entries', () => {
    const input = rows(); input.SeriesParticipant.push({ id: 'solo', userId: 'solo', seriesId: 'real', partnerUserId: null }, { id: 'gone', userId: 'gone', archivedAt: new Date() });
    expect(planCopy(input, 'test').SeriesParticipant.map(p => p.userId)).toEqual(['same-user', 'solo']);
  });
  it('preserves imported seats sharing a purchaser email without inventing a shared account', () => {
    const input = rows(); input.Competitor[0].userId = null;
    input.Competitor.push({ ...input.Competitor[0], id: 'other-seat', position: 2, fullName: 'Another athlete' });
    const copy = planCopy(input, 'test');
    expect(copy.Competitor).toHaveLength(2);
    expect(copy.Competitor.every(c => c.userId === null)).toBe(true);
    expect(copy.Competitor[0].id).not.toBe(copy.Competitor[1].id);
    input.Competitor[0].userId = 'same-user';
    expect(() => planCopy(input, 'test')).toThrow('DUPLICATE_SOURCE_EMAIL');
  });
});
it('matches only the exact test domain', () => {
  expect(isTestAddress(' A@BFTMENA.COM ')).toBe(true);
  for (const email of ['a@bftmiddleeast.com','a@sub.bftmena.com','a@bftmena.com.attacker.org','a@x@bftmena.com']) expect(isTestAddress(email)).toBe(false);
});
