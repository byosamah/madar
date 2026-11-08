import { describe, expect, it } from 'vitest';
import type { NodeEnterprise } from '../office/test/nodeWorld';
import { nodeWorld } from '../office/test/nodeWorld';
import { codePrefixOf } from './lifecycle';
import type { EnterpriseInit } from './types';

const input = (o: Partial<EnterpriseInit> = {}): EnterpriseInit => ({
  ent: 'ent_002', address: 'acme-co', name: 'Acme Co', nameAr: 'أكمي', logo: null, limits: { people: 5, storageBytes: 1000 }, codePrefix: 'AC',
  admin: { name: 'Sara Admin', email: ' Sara@Acme.Test ', language: 'ar' }, ...o,
});

/** A world with one new object (no row, no records) for ent_002. */
async function fresh() {
  const world = await nodeWorld({ ents: ['ent_002'], seeds: { ent_002: false }, row: false });
  const one = world.ents.get('ent_002')!;
  return { world, one };
}
const count = (one: NodeEnterprise, table: string) => (one.raw.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
const rows = (one: NodeEnterprise, text: string) => one.raw.prepare(text).all() as Record<string, unknown>[];

describe('codePrefixOf', () => {
  it('takes the first two letters of the address in capitals', () => {
    expect(codePrefixOf('acme-co')).toBe('AC');
    expect(codePrefixOf('x9y')).toBe('XY');
    expect(codePrefixOf('vados')).toBe('VA');
  });
});

describe('init of an enterprise object', () => {
  it('makes usr_001 as the Admin with the language of the input and a normalized email', async () => {
    const { world, one } = await fresh();
    const out = await one.stub.init(input(), world.net);
    expect(out).toEqual({ ok: true, value: { adminUserId: 'usr_001' } });
    const [user] = rows(one, 'select doc from users');
    expect(JSON.parse(user.doc as string)).toMatchObject({
      id: 'usr_001', name: 'Sara Admin', email: 'sara@acme.test', systemRole: 'admin', kind: 'human', discipline: 'Administration', active: true, preferences: { language: 'ar' },
    });
    expect(rows(one, 'select user_id, email, password_hash, password_set, email_confirmed, banned from auth_users')).toEqual([
      { user_id: 'usr_001', email: 'sara@acme.test', password_hash: null, password_set: 0, email_confirmed: 0, banned: 0 },
    ]);
  });

  it('writes the name, the Arabic name, the logo and the code prefix into the settings row, with no sample content', async () => {
    const { world, one } = await fresh();
    const logo = 'data:image/png;base64,AAAA';
    await one.stub.init(input({ logo }), world.net);
    const [settings] = rows(one, "select doc from settings where id = 'office'");
    const doc = JSON.parse(settings.doc as string);
    expect(doc).toMatchObject({ codePrefix: 'AC', enterpriseName: 'Acme Co', enterpriseNameAr: 'أكمي', enterpriseLogo: logo, workloadLimit: 10 });
    expect(doc.defaultStages).toHaveLength(7);
    expect(doc).not.toHaveProperty('resourceFolders');
    for (const table of ['clients', 'stage_templates', 'task_templates', 'project_templates', 'sub_companies', 'projects', 'teams']) expect({ table, n: count(one, table) }).toEqual({ table, n: 0 });
    expect(count(one, 'users')).toBe(1);
    // The first Admin gets no History event.
    expect(count(one, 'events')).toBe(0);
  });

  it('keeps the identity row, the limits and the facts, and counts users from 1', async () => {
    const { world, one } = await fresh();
    await one.stub.init(input(), world.net);
    expect(rows(one, 'select id, state, limits from enterprise')).toEqual([{ id: 'ent_002', state: 'active', limits: '{"people":5,"storageBytes":1000}' }]);
    expect(one.parts.facts.limits()).toEqual({ people: 5, storageBytes: 1000 });
    expect(rows(one, "select n from counters where prefix = 'usr'")).toEqual([{ n: 1 }]);
  });

  it('sends the invitation once, in the language of the Admin, to the Admin email', async () => {
    const { world, one } = await fresh();
    await one.stub.init(input(), world.net);
    const sent = rows(one, "select to_email, tag, mail from mail_outbox where tag = 'invite'");
    expect(sent).toHaveLength(1);
    expect(sent[0].to_email).toBe('sara@acme.test');
    // The link carries the tag of the enterprise.
    expect(sent[0].mail as string).toContain('ent_002');
    expect(rows(one, "select kind from outbox where kind = 'auth.invite'")).toHaveLength(1);
  });

  it('is a repeat-safe call: the same input again returns the same Admin and queues no second invitation', async () => {
    const { world, one } = await fresh();
    const first = await one.stub.init(input(), world.net);
    const again = await one.stub.init(input(), world.net);
    expect(again).toEqual(first);
    expect(rows(one, "select kind from outbox where kind = 'auth.invite'")).toHaveLength(1);
    expect(rows(one, "select tag from mail_outbox where tag = 'invite'")).toHaveLength(1);
    expect(count(one, 'users')).toBe(1);
    expect(count(one, 'auth_users')).toBe(1);
  });

  it('refuses an id that differs from the row, and an id that differs from the object name', async () => {
    const { world, one } = await fresh();
    await one.stub.init(input(), world.net);
    const other = await one.stub.init(input({ ent: 'ent_009' }), world.net);
    expect(other).toMatchObject({ ok: false });
    const { world: w2, one: two } = await fresh();
    // The object is named ent_002: an input for ent_003 never makes a row.
    expect(await two.stub.init(input({ ent: 'ent_003' }), w2.net)).toMatchObject({ ok: false });
    expect(count(two, 'enterprise')).toBe(0);
  });

  it('gives the next person usr_002', async () => {
    const { world, one } = await fresh();
    await one.stub.init(input(), world.net);
    expect(rows(one, "select n from counters where prefix = 'usr'")).toEqual([{ n: 1 }]);
    // users.create reads the counter: the first id after init is usr_002 (the Admin call is Task 13 / peopleLimit tests too).
    const batch = await one.stub.batch({
      ent: 'ent_002', who: { kind: 'browser', authUserId: (rows(one, 'select id from auth_users')[0].id as string) }, overviewCalls: 0, worker: 0,
      calls: [{ i: 0, name: 'users.create', input: { name: 'Omar', email: 'omar@acme.test', discipline: 'Architect', systemRole: 'member' } }],
    }, world.net);
    expect(batch.ok).toBe(true);
    expect(rows(one, 'select id from users order by id').map((r) => r.id)).toEqual(['usr_001', 'usr_002']);
  });
});
