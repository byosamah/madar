import { describe, expect, it } from 'vitest';
import { emptyState, memberKey, type State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { makeProject, makeStage, makeTask, makeUser } from '../../src/test/factories';
import { AUTH_USER_INSERT } from '../auth/own/rows';
import { signAgentToken, signingKeysOf } from '../auth/own/keys';
import { hashPassword } from '../auth/own/password';
import { linkValueOfMail } from '../auth/own/testOffice';
import { setLiteAuthLink } from '../data/lite/office';
import { ENT_VADO, untag } from '../enterprise/ids';
import { TICKET_REFUSE_MIN_MS } from './live';
import { httpOf, nodeWorld, NODE_TODAY } from './test/nodeWorld';

/**
 * The leak tests of two enterprises (Madar enterprises, plan B Task 16, design section 8). Both hold the same record ids (usr_001, prj_001,
 * tsk_001) with different content. Every request goes through the real Worker routes into the two objects of nodeWorld.
 */

const SECOND = 'ent_002';
const PASSWORD = 'A good password 1';
const ONE_WORD = 'Corniche';
const TWO_WORD = 'Globex';
const AGENT_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

/** A small office for ent_002: the same ids as the sample office, other names. */
function secondOffice(): State {
  const state = emptyState(NODE_TODAY);
  state.users.usr_001 = makeUser('usr_001', { name: 'Dana Globex', email: 'dana@globex.test', systemRole: 'admin' });
  state.users.usr_002 = makeUser('usr_002', { name: 'Omar Globex', email: 'omar@globex.test' });
  state.projects.prj_001 = makeProject({ name: 'Globex Tower', code: 'GL-26-001', leaderId: 'usr_002', currentStageId: 'stg_001', createdBy: 'usr_001' });
  state.stages.stg_001 = makeStage({ name: 'Concept' });
  state.members[memberKey('prj_001', 'usr_002')] = { projectId: 'prj_001', userId: 'usr_002', discipline: 'Architect' };
  state.tasks.tsk_001 = makeTask({ title: 'Globex floor plan', ownerId: 'usr_002', stageId: 'stg_001', createdBy: 'usr_001' });
  state.counters = { usr: 2, prj: 1, stg: 1, tsk: 1 };
  state.session.currentUserId = 'usr_001';
  return state;
}

async function world(o: { sleeps?: number[] } = {}) {
  // The Worker checks each token against the real time, so the world runs at the real time.
  const at = new Date().toISOString();
  const t = await nodeWorld({
    at, ents: [ENT_VADO, SECOND], seeds: { [ENT_VADO]: await buildSeed(NODE_TODAY, async () => undefined), [SECOND]: secondOffice() },
    ...(o.sleeps ? { sleep: async (ms: number) => void o.sleeps!.push(ms) } : { sleep: async () => undefined }),
  });
  const hash = await hashPassword(PASSWORD);
  const row = (id: string, email: string, userId: string) => ({ id, email, password_hash: hash, email_confirmed: true, banned: false, password_set: true, user_id: userId });
  await t.signins([row('11111111-1111-4111-8111-111111111111', 'admin@one.test', 'usr_001')], ENT_VADO);
  await t.signins([row('22222222-2222-4222-8222-222222222222', 'admin@two.test', 'usr_001')], SECOND);
  return t;
}
type World = Awaited<ReturnType<typeof world>>;

const parse = (body: string) => JSON.parse(body) as Record<string, any>;

async function signIn(t: World, email: string) {
  const answer = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email, password: PASSWORD }));
  expect(answer.status, email).toBe(200);
  return parse(answer.body) as { access_token: string; refresh_token: string };
}

/** One call through /api/batch with a token. Extra query, header and body fields can try to name another enterprise. */
async function call(t: World, token: string, name: string, input: unknown, extra: { query?: string; headers?: Record<string, string>; body?: Record<string, unknown> } = {}) {
  const answer = await t.route(httpOf('POST', `/api/batch${extra.query ?? ''}`, { v: 1, calls: [{ i: 0, name, input }], ...(extra.body ?? {}) }, { authorization: `Bearer ${token}`, ...(extra.headers ?? {}) }));
  const body = parse(answer.body);
  return { status: answer.status, body, text: answer.body, result: body.results?.[0] as { ok: boolean; output?: any; error?: any } | undefined };
}

describe('the leak tests of two enterprises with the same record ids', () => {
  it('reads: projects.get, tasks.get, search.query, events.list and dashboard.get give each enterprise only its own data', async () => {
    const t = await world();
    const one = await signIn(t, 'admin@one.test');
    const two = await signIn(t, 'admin@two.test');
    const read = async (token: string) => ({
      project: (await call(t, token, 'projects.get', { id: 'prj_001' })).text,
      task: (await call(t, token, 'tasks.get', { id: 'tsk_001' })).text,
      searchOne: (await call(t, token, 'search.query', { text: ONE_WORD })).text,
      searchTwo: (await call(t, token, 'search.query', { text: TWO_WORD })).text,
      events: (await call(t, token, 'events.list', { limit: 50 })).text,
      dashboard: (await call(t, token, 'dashboard.get', {})).text,
      projects: (await call(t, token, 'projects.list', {})).text,
    });
    const a = await read(one.access_token);
    const b = await read(two.access_token);
    expect(a.project).toContain('Corniche Office Tower');
    expect(b.project).toContain('Globex Tower');
    // The words of one enterprise appear nowhere in the answers of the other.
    for (const text of Object.values(b)) expect(text).not.toContain(ONE_WORD);
    for (const text of Object.values(a)) expect(text).not.toContain(TWO_WORD);
    expect(a.searchOne).toContain(ONE_WORD);
    expect(b.searchTwo).toContain(TWO_WORD);
    // A word that only ent_001 holds finds nothing in ent_002.
    expect(parse(b.searchOne).results[0].output).toMatchObject({ projects: [], tasks: [] });
    expect(b.task).toContain('Globex floor plan');
    expect(a.task).not.toContain('Globex floor plan');
  });

  it('a good token of ent_001 never selects ent_002: a header, a query value and a body field with the value ent_002 change nothing', async () => {
    const t = await world();
    const one = await signIn(t, 'admin@one.test');
    const plain = await call(t, one.access_token, 'projects.get', { id: 'prj_001' });
    const tried = await call(t, one.access_token, 'projects.get', { id: 'prj_001' }, {
      query: `?ent=${SECOND}&office=${SECOND}&enterprise=${SECOND}`,
      headers: { 'x-madar-ent': SECOND, 'x-madar-enterprise': SECOND, 'x-madar-office-name': SECOND, 'x-enterprise': SECOND },
      body: { ent: SECOND, enterprise: SECOND },
    });
    expect(tried.text).toBe(plain.text);
    expect(tried.text).toContain('Corniche Office Tower');
    expect(tried.text).not.toContain(TWO_WORD);
    // The same for a call whose input names the enterprise.
    const inInput = await call(t, one.access_token, 'projects.get', { id: 'prj_001', ent: SECOND } as never);
    expect(inInput.text).not.toContain(TWO_WORD);
  });

  it('a call to the object of ent_002 with ent_001 gives unauthenticated, no data, and the same text as a bad token', async () => {
    const t = await world();
    const two = t.ents.get(SECOND)!;
    const refused = await two.parts.batch({ ent: ENT_VADO, who: { kind: 'browser', authUserId: 'x' }, calls: [{ i: 0, name: 'projects.get', input: { id: 'prj_001' } }], overviewCalls: 0, worker: 0 }, t.net);
    expect(refused).toEqual({ ok: false, error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
    expect(JSON.stringify(refused)).not.toContain(TWO_WORD);
    const bad = await t.route(httpOf('POST', '/api/batch', { v: 1, calls: [] }, { authorization: 'Bearer not.a.token' }));
    expect(parse(bad.body).error.message).toBe('Sign in to continue.');
    expect(bad.status).toBe(401);
  });

  it('a link, a renew key and a refresh token of ent_001 with the tag changed to ent_002 give the answer of an unknown link, key or token', async () => {
    const t = await world();
    const one = await signIn(t, 'admin@one.test');
    const made = await call(t, one.access_token, 'users.create', { name: 'New Person', email: 'new.person@one.test', systemRole: 'member', discipline: 'Architect' });
    expect(made.result?.ok, made.text).toBe(true);
    const [row] = await t.ents.get(ENT_VADO)!.parts.db.statement<{ mail: { html: string } }>('read', "select mail from mail_outbox where tag = 'invite'");
    const link = linkValueOfMail(row.mail.html, 'token_hash');
    const renew = linkValueOfMail(row.mail.html, 'renew');
    const swap = (tagged: string) => `${SECOND}.${untag(tagged)!.secret}`;
    const post = async (path: string, body: unknown) => {
      const answer = await t.route(httpOf('POST', path, body));
      return { status: answer.status, body: answer.body };
    };
    // A link: the changed tag reaches ent_002 with a secret that its table does not hold.
    const verify = (token_hash: string) => post('/api/auth/verify', { token_hash, type: 'invite' });
    const unknownLink = await verify(`${SECOND}.${'z'.repeat(40)}`);
    expect(await verify(swap(link))).toEqual(unknownLink);
    expect(unknownLink.status).toBe(401);
    // A renew key.
    const renewWith = (key: string) => post('/api/auth/renew-invite', { key });
    const unknownKey = await renewWith(`${SECOND}.${'z'.repeat(40)}`);
    expect(await renewWith(swap(renew))).toEqual(unknownKey);
    // A refresh token.
    const refresh = (refresh_token: string) => post('/api/auth/token', { grant_type: 'refresh_token', refresh_token });
    const unknownToken = await refresh(`${SECOND}.${'z'.repeat(40)}`);
    expect(await refresh(swap(one.refresh_token))).toEqual(unknownToken);
    expect(unknownToken.status).toBe(401);
    // The real ones still work in their own enterprise.
    expect((await refresh(one.refresh_token)).status).toBe(200);
    expect((await verify(link)).status).toBe(200);
  });

  it('a ticket of ent_001 with the tag changed to ent_002 is refused with the same answer as a random ticket', async () => {
    const t = await world();
    const one = await signIn(t, 'admin@one.test');
    const ticket = (await call(t, one.access_token, 'live.ticket', {})).result?.output.ticket as string;
    expect(ticket).toMatch(/^ent_001\.[0-9a-f]{64}$/);
    const open = async (value: string) => {
      const answer = await t.route({ ...httpOf('GET', `/api/live?ticket=${value}`), headers: [['upgrade', 'websocket']] });
      return { status: answer.status, body: answer.body };
    };
    const random = await open(`${SECOND}.${'f'.repeat(64)}`);
    const swapped = await open(`${SECOND}.${ticket.split('.')[1]}`);
    expect(swapped).toEqual(random);
    expect(swapped.status).toBe(401);
    // The ticket itself is not used up by the swapped try.
    expect((await open(ticket)).status).toBe(101);
  });

  /** An approved agent with a live session in one object, as the OAuth steps leave it, and its signed token. */
  async function agentToken(t: World, ent: string, aud: string, tokenEnt = ent) {
    const parts = t.ents.get(ent)!.parts;
    const ids = { authId: crypto.randomUUID(), clientId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
    const now = new Date().toISOString();
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await parts.db.tx('write', async (q) => {
      await q(AUTH_USER_INSERT, [ids.authId, `agent-${ent}-${ids.authId}@owner.test`, null, 1, 1, now]);
      await setLiteAuthLink(q, 'usr_001', ids.authId);
      await q('insert into oauth_clients (id, name, redirect_uris, created_at) values (?1, ?2, ?3, ?4)', [ids.clientId, 'Claude', JSON.stringify([AGENT_REDIRECT]), now]);
      await q('insert into agent_approvals (client_id, owner_user_id, approved_at, redirect_uri) values (?1, ?2, ?3, ?4)', [ids.clientId, 'usr_001', now, AGENT_REDIRECT]);
      await q("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at, created_at) values (?1, ?2, ?3, 'oauth', ?4, ?5, ?6)", [ids.sessionId, ids.authId, ids.clientId, `h-${ids.sessionId}`, until, now]);
    });
    return signAgentToken(await signingKeysOf(t.jwk, aud), { ...ids, now: new Date(), ent: tokenEnt });
  }
  const mcp = async (t: World, path: string, token: string | null, method: string, params: Record<string, unknown> = {}) => {
    const answer = await t.route(httpOf('POST', path, { jsonrpc: '2.0', id: 1, method, params }, { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...(token ? { authorization: `Bearer ${token}` } : {}) }));
    const text = answer.body.startsWith('event:') ? answer.body.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : answer.body;
    return { status: answer.status, body: text ? parse(text) : {}, text };
  };

  it('an agent token of ent_001 on /mcp/globex gives 401; a token of ent_002 on /mcp gives 401', async () => {
    const t = await world();
    const oneToken = await agentToken(t, ENT_VADO, 'https://madar.test/mcp');
    const twoToken = await agentToken(t, SECOND, 'https://madar.test/mcp/globex');
    expect((await mcp(t, '/mcp/globex', oneToken, 'tools/list')).status).toBe(401);
    expect((await mcp(t, '/mcp', twoToken, 'tools/list')).status).toBe(401);
    // A token that carries the claim of the other enterprise under the right audience is refused by the object too.
    expect((await mcp(t, '/mcp/globex', await agentToken(t, SECOND, 'https://madar.test/mcp/globex', ENT_VADO), 'tools/list')).status).toBe(401);
  });

  it('tools/list and a tool call on each address show only the data of its own agent', async () => {
    const t = await world();
    const oneToken = await agentToken(t, ENT_VADO, 'https://madar.test/mcp');
    const twoToken = await agentToken(t, SECOND, 'https://madar.test/mcp/globex');
    const listOne = await mcp(t, '/mcp', oneToken, 'tools/list');
    const listTwo = await mcp(t, '/mcp/globex', twoToken, 'tools/list');
    expect(listOne.status).toBe(200);
    expect(listTwo.status).toBe(200);
    expect((listTwo.body.result.tools as { name: string }[]).map((tool) => tool.name)).toContain('projects.list');
    const projectsOne = await mcp(t, '/mcp', oneToken, 'tools/call', { name: 'projects.list', arguments: {} });
    const projectsTwo = await mcp(t, '/mcp/globex', twoToken, 'tools/call', { name: 'projects.list', arguments: {} });
    expect(projectsOne.text).toContain(ONE_WORD);
    expect(projectsOne.text).not.toContain(TWO_WORD);
    expect(projectsTwo.text).toContain(TWO_WORD);
    expect(projectsTwo.text).not.toContain(ONE_WORD);
  });

  it('an unknown email, an untagged link, ent_999.abc, ENT_001.abc, /mcp/nope and /mcp/OAUTH give the answer of wrong credentials, wait, and make no new object', async () => {
    const sleeps: number[] = [];
    const t = await world({ sleeps });
    const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
      const answer = await t.route(httpOf('POST', path, body, headers));
      return { status: answer.status, body: answer.body };
    };
    // Sign-in: an unknown email and a wrong password of a known one give one answer. The known email makes one real object call.
    const wrong = await post('/api/auth/token', { grant_type: 'password', email: 'admin@one.test', password: 'a wrong password' });
    const named = [...t.created];
    expect(named).toEqual([ENT_VADO]);
    const unknown = await post('/api/auth/token', { grant_type: 'password', email: 'nobody@nowhere.test', password: 'a wrong password' });
    expect(unknown).toEqual(wrong);
    expect(unknown.status).toBe(401);
    // Links, keys and tokens that name no enterprise give the answer of an unknown link.
    const unknownLink = await post('/api/auth/verify', { token_hash: `${ENT_VADO}.${'z'.repeat(40)}`, type: 'invite' });
    for (const token_hash of ['abc', 'ent_999.abc', 'ENT_001.abc', 'ent_001.a.b', `ent_001.${'a'.repeat(5000)}`]) {
      const refused = await post('/api/auth/verify', { token_hash, type: 'invite' });
      expect(refused.status, token_hash.slice(0, 12)).toBe(unknownLink.status);
      expect(parse(refused.body).error.details, token_hash.slice(0, 12)).toEqual(parse(unknownLink.body).error.details);
    }
    // The MCP address that names no enterprise gets the 401 of a missing token.
    for (const path of ['/mcp/nope', '/mcp/OAUTH', '/mcp/Globex', '/mcp/ent_999']) expect((await mcp(t, path, null, 'tools/list')).status, path).toBe(401);
    // Forgot and renew: every case waits (the sleep is called for each).
    const before = sleeps.length;
    await post('/api/auth/forgot', { email: 'nobody@nowhere.test' }, { 'x-madar-client-address': '203.0.113.50' });
    await post('/api/auth/renew-invite', { key: 'ent_999.abc' }, { 'x-madar-client-address': '203.0.113.51' });
    expect(sleeps.length).toBeGreaterThanOrEqual(before + 2);
    // And a socket ticket of a bad shape waits the minimum time.
    sleeps.length = 0;
    await t.route({ ...httpOf('GET', '/api/live?ticket=ent_999.abc'), headers: [['upgrade', 'websocket']] });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(TICKET_REFUSE_MIN_MS - 20);
    // No new object name: only the two enterprises of this world were ever asked for.
    expect(t.created.filter((name) => !named.includes(name))).toEqual([]);
    for (const name of t.created) expect([ENT_VADO, SECOND]).toContain(name);
  });

  it('a platform object with no listed id never gets a stub: the stubFor spy holds only listed names after 30 bad requests', async () => {
    const t = await world();
    const bad = ['ent_900', 'ent_901', 'ENT_001', 'ent_01', 'ent_001.x', 'nope', 'ent_999'];
    for (let i = 0; i < 30; i += 1) {
      const tag = bad[i % bad.length];
      await t.route(httpOf('POST', '/api/auth/verify', { token_hash: `${tag}.token${i}`, type: 'invite' }));
      await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'refresh_token', refresh_token: `${tag}.token${i}` }));
      await t.route(httpOf('POST', '/api/auth/renew-invite', { key: `${tag}.key${i}` }, { 'x-madar-client-address': `203.0.113.${(i % 200) + 1}` }));
      await t.route({ ...httpOf('GET', `/api/live?ticket=${tag}.${'a'.repeat(64)}`), headers: [['upgrade', 'websocket']] });
      await mcp(t, `/mcp/${tag.toLowerCase().replace(/_/g, '-')}`, null, 'tools/list');
      await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: `ghost${i}@${tag}.test`, password: 'x' }));
    }
    expect(t.created).toEqual([]);
  });

  it('the daily cleanup of one enterprise deletes no sign-in row of the other', async () => {
    const t = await world();
    const old = '2026-01-01T00:00:00.000Z';
    for (const ent of [ENT_VADO, SECOND]) {
      t.ents.get(ent)!.raw.exec(`insert into auth_links (token_hash, auth_id, type, expires_at) values ('old-${ent}', 'a', 'recovery', '${old}'), ('new-${ent}', 'a', 'recovery', '2099-01-01T00:00:00.000Z')`);
    }
    const first = new Date();
    first.setUTCHours(0, 5, 0, 0);
    await t.ents.get(ENT_VADO)!.parts.cron({ ent: ENT_VADO, at: first.toISOString(), worker: 0 }, t.net);
    const links = (ent: string) => t.ents.get(ent)!.raw.prepare("select token_hash from auth_links where token_hash like '%-ent_%' order by token_hash").all();
    expect(links(ENT_VADO)).toEqual([{ token_hash: `new-${ENT_VADO}` }]);
    expect(links(SECOND)).toEqual([{ token_hash: `new-${SECOND}` }, { token_hash: `old-${SECOND}` }]);
  });
});
