import { describe, expect, it } from 'vitest';
import { EnterpriseView, PLATFORM_CALL_NAMES } from '../../../src/api/contract/platform';
import { buildSeed } from '../../../src/data/seed';
import { signAgentToken, signingKeysOf } from '../../auth/own/keys';
import { hashPassword } from '../../auth/own/password';
import { httpOf, NODE_TODAY, nodeWorld } from '../../office/test/nodeWorld';

/**
 * The leak tests of the platform part (Madar enterprises, plan C Task 18 and plan F, design D10): no company token and no agent token reaches a
 * platform call, a platform token reaches no company route and touches no company object, and the answers of a platform account hold no record
 * of an enterprise and no person data except the first Admin of an enterprise that the account created.
 */

const PASSWORD = 'a good password';
const PLATFORM_PASSWORD = 'a long platform password';
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
  await t.platform.platformAccounts({ action: 'create', email: 'boss@platform.test', name: 'The Boss', password: PLATFORM_PASSWORD });
  return t;
}
type World = Awaited<ReturnType<typeof world>>;
const tokenOf = async (t: World, email: string) => {
  const answer = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email, password: PASSWORD }));
  return JSON.parse(answer.body).access_token as string;
};
const platformTokenOf = async (t: World) => {
  const answer = await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email: 'boss@platform.test', password: PLATFORM_PASSWORD }));
  return JSON.parse(answer.body).access_token as string;
};
const post = (t: World, token: string, name: string) => t.route(httpOf('POST', '/api/platform', { v: 1, calls: [{ i: 0, name, input: INPUTS[name] }] }, { authorization: `Bearer ${token}` }));

describe('who may call the platform', () => {
  it('answers 401 to a company token (Admin of VADO, Admin of another company, Member), for each of the 8 calls, with the body of a missing token', async () => {
    const t = await world();
    const none = await t.route(httpOf('POST', '/api/platform', { v: 1, calls: [{ i: 0, name: 'platform.me', input: {} }] }));
    expect(none.status).toBe(401);
    for (const email of ['owner@one.test', 'admin@two.test', 'member@one.test']) {
      const token = await tokenOf(t, email);
      for (const name of PLATFORM_CALL_NAMES) {
        const answer = await post(t, token, name);
        expect({ email, name, status: answer.status }).toEqual({ email, name, status: 401 });
        expect(answer.body).toBe(none.body);
      }
    }
  });

  it('answers 401 to an agent token, for each of the 8 calls', async () => {
    const t = await world();
    const keys = await signingKeysOf(t.jwk, t.env.MCP_URL);
    const agent = await signAgentToken(keys, { authId: AUTH.owner, sessionId: 's-1', clientId: 'c-1', now: new Date(), ent: 'ent_001' });
    for (const name of PLATFORM_CALL_NAMES) {
      const answer = await post(t, agent, name);
      expect({ name, status: answer.status }).toEqual({ name, status: 401 });
    }
  });

  it('answers 401 account_off at once to a platform account that was turned off, for each of the 8 calls', async () => {
    const t = await world();
    const token = await platformTokenOf(t);
    await t.platform.platformAccounts({ action: 'off', email: 'boss@platform.test' });
    for (const name of PLATFORM_CALL_NAMES) {
      const answer = await post(t, token, name);
      expect({ name, status: answer.status }).toEqual({ name, status: 401 });
      expect(JSON.parse(answer.body).error.details).toMatchObject({ reason: 'account_off' });
    }
  });
});

describe('what a platform token reaches (design D10)', () => {
  it('gives 401 on /api/batch, /mcp, the company sign-in steps and the socket ticket, and touches no company object', async () => {
    const t = await world();
    const token = await platformTokenOf(t);
    t.created.length = 0;
    const auth = { authorization: `Bearer ${token}` };
    const answers = {
      batch: await t.route(httpOf('POST', '/api/batch', { v: 1, calls: [{ i: 0, name: 'session.get', input: {} }] }, auth)),
      mcp: await t.route(httpOf('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, auth)),
      mcpAddress: await t.route(httpOf('POST', '/mcp/globex', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, auth)),
      password: await t.route(httpOf('POST', '/api/auth/password', { password: 'a new long password', current: PLATFORM_PASSWORD }, auth)),
      logout: await t.route(httpOf('POST', '/api/auth/logout', {}, auth)),
      grants: await t.route(httpOf('POST', '/api/oauth/grants', {}, auth)),
      revoke: await t.route(httpOf('POST', '/api/oauth/grants/revoke', { client_id: 'c-1' }, auth)),
      details: await t.route(httpOf('GET', '/api/oauth/authorizations/abc', undefined, auth)),
      consent: await t.route(httpOf('POST', '/api/oauth/authorizations/abc/consent', { action: 'approve' }, auth)),
      approve: await t.route(httpOf('POST', '/api/agents/approve', { authorizationId: 'abc' }, auth)),
      ticket: await t.route(httpOf('GET', `/api/live?ticket=${encodeURIComponent(token)}`, undefined, { upgrade: 'websocket' })),
    };
    for (const [name, answer] of Object.entries(answers)) expect({ name, status: answer.status }).toEqual({ name, status: 401 });
    expect(t.created).toEqual([]);
  });

  it('a platform refresh token is no company refresh token, and a company refresh token is no platform refresh token', async () => {
    const t = await world();
    const platform = JSON.parse((await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email: 'boss@platform.test', password: PLATFORM_PASSWORD }))).body);
    const company = JSON.parse((await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'owner@one.test', password: PASSWORD }))).body);
    expect((await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'refresh_token', refresh_token: platform.refresh_token }))).status).toBe(401);
    expect((await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'refresh_token', refresh_token: company.refresh_token }))).status).toBe(401);
  });

  it('a company Admin who knows the platform address sees only the platform sign-in: the company password and the company email fail there', async () => {
    const t = await world();
    const answer = await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email: 'owner@one.test', password: PASSWORD }));
    expect(answer.status).toBe(401);
    expect(JSON.parse(answer.body).error.details).toMatchObject({ reason: 'invalid_credentials' });
  });
});

describe('what the answers of a platform account hold', () => {
  it('lists each row with the keys of the view only, and only the first Admin as person data', async () => {
    const t = await world();
    const owner = await platformTokenOf(t);
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
    const owner = await platformTokenOf(t);
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
    const owner = await platformTokenOf(t);
    const answer = await post(t, owner, 'platform.meter.get');
    const out = JSON.parse(answer.body).results[0].output as Record<string, any>;
    expect(Object.keys(out).sort()).toEqual(['day', 'enterprises', 'limits', 'share', 'stop', 'total', 'warn']);
    for (const one of out.enterprises) expect(Object.keys(one).sort()).toEqual(['day', 'id', 'name', 'nameAr']);
    expect(answer.body).not.toMatch(/@/);
  });
});
