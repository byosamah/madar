import { describe, expect, it } from 'vitest';
import { freshLite } from '../data/lite/testDb';
import { EnterpriseGate } from './gate';

const NOW = new Date('2026-11-08T08:00:00.000Z');
const NO_LIMITS = { people: null, storageBytes: null };

async function setup(o: { name?: () => string | undefined } = {}) {
  const lite = await freshLite();
  return { ...lite, gate: new EnterpriseGate(lite.db, o) };
}

describe('the enterprise gate', () => {
  it('gives not_found when the object has no row', async () => {
    const { gate } = await setup();
    expect(await gate.refusal('ent_001')).toEqual({ code: 'not_found', message: 'This address does not exist.' });
    expect(() => gate.id()).toThrow();
  });

  it('creates the row once; a second create with another id throws conflict and changes nothing', async () => {
    const { gate, raw } = await setup();
    await gate.create({ id: 'ent_001', state: 'active', limits: NO_LIMITS, now: NOW });
    await gate.create({ id: 'ent_001', state: 'paused', limits: { people: 3, storageBytes: 5 }, now: NOW });
    await expect(gate.create({ id: 'ent_002', state: 'active', limits: NO_LIMITS, now: NOW })).rejects.toMatchObject({ code: 'conflict' });
    expect(raw.prepare('select id, state, limits, created_at from enterprise').all()).toEqual([
      { id: 'ent_001', state: 'active', limits: JSON.stringify(NO_LIMITS), created_at: NOW.toISOString() },
    ]);
    expect(gate.id()).toBe('ent_001');
    expect(await gate.load()).toEqual({ id: 'ent_001', state: 'active', limits: NO_LIMITS, createdAt: NOW.toISOString() });
  });

  it('refuses another id, a malformed id and a value that is no text with one answer', async () => {
    const { gate } = await setup();
    await gate.create({ id: 'ent_001', state: 'active', limits: NO_LIMITS, now: NOW });
    const answers = [await gate.refusal('ent_002'), await gate.refusal('ENT_001'), await gate.refusal(5), await gate.refusal(undefined), await gate.refusal(null)];
    expect(answers[0]).toEqual({ code: 'unauthenticated', message: 'Sign in to continue.' });
    for (const one of answers) expect(one).toEqual(answers[0]);
    expect(await gate.refusal('ent_001')).toBeUndefined();
  });

  it('refuses a paused object with enterprise_paused, except when the call allows paused', async () => {
    const { gate } = await setup();
    await gate.create({ id: 'ent_001', state: 'paused', limits: NO_LIMITS, now: NOW });
    expect(await gate.refusal('ent_001')).toMatchObject({ code: 'forbidden', details: { reason: 'enterprise_paused' } });
    expect(await gate.refusal('ent_001', { allow: 'paused' })).toBeUndefined();
    expect(await gate.refusal('ent_002', { allow: 'paused' })).toMatchObject({ code: 'unauthenticated' });
  });

  it('refuses every call when name() differs from the row id, and accepts when name() is undefined', async () => {
    let name: string | undefined = 'ent_002';
    const { gate } = await setup({ name: () => name });
    await gate.create({ id: 'ent_001', state: 'active', limits: NO_LIMITS, now: NOW });
    expect(await gate.refusal('ent_001')).toMatchObject({ code: 'unauthenticated' });
    expect(await gate.refusal('ent_001', { allow: 'paused' })).toMatchObject({ code: 'unauthenticated' });
    name = 'ent_001';
    expect(await gate.refusal('ent_001')).toBeUndefined();
    name = undefined;
    expect(await gate.refusal('ent_001')).toBeUndefined();
  });

  it('loads the row once for many checks, and reads again after forget', async () => {
    const lite = await freshLite();
    const gate = new EnterpriseGate(lite.db);
    await gate.create({ id: 'ent_001', state: 'active', limits: NO_LIMITS, now: NOW });
    lite.log.length = 0;
    for (let i = 0; i < 5; i += 1) await gate.refusal('ent_001');
    expect(lite.log.filter((text) => text.includes('from enterprise'))).toEqual([]);
    gate.forget();
    await gate.refusal('ent_001');
    await gate.refusal('ent_001');
    expect(lite.log.filter((text) => text.includes('from enterprise'))).toHaveLength(1);
  });

  it('keeps no row in memory for an object that has none, and reads it once', async () => {
    const lite = await freshLite();
    const gate = new EnterpriseGate(lite.db);
    await gate.refusal('ent_001');
    await gate.refusal('ent_001');
    expect(lite.log.filter((text) => text.includes('from enterprise'))).toHaveLength(1);
  });
});
