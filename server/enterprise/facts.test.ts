import { describe, expect, it } from 'vitest';
import { freshLite } from '../data/lite/testDb';
import { nodeWorld } from '../office/test/nodeWorld';
import { EnterpriseFacts } from './facts';

describe('the enterprise facts', () => {
  it('reads the identity row and the owners of enterprise_use', async () => {
    const { raw, db } = await freshLite();
    raw.exec(`insert into enterprise (id, state, limits, created_at) values ('ent_002', 'paused', '{"people":5,"storageBytes":1000}', '2026-11-08T00:00:00.000Z')`);
    raw.exec(`update enterprise_use set owners = '["usr_001"]'`);
    const facts = new EnterpriseFacts();
    await facts.load(db);
    expect(facts.id()).toBe('ent_002');
    expect(facts.state()).toBe('paused');
    expect(facts.limits()).toEqual({ people: 5, storageBytes: 1000 });
    expect([...facts.owners()]).toEqual(['usr_001']);
  });

  it('has no id, no limit and the state active with no row', async () => {
    const { db } = await freshLite();
    const facts = new EnterpriseFacts();
    await facts.load(db);
    expect(facts.id()).toBeUndefined();
    expect(facts.state()).toBe('active');
    expect(facts.limits()).toEqual({ people: null, storageBytes: null });
    expect(facts.owners().size).toBe(0);
  });

  it('changes in memory with set, and forgets with forget', async () => {
    const { db } = await freshLite();
    const facts = new EnterpriseFacts();
    await facts.load(db);
    expect(facts.loaded()).toBe(true);
    facts.set({ state: 'paused', limits: { people: 2, storageBytes: null }, owners: ['usr_003'] });
    expect([facts.state(), facts.limits(), [...facts.owners()]]).toEqual(['paused', { people: 2, storageBytes: null }, ['usr_003']]);
    facts.forget();
    expect(facts.loaded()).toBe(false);
  });

  it('reads a bad limits text or owners text as no limit and no owner', async () => {
    const { raw, db } = await freshLite();
    raw.exec(`insert into enterprise (id, state, limits, created_at) values ('ent_002', 'active', 'not json', '2026-11-08T00:00:00.000Z')`);
    raw.exec(`update enterprise_use set owners = 'not json'`);
    const facts = new EnterpriseFacts();
    await facts.load(db);
    expect(facts.limits()).toEqual({ people: null, storageBytes: null });
    expect(facts.owners().size).toBe(0);
  });

  it('is the Deps.enterprise of an object, loaded by the first call that passes the gate', async () => {
    const world = await nodeWorld({ ents: ['ent_001', 'ent_002'] });
    const two = world.ents.get('ent_002')!;
    expect(two.parts.facts.loaded()).toBe(false);
    await two.stub.status({ ent: 'ent_002' });
    expect(two.parts.depsFor(world.net).enterprise).toBe(two.parts.facts);
    expect(two.parts.facts.id()).toBe('ent_002');
    expect(world.ents.get('ent_001')!.parts.facts.id()).toBeUndefined();
  });
});
