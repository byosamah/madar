import { describe, expect, it } from 'vitest';
import { EnterpriseView, PLATFORM_CALL_NAMES } from '../../../src/api/contract/platform';
import { buildSeed } from '../../../src/data/seed';
import { signAgentToken, signingKeysOf } from '../../auth/own/keys';
import { hashPassword } from '../../auth/own/password';
import { httpOf, NODE_TODAY, nodeWorld } from '../../office/test/nodeWorld';

/**
 * The leak tests of the platform part (Madar enterprises, plan C, Task 18): no Admin, no Member and no agent reaches a platform call, and the
 * answers of an owner hold no record of an enterprise and no person data except the first Admin of an enterprise that the owner created.
 */

const PASSWORD = 'a good password';
const AUTH = { owner: '11111111-1111-4111-8111-111111111111', member: '33333333-3333-4333-8333-333333333333', admin: '22222222-2222-4222-8222-222222222222' };
const INPUTS: Record<string, unknown> = {
  'platform.me': {},
  'platform.enterprises.list': {},
  'platform.enterprises.create': { name: 'X Co', nameAr: 'إكس', address: 'x-co', limits: { people: null, storageBytes: null }, admin: { name: 'X', email: 'x@x.test', language: 'en' } },
  'platform.enterprises.update': { id: 'ent_002', patch: { name: 'Hacked' } },
  'platform.enterprises.pause': { id: 'ent_002', confirmName: 'Test ent_002' },
  'platform.enterprises.resume': { id: 'ent_002' },
  'platform.enterprises.resendInvite': { id: 'ent_002' },
  'platform.meter.get': {},
};

async function world() {
  const t = await nodeWorld({
    at: new Date().toISOString(), env: { MADAR_ENTERPRISE_CREATE: 'open' }, ents: ['ent_001', 'ent_002'], sleep: async () => undefined,
    seeds: { ent_001: await buildSeed(NODE_TODAY, async () => undefined), ent_002: await buildSeed(NODE_TODAY, async () => undefined) },
  });
  const hash = await hashPassword(PASSWORD);
  const row = (id: string, email: string, userId: string) => ({ id, email, password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: userId });
  await t.signins([row(AUTH.owner, 'owner@one.test', 'usr_001'), row(AUTH.member, 'member@one.test', 'usr_002')], 'ent_001');
  await t.signins([row(AUTH.admin, 'admin@two.test', 'usr_001')], 'ent_002');
  await t.ents.get('ent_001')!.stub.setPlatformOwners({ ent: 'ent_001', userIds: ['usr_001'] });
  await t.platform.setOwners({ owners: [{ ent: 'ent_001', userId: 'usr_001' }] });
  return t;
}
type World = Awaited<ReturnType<typeof world>>;
const tokenOf = async (t: World, email: string) => {
  const answer = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email, password: PASSWORD }));
  return JSON.parse(answer.body).access_token as string;
};
const post = (t: World, token: string, name: string) => t.route(httpOf('POST', '/api/platform', { v: 1, calls: [{ i: 0, name, input: INPUTS[name] }] }, { authorization: `Bearer ${token}` }));

describe('who may call the platform', () => {
  it('answers not_found to an Admin of another enterprise and to a Member, for each of the 8 calls, with the same body', async () => {
    const t = await world();
    const admin = await tokenOf(t, 'admin@two.test');
    const member = await tokenOf(t, 'member@one.test');
    const unknown = await post(t, admin, 'platform.nothing');
    for (const name of PLATFORM_CALL_NAMES) {
      for (const token of [admin, member]) {
        const answer = await post(t, token, name);
        expect({ name, status: answer.status }).toEqual({ name, status: 404 });
        expect(JSON.parse(answer.body).error).toMatchObject({ code: 'not_found', message: 'This address does not exist.' });
        expect(answer.body).toBe(unknown.body);
      }
    }
  });

  it('answers 403 agent_token to an agent token, for each of the 8 calls', async () => {
    const t = await world();
    const keys = await signingKeysOf(t.jwk, t.env.MCP_URL);
    const agent = await signAgentToken(keys, { authId: AUTH.owner, sessionId: 's-1', clientId: 'c-1', now: new Date(), ent: 'ent_001' });
    for (const name of PLATFORM_CALL_NAMES) {
      const answer = await post(t, agent, name);
      expect({ name, status: answer.status }).toEqual({ name, status: 403 });
      expect(JSON.parse(answer.body).error.details).toMatchObject({ reason: 'agent_token' });
    }
  });
});

describe('what the answers of an owner hold', () => {
  it('lists each row with the keys of the view only, and only the first Admin as person data', async () => {
    const t = await world();
    const owner = await tokenOf(t, 'owner@one.test');
    const answer = await post(t, owner, 'platform.enterprises.list');
    const text = answer.body;
    const rows = JSON.parse(text).results[0].output as Record<string, unknown>[];
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(Object.keys(EnterpriseView.shape).sort());
      expect(EnterpriseView.safeParse(row).success).toBe(true);
    }
    // No record key of an enterprise is in the answer.
    for (const key of ['projects', 'tasks', 'chats', 'files', 'messages', 'comments']) expect(text, key).not.toContain(`"${key}"`);
    // No person of the sample office (their names and emails) is in the answer.
    for (const word of ['Hala', 'Faisal', 'madar.test', 'owner@one.test', 'member@one.test', 'admin@two.test']) expect(text, word).not.toContain(word);
  });

  it('gives an email_taken refusal that names no other enterprise and no person', async () => {
    const t = await world();
    const owner = await tokenOf(t, 'owner@one.test');
    // The first Admin email of the new enterprise is the email of a person of ent_001.
    const bad = { ...(INPUTS['platform.enterprises.create'] as object), admin: { name: 'X', email: 'Member@One.test', language: 'en' } };
    const answer = await t.route(httpOf('POST', '/api/platform', { v: 1, calls: [{ i: 0, name: 'platform.enterprises.create', input: bad }] }, { authorization: `Bearer ${owner}` }));
    const entry = JSON.parse(answer.body).results[0];
    expect(entry).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { fields: ['admin.email'], reason: 'email_taken' } } });
    for (const word of ['ent_001', 'ent_002', 'member@one.test', 'Corniche', 'VADO']) expect(answer.body, word).not.toContain(word);
  });

  it('gives the meter as counts and names only', async () => {
    const t = await world();
    await t.platform.meter({ ent: 'ent_001', day: new Date().toISOString().slice(0, 10), counts: { requests: 5, rowsRead: 6, rowsWritten: 7, mails: 1 } });
    const owner = await tokenOf(t, 'owner@one.test');
    const answer = await post(t, owner, 'platform.meter.get');
    const out = JSON.parse(answer.body).results[0].output as Record<string, any>;
    expect(Object.keys(out).sort()).toEqual(['day', 'enterprises', 'limits', 'share', 'stop', 'total', 'warn']);
    for (const one of out.enterprises) expect(Object.keys(one).sort()).toEqual(['day', 'id', 'name', 'nameAr']);
    expect(answer.body).not.toMatch(/@/);
  });
});
