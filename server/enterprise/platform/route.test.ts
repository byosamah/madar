import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../../src/data/seed';
import { signAgentToken, signingKeysOf } from '../../auth/own/keys';
import { hashPassword } from '../../auth/own/password';
import { httpOf, NODE_TODAY, nodeWorld } from '../../office/test/nodeWorld';
import { ownersBodyOf, pairsOf } from '../../../scripts/office/platform-owners';
import { OPS_SECRET_HEADER } from '../../entries/officeWorker';

const PASSWORD = 'a good password';
const AUTH = { owner: '11111111-1111-4111-8111-111111111111', admin: '22222222-2222-4222-8222-222222222222', member: '33333333-3333-4333-8333-333333333333', other: '44444444-4444-4444-8444-444444444444' };

async function world(env: Record<string, string> = { MADAR_ENTERPRISE_CREATE: 'open', MADAR_OPS_SECRET: 'ops-secret' }) {
  const t = await nodeWorld({
    at: new Date().toISOString(), env, ents: ['ent_001', 'ent_002'],
    seeds: { ent_001: await buildSeed(NODE_TODAY, async () => undefined), ent_002: await buildSeed(NODE_TODAY, async () => undefined) }, sleep: async () => undefined,
  });
  const hash = await hashPassword(PASSWORD);
  const row = (id: string, email: string, userId: string) => ({ id, email, password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: userId });
  // usr_001 of ent_001 is the platform owner; usr_001 of ent_002 is an Admin of another enterprise; usr_002 of ent_001 is another person.
  await t.signins([row(AUTH.owner, 'owner@one.test', 'usr_001'), row(AUTH.member, 'member@one.test', 'usr_002')], 'ent_001');
  await t.signins([row(AUTH.admin, 'admin@two.test', 'usr_001')], 'ent_002');
  await t.ents.get('ent_001')!.stub.setPlatformOwners({ ent: 'ent_001', userIds: ['usr_001'] });
  await t.platform.setOwners({ owners: [{ ent: 'ent_001', userId: 'usr_001' }] });
  return t;
}
type World = Awaited<ReturnType<typeof world>>;
const parse = (body: string) => JSON.parse(body) as Record<string, any>;

async function tokenOf(t: World, email: string): Promise<string> {
  const answer = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email, password: PASSWORD }));
  expect(answer.status, email).toBe(200);
  return parse(answer.body).access_token as string;
}
const post = (t: World, token: string, calls: unknown[]) => t.route(httpOf('POST', '/api/platform', { v: 1, calls }, { authorization: `Bearer ${token}` }));
const call = (name: string, input: unknown = {}) => [{ i: 0, name, input }];
const NOT_FOUND = { code: 'not_found', message: 'This address does not exist.' };

describe('POST /api/platform', () => {
  it('answers a platform owner with the wire entry of platform.me', async () => {
    const t = await world();
    const answer = await post(t, await tokenOf(t, 'owner@one.test'), call('platform.me'));
    expect(answer.status).toBe(200);
    expect(parse(answer.body)).toMatchObject({ v: 1, results: [{ i: 0, ok: true, output: { owner: true, ent: 'ent_001', createOpen: true } }] });
  });

  it('answers not_found for an Admin of another enterprise, for a Member and for a call that is no platform call', async () => {
    const t = await world();
    const owner = await tokenOf(t, 'owner@one.test');
    const admin = await post(t, await tokenOf(t, 'admin@two.test'), call('platform.me'));
    const member = await post(t, await tokenOf(t, 'member@one.test'), call('platform.me'));
    expect(admin.status).toBe(404);
    expect(parse(admin.body).error).toMatchObject(NOT_FOUND);
    expect(member.body).toBe(admin.body);
    const other = await post(t, owner, call('projects.list'));
    expect(other.status).toBe(404);
    expect(parse(other.body).error).toMatchObject(NOT_FOUND);
  });

  it('answers invalid_input for a batch of two calls and for a bad input, only for an owner', async () => {
    const t = await world();
    const owner = await tokenOf(t, 'owner@one.test');
    const two = await post(t, owner, [{ i: 0, name: 'platform.me', input: {} }, { i: 1, name: 'platform.meter.get', input: {} }]);
    expect(parse(two.body).error).toMatchObject({ code: 'invalid_input' });
    const bad = await post(t, owner, call('platform.enterprises.pause', { id: 'nope', confirmName: 'x' }));
    expect(parse(bad.body).error).toMatchObject({ code: 'invalid_input' });
    // The same two-call batch from an Admin who is no owner gives not_found, not a hint about the shape.
    const strangers = await post(t, await tokenOf(t, 'admin@two.test'), [{ i: 0, name: 'platform.me', input: {} }, { i: 1, name: 'platform.me', input: {} }]);
    expect(strangers.status).toBe(404);
  });

  it('answers 404 to a GET and 401 with no token, and 403 agent_token for an agent token', async () => {
    const t = await world();
    expect((await t.route(httpOf('GET', '/api/platform'))).status).toBe(404);
    const none = await t.route(httpOf('POST', '/api/platform', { v: 1, calls: call('platform.me') }));
    expect(none.status).toBe(401);
    const keys = await signingKeysOf(t.jwk, t.env.MCP_URL);
    const agent = await signAgentToken(keys, { authId: AUTH.owner, sessionId: 's-1', clientId: 'c-1', now: new Date(), ent: 'ent_001' });
    const refused = await post(t, agent, call('platform.me'));
    expect(refused.status).toBe(403);
    expect(parse(refused.body).error.details).toMatchObject({ reason: 'agent_token' });
  });

  it('refuses a turned-off owner with a token that is still valid (decision D4)', async () => {
    const t = await world();
    const owner = await tokenOf(t, 'owner@one.test');
    expect((await post(t, owner, call('platform.me'))).status).toBe(200);
    const one = t.ents.get('ent_001')!;
    one.raw.exec("update users set doc = json_set(doc, '$.active', json('false')) where id = 'usr_001'");
    one.raw.exec('update office_meta set version = version + 1');
    one.raw.exec('delete from office_snapshot');
    const refused = await post(t, owner, call('platform.me'));
    expect(refused.status).toBe(404);
    expect(parse(refused.body).error).toMatchObject(NOT_FOUND);
  });

  it('lists the enterprises for an owner, with no key beyond the view', async () => {
    const t = await world();
    const answer = await post(t, await tokenOf(t, 'owner@one.test'), call('platform.enterprises.list'));
    const rows = parse(answer.body).results[0].output as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toEqual(['ent_001', 'ent_002']);
    expect(rows[0]).toMatchObject({ hasOwner: true });
  });
});

describe('the owners ops route', () => {
  const ops = (t: World, body: unknown, secret?: string) =>
    t.route(httpOf('POST', '/api/office/platform-owners', body, secret ? { [OPS_SECRET_HEADER]: secret } : {}));

  it('answers 401 with no secret header and with a wrong secret', async () => {
    const t = await world();
    expect((await ops(t, { owners: [] })).status).toBe(401);
    expect((await ops(t, { owners: [] }, 'wrong')).status).toBe(401);
  });

  it('writes the master list and the copy of each enterprise', async () => {
    const t = await world();
    const answer = await ops(t, { owners: [{ ent: 'ent_001', userId: 'usr_002' }] }, 'ops-secret');
    expect(answer.status).toBe(200);
    expect(await t.platform.isOwner({ ent: 'ent_001', userId: 'usr_002' })).toBe(true);
    expect(await t.platform.isOwner({ ent: 'ent_001', userId: 'usr_001' })).toBe(false);
    expect(t.ents.get('ent_001')!.parts.facts.owners().has('usr_002')).toBe(true);
    expect([...t.ents.get('ent_002')!.parts.facts.owners()]).toEqual([]);
  });

  it('keeps the list when an enterprise is paused (the copy of a paused object is skipped)', async () => {
    const t = await world();
    await t.ents.get('ent_002')!.stub.setState({ ent: 'ent_002', state: 'paused' });
    const answer = await ops(t, { owners: [{ ent: 'ent_001', userId: 'usr_001' }] }, 'ops-secret');
    expect(answer.status).toBe(200);
  });
});

describe('the Postgres path', () => {
  it('has no POST /api/platform: the api app answers 404', async () => {
    const { setEnvSource } = await import('../../env');
    const denoApi = (await import('../../entries/deno-api')).default;
    setEnvSource({
      DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres', SUPABASE_URL: 'http://127.0.0.1:54321', MADAR_SECRET_KEY: 'sb_secret_made_up',
      APP_URL: 'http://127.0.0.1:5173', MAIL_FROM: 'Madar <notices@madar.test>', MAIL_DRIVER: 'outbox',
    });
    try {
      const response = await denoApi.fetch(new Request('http://127.0.0.1/api/platform', { method: 'POST', body: '{}' }));
      expect(response.status).toBe(404);
    } finally {
      setEnvSource(undefined);
    }
  });
});

describe('the owners script', () => {
  it('builds the body from pairs and refuses a bad pair', () => {
    expect(ownersBodyOf(['ent_001:usr_001', 'ent_002:usr_003'])).toEqual({ owners: [{ ent: 'ent_001', userId: 'usr_001' }, { ent: 'ent_002', userId: 'usr_003' }] });
    expect(() => ownersBodyOf(['ent_001'])).toThrow('A pair is');
    expect(() => ownersBodyOf(['ent_001:usr_001:x'])).toThrow('A pair is');
    expect(() => ownersBodyOf(['ENT_1:usr_001'])).toThrow('A pair is');
    expect(() => ownersBodyOf(['ent_001:person'])).toThrow('A pair is');
  });

  it('takes the pairs apart from the flags', () => {
    expect(pairsOf(['--to', 'http://127.0.0.1:8787', 'ent_001:usr_001', '--production'])).toEqual(['ent_001:usr_001']);
  });
});
