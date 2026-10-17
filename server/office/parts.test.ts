import { DatabaseSync } from 'node:sqlite';
import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import type { WireResponse } from '../../src/api/remote/wire';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { resolveActor } from '../core/actor';
import { everyCall } from '../core/everyCall';
import { nodeHost } from '../data/lite/host';
import { liteSave } from '../data/lite/save';
import { applyLiteSchema, LITE_SCHEMA_VERSION } from '../data/lite/schema';
import { liteWriteState } from '../data/lite/whole';
import { fixedClock } from '../test/fakes/clock';
import { SIGNIN_STEPS } from '../auth/own/office';
import { hashPassword } from '../auth/own/password';
import { AUTH_USER_INSERT } from '../auth/own/rows';
import { signAgentToken, signingKeysOf } from '../auth/own/keys';
import { testPrivateJwk } from '../auth/own/testKeys';
import { ownIssuer, ownKeySet } from '../auth/ownKeys';
import { setLiteAuthLink } from '../data/lite/office';
import { CLOSE_OFF, CLOSE_STALE } from './live';
import { EffectLedger, type OfficeBatchInput } from './batch';
import { officeParts } from './parts';
import { principalOfWho } from './who';
import { fakeSockets, openFor, recordingNet } from './test/fakes';

const TODAY = '2026-10-04';
const NOW = '2026-10-04T06:00:00.000Z';
/** The values of a Worker on the office path, none of them a secret (the tests reach no network). */
export const OFFICE_ENV: Record<string, string> = {
  APP_URL: 'http://127.0.0.1:5173', MAIL_FROM: 'Madar <notices@madar.test>', MAIL_DRIVER: 'resend', RESEND_API_KEY: 're_test_not_a_key',
  SUPABASE_URL: 'http://127.0.0.1:54321', MADAR_SECRET_KEY: 'sb_secret_test_not_a_key', MADAR_FILE_STORE: 'r2', R2_ACCOUNT_ID: '0'.repeat(32),
  R2_ACCESS_KEY_ID: 'test-not-a-key', R2_SECRET_ACCESS_KEY: 'test-not-a-key', R2_BUCKET: 'madar-files-test',
};
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

type Line = { level: 'info' | 'warn' | 'error'; message: string; fields?: Record<string, unknown> };
/** A log that keeps every line, for a test that reads what the object logged. */
const keptLog = () => {
  const lines: Line[] = [];
  const keep = (level: Line['level']) => (message: string, fields?: Record<string, unknown>) => void lines.push({ level, message, ...(fields ? { fields } : {}) });
  return { lines, info: keep('info'), warn: keep('warn'), error: keep('error') };
};

/** The office parts on node:sqlite with the sample office. The token of a batch is the user id itself, as in test:office. */
async function office(edit: (seed: State) => void = () => undefined, o: { env?: Record<string, string>; log?: ReturnType<typeof keptLog>; net?: ReturnType<typeof recordingNet> } = {}) {
  const values = { ...OFFICE_ENV, ...o.env };
  const raw = new DatabaseSync(':memory:');
  const host = Object.assign(nodeHost(raw), { totals: { rowsRead: 0, rowsWritten: 0 } });
  await applyLiteSchema(host);
  const sockets = fakeSockets();
  const parts = officeParts({
    host, read: (name) => values[name], sockets, clock: fixedClock(NOW), log: o.log ?? silent,
    principal: (who, snapshot) => {
      // The token of a browser batch is the user id itself; an agent goes through the real rule.
      if (who.kind !== 'browser') return principalOfWho(who, snapshot);
      const principal = { userId: who.authUserId };
      resolveActor(snapshot, principal);
      return principal;
    },
  });
  const seed = await buildSeed(TODAY, async () => undefined);
  edit(seed);
  await parts.db.tx('write', (q) => liteWriteState(q, seed));
  const net = o.net ?? recordingNet();
  const batch = async (userId: string, calls: Omit<OfficeBatchInput['calls'][number], 'i'>[]) => {
    const out = await parts.batch({ who: { kind: 'browser', authUserId: userId }, calls: calls.map((c, i) => ({ i, ...c })), overviewCalls: 0, worker: 1 }, net);
    return out.ok ? { ...out, answer: JSON.parse(out.body) as WireResponse } : out;
  };
  return { raw, parts, sockets, seed, net, batch };
}

const ok = <T,>(result: { ok: true; answer: WireResponse; later: string[] } | { ok: false }): { answer: WireResponse; later: string[] } => {
  if (!result.ok) throw new Error('The batch was refused.');
  return result;
};

describe('the office parts (server/office/parts.ts)', () => {
  it('answers a batch in the order sent, so a read after a write sees the write', async () => {
    const { seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const id = (move.input as { id: string }).id;
    const { answer } = ok(await batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'tasks.get', input: { id } }]));
    expect(answer.results.map((r) => [r.i, r.ok])).toEqual([[0, true], [1, true]]);
    expect((answer.results[1] as { output: { task: { status: string } } }).output.task.status).toBe('in_progress');
  });

  it('refuses the whole batch for a person who is off, before any call', async () => {
    const { raw, batch } = await office((seed) => {
      seed.users.usr_004 = { ...seed.users.usr_004, active: false };
    });
    const before = raw.prepare('select count(*) as n from stories').get();
    const out = await batch('usr_004', [{ name: 'story.start', input: {} }]);
    expect(out).toMatchObject({ ok: false, error: { code: 'unauthenticated', details: { reason: 'account_off' } } });
    expect(raw.prepare('select count(*) as n from stories').get()).toEqual(before);
  });

  it('maps a story ref of one entry to the next entry of the batch', async () => {
    const { seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const arrange = everyCall(seed).find((c) => c.name === 'tasks.arrange')!;
    const { answer } = ok(await batch(move.actorId, [
      { name: move.name, input: move.input, story: { ref: 'r1' } },
      { name: arrange.name, input: arrange.input, story: { ref: 'r1' } },
    ]));
    const [a, b] = answer.results as { storyId?: string }[];
    expect(a.storyId).toBeDefined();
    expect(b.storyId).toBe(a.storyId);
  });

  it('replays a write with the same key and writes nothing the second time', async () => {
    const { raw, seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    const first = ok(await batch(move.actorId, [{ name: move.name, input: move.input, key: 'k1' }])).answer;
    const events = raw.prepare('select count(*) as n from events').get();
    const second = ok(await batch(move.actorId, [{ name: move.name, input: move.input, key: 'k1' }])).answer;
    expect(second.results).toEqual(first.results);
    expect(raw.prepare('select count(*) as n from events').get()).toEqual(events);
  });

  it('keeps the mail of a new task for after the answer', async () => {
    const { raw, batch } = await office((seed) => {
      const prefs = seed.users.usr_003.preferences;
      seed.users.usr_003 = { ...seed.users.usr_003, preferences: { ...prefs, email: { ...prefs.email, task_assigned: true } } };
    });
    const { answer, later } = ok(await batch('usr_001', [{
      name: 'tasks.create', input: { projectId: 'prj_001', title: 'Site photos', ownerId: 'usr_003', description: '', flagged: false },
    }]));
    expect(answer.results[0].ok).toBe(true);
    const rows = later.map((id) => raw.prepare('select kind, done_at, payload from outbox where id = ?').get(Number(id)) as { kind: string; done_at: null; payload: string });
    // The mail of usr_003 waits for after the answer, undone; every row of later is a mail or a push.
    expect(rows.some((row) => row.kind === 'mail.notice')).toBe(true);
    for (const row of rows) expect([['mail.notice', 'push.notify'].includes(row.kind), row.done_at]).toEqual([true, null]);
  });

  it('gives the network call of a file link to the Worker port', async () => {
    const { net, batch } = await office();
    const { answer } = ok(await batch('usr_001', [{ name: 'files.link', input: { id: 'fil_001', variant: 'full', disposition: 'inline' } }]));
    expect(answer.results[0]).toMatchObject({ ok: true, output: { url: 'https://files.test/get/blob_seed_001' } });
    expect(net.calls).toEqual(['presignGet blob_seed_001']);
  });

  it('adds the counts of the batch to the day row in its write', async () => {
    const { raw, seed, batch } = await office();
    const move = everyCall(seed).find((c) => c.name === 'tasks.move')!;
    ok(await batch(move.actorId, [{ name: move.name, input: move.input }, { name: 'session.get', input: {} }]));
    expect(raw.prepare('select requests, calls, worker_requests from usage_day where day = ?').get(TODAY)).toEqual({ requests: 1, calls: 2, worker_requests: 1 });
  });

  it('closes the sockets of a person whom the batch turned off', async () => {
    const { sockets, batch } = await office();
    const socket = openFor(sockets, 'usr_007', Date.parse(NOW));
    ok(await batch('usr_001', [{ name: 'users.deactivate', input: { id: 'usr_007' } }]));
    expect(socket.closed?.code).toBe(CLOSE_OFF);
  });

  it('closes the sockets of a person whom the batch turned off, also when a read comes after the write in that batch', async () => {
    const { sockets, batch } = await office();
    const socket = openFor(sockets, 'usr_007', Date.parse(NOW));
    const { answer } = ok(await batch('usr_001', [{ name: 'users.deactivate', input: { id: 'usr_007' } }, { name: 'users.list', input: {} }]));
    expect(answer.results.map((result) => result.ok)).toEqual([true, true]);
    expect(socket.closed?.code).toBe(CLOSE_OFF);
  });

  it('runs the invitation of a new person in the object: the sign-in row, its link, and the mail through the Worker port', async () => {
    const { raw, net, batch } = await office();
    const { answer } = ok(await batch('usr_001', [{
      name: 'users.create', input: { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' },
    }]));
    expect(answer.results[0].ok).toBe(true);
    expect(raw.prepare("select count(*) as n from outbox where kind = 'auth.invite' and done_at is not null and error is null").get()).toEqual({ n: 1 });
    expect(raw.prepare('select email, email_confirmed from auth_users').all()).toEqual([{ email: 'new.person@madar.test', email_confirmed: 0 }]);
    expect(raw.prepare('select type from auth_links where used_at is null').all()).toEqual([{ type: 'invite' }]);
    expect(net.calls.filter((call) => call.startsWith('mail '))).toHaveLength(1);
  });

  it('opens a socket for a ticket that it made, with the tags of the person', async () => {
    const { parts, sockets } = await office();
    const { ticket } = parts.tickets.mint('usr_005', new Date(NOW));
    const answer = await parts.socket(new Request(`https://office.internal/live?ticket=${ticket}`, { headers: { upgrade: 'websocket' } }));
    expect(answer.status).toBe(101);
    expect(sockets.all.map((one) => one.tags)).toEqual([['office', 'person:usr_005']]);
  });

  it('runs the job steps on a Cron call, adds the meter counts, and closes a stale socket', async () => {
    const { parts, sockets, raw, net } = await office();
    const stale = openFor(sockets, 'usr_002', Date.parse(NOW) - 10 * 60_000);
    const report = await parts.cron({ at: NOW, worker: 2 }, net);
    expect(report.steps.map((s) => s.name)).toEqual(['heartbeat', 'triggers', 'summary', 'outbox', 'cleanup', 'uploads', 'usage']);
    // The reminders of the run send signals, and each delivery sweeps first: that sweep or the one of the Cron closes the socket.
    expect(stale.closed?.code).toBe(CLOSE_STALE);
    expect(raw.prepare("select done_at from job_runs where key = 'heartbeat'").get()).toEqual({ done_at: NOW });
    expect(report.day).toMatchObject({ requests: 1, worker_requests: 2 });
  });

  it('warns the Admins in a Cron run when a day meter reaches 80%', async () => {
    const { parts, raw, net } = await office();
    raw.prepare("insert into usage_day (day, rows_read) values ('2026-10-04', 4500000)").run();
    await parts.cron({ at: NOW, worker: 0 }, net);
    expect(net.calls).toContain('mail limit-warning-2026-10-04-rowsReadDay-usr_001');
  });

  it('answers health with the schema version and the last job run', async () => {
    const { parts } = await office();
    expect(await parts.health()).toEqual({ schema: LITE_SCHEMA_VERSION, lastJob: null });
  });
});

/** A sign-in row with a password for a person of the sample office, linked to that person. */
async function withPassword(parts: Awaited<ReturnType<typeof office>>['parts'], seed: State, userId: string): Promise<{ authId: string; email: string }> {
  const authId = crypto.randomUUID();
  const email = seed.users[userId].email.toLowerCase();
  const hash = await hashPassword('a good password');
  await parts.db.tx('write', async (q) => {
    await q(AUTH_USER_INSERT, [authId, email, hash, 1, 1, NOW]);
    await setLiteAuthLink(q, userId, authId);
  });
  return { authId, email };
}

const mailCalls = (net: { calls: string[] }) => net.calls.filter((call) => call.startsWith('mail '));

describe('the sign-in steps in the office object (Office.signin)', () => {

  it('signs a person in with the key of MADAR_AUTH_PRIVATE_JWK, and the token carries the own issuer', async () => {
    const jwk = await testPrivateJwk();
    const { parts, seed } = await office(undefined, { env: { MADAR_AUTH_PRIVATE_JWK: jwk } });
    const { authId, email } = await withPassword(parts, seed, 'usr_002');
    const result = await parts.signin({ signin: 'auth.password', input: { email, password: 'a good password', address: '203.0.113.7' } });
    if (!result.ok) throw new Error(`The sign-in was refused: ${JSON.stringify(result)}`);
    const answer = result.value as { access_token: string; user: { id: string } };
    expect(answer.user.id).toBe(authId);
    // The clock of the test is fixed, so the check of the 15-minute token runs at that time.
    const { payload } = await jwtVerify(answer.access_token, ownKeySet(jwk), {
      issuer: ownIssuer('http://127.0.0.1:54321/functions/v1/mcp'), audience: 'authenticated', algorithms: ['ES256'], currentDate: new Date(NOW),
    });
    expect(payload).toMatchObject({ sub: authId, role: 'authenticated' });
  });

  it('reaches the step of each of the 13 names of SIGNIN_STEPS, and refuses a name that is not one', async () => {
    const { parts } = await office(undefined, { env: { MADAR_AUTH_PRIVATE_JWK: await testPrivateJwk() } });
    const names = Object.keys(SIGNIN_STEPS);
    expect(names).toHaveLength(13);
    for (const name of names) {
      const result = await parts.signin({ signin: name, input: {} });
      expect(JSON.stringify(result), name).not.toContain('This sign-in step does not exist.');
    }
    expect(await parts.signin({ signin: 'auth.nothing', input: {} })).toMatchObject({ ok: false, error: { code: 'not_found', message: 'This sign-in step does not exist.' } });
  });

  it('answers failed with no key, and the log names the secret and never a value', async () => {
    const log = keptLog();
    const { parts } = await office(undefined, { log });
    expect(await parts.signin({ signin: 'auth.password', input: { email: 'x@madar.test', password: 'a good password', address: '203.0.113.7' } })).toMatchObject({ ok: false, error: { code: 'failed' } });
    expect(log.lines.map((line) => JSON.stringify(line)).join('\n')).toContain('MADAR_AUTH_PRIVATE_JWK');
  });
});

describe('the forgot and renew routes in the office object (Office.mailRoute, Office.mailWork)', () => {
  const ADDRESS = '203.0.113.7';

  it('checks the limits and gives back the email; the work then sends the reset mail through the Worker port', async () => {
    const { parts, seed, raw, net } = await office();
    const { email } = await withPassword(parts, seed, 'usr_002');
    const out = await parts.mailRoute({ route: 'forgot', body: JSON.stringify({ email: email.toUpperCase() }), address: ADDRESS }, net);
    expect({ ...out, body: JSON.parse(out.body) }).toEqual({ status: 200, body: { v: 1, ok: true }, work: email });
    expect(mailCalls(net)).toEqual([]);
    await parts.mailWork({ route: 'forgot', value: out.work! }, net);
    expect(mailCalls(net)).toHaveLength(1);
    expect(raw.prepare('select type from auth_links where used_at is null').all()).toEqual([{ type: 'recovery' }]);
  });

  it('gives the same answer and a work for an unknown email, and the work sends nothing', async () => {
    const { parts, net } = await office();
    const out = await parts.mailRoute({ route: 'forgot', body: JSON.stringify({ email: 'nobody@madar.test' }), address: ADDRESS }, net);
    expect([out.status, JSON.parse(out.body), out.work]).toEqual([200, { v: 1, ok: true }, 'nobody@madar.test']);
    await parts.mailWork({ route: 'forgot', value: out.work! }, net);
    expect(mailCalls(net)).toEqual([]);
  });

  it('refuses a body with no email and the fourth try for one email, with no work', async () => {
    const { parts, net } = await office();
    const shape = await parts.mailRoute({ route: 'forgot', body: '{}', address: ADDRESS }, net);
    expect([shape.status, shape.work]).toEqual([400, undefined]);
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof parts.mailRoute>> | undefined;
    for (let i = 0; i < 4; i += 1) {
      last = await parts.mailRoute({ route: 'forgot', body: JSON.stringify({ email: 'same@madar.test' }), address: ADDRESS }, net);
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(last?.work).toBeUndefined();
  });

  it('renews an invitation with the key of its mail: the work sends a new invitation through the Worker port', async () => {
    const mails: { html: string }[] = [];
    const net = recordingNet({ sendMail: async (mail) => (mails.push(mail), { ok: true, value: { id: `mail_${mails.length}` } }) });
    const { parts, raw, batch } = await office(undefined, { net });
    ok(await batch('usr_001', [{ name: 'users.create', input: { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' } }]));
    const href = /href="([^"]+)"/.exec(mails[0].html)![1].replace(/&amp;/g, '&');
    const key = new URL(href).searchParams.get('renew')!;
    const out = await parts.mailRoute({ route: 'renew', body: JSON.stringify({ key }), address: ADDRESS }, net);
    expect([out.status, out.work]).toEqual([200, key]);
    await parts.mailWork({ route: 'renew', value: key }, net);
    expect(mails).toHaveLength(2);
    expect(raw.prepare('select count(*) as n from auth_links where used_at is null').get()).toEqual({ n: 1 });
  });
});

describe('MCP in the office object (Office.mcp)', () => {
  const MCP_URL = 'https://madar.test/mcp';
  type Rpc = { status: number; headers: Record<string, string>; body: Record<string, any> };

  /** An AI app that the person approved in Madar, with a live session of its own, as the OAuth steps leave it; and its token. */
  async function agentToken(parts: Awaited<ReturnType<typeof office>>['parts'], seed: State, jwk: string, ownerId: string): Promise<string> {
    const { authId } = await withPassword(parts, seed, ownerId);
    const clientId = crypto.randomUUID();
    const sessionId = `s-${clientId}`;
    await parts.db.tx('write', async (q) => {
      await q('insert into oauth_clients (id, name, redirect_uris, created_at) values (?1, ?2, ?3, ?4)', [clientId, 'Claude', JSON.stringify(['https://claude.ai/api/mcp/auth_callback']), NOW]);
      await q('insert into agent_approvals (client_id, owner_user_id, approved_at) values (?1, ?2, ?3)', [clientId, ownerId, NOW]);
      await q("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at, created_at) values (?1, ?2, ?3, 'oauth', ?4, '2026-11-17T06:00:00.000Z', ?5)", [sessionId, authId, clientId, `h-${clientId}`, NOW]);
    });
    // jose checks the time of the token with the real clock, so the token gets the real time.
    return signAgentToken(await signingKeysOf(jwk, MCP_URL), { authId, sessionId, clientId, now: new Date() });
  }

  async function mcpOffice() {
    const jwk = await testPrivateJwk();
    const t = await office((seed) => {
      const prefs = seed.users.usr_003.preferences;
      seed.users.usr_003 = { ...seed.users.usr_003, preferences: { ...prefs, email: { ...prefs.email, task_assigned: true } } };
    }, { env: { MADAR_AUTH_PRIVATE_JWK: jwk, MCP_URL } });
    let id = 0;
    const rpc = async (token: string | null, method: string, params: Record<string, unknown> = {}): Promise<Rpc & { later: string[] }> => {
      const headers: [string, string][] = [['content-type', 'application/json'], ['accept', 'application/json, text/event-stream'], ['mcp-protocol-version', '2025-11-25']];
      if (token) headers.push(['authorization', `Bearer ${token}`]);
      const out = await t.parts.mcp({ url: MCP_URL, method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: (id += 1), method, params }), worker: 1 }, t.net);
      // A 2025-era answer may come as one SSE event.
      const json = out.body.startsWith('event:') ? out.body.split('\n').find((line) => line.startsWith('data: '))!.slice(6) : out.body;
      return { status: out.status, headers: Object.fromEntries(out.headers), body: json ? JSON.parse(json) : {}, later: out.later };
    };
    return { ...t, jwk, rpc };
  }

  it('gives an agent token the tools of its person and runs a tool call in the object', async () => {
    const t = await mcpOffice();
    const token = await agentToken(t.parts, t.seed, t.jwk, 'usr_002');
    const list = await t.rpc(token, 'tools/list');
    expect(list.status).toBe(200);
    expect((list.body.result.tools as { name: string }[]).map((tool) => tool.name)).toContain('projects.list');
    const call = await t.rpc(token, 'tools/call', { name: 'projects.list', arguments: {} });
    expect([call.status, call.body.result.isError ?? false]).toEqual([200, false]);
    expect(Array.isArray(call.body.result.structuredContent.output)).toBe(true);
    // The first call linked the agent: a new agent user of usr_002 in the office lists.
    expect(t.raw.prepare("select count(*) as n from users where json_extract(doc, '$.kind') = 'agent' and json_extract(doc, '$.ownerId') = 'usr_002'").get()).toEqual({ n: 1 });
  });

  it('runs a write tool through the batch path: the mail of the write waits for after the answer', async () => {
    const t = await mcpOffice();
    const token = await agentToken(t.parts, t.seed, t.jwk, 'usr_001');
    const call = await t.rpc(token, 'tools/call', { name: 'tasks.create', arguments: { projectId: 'prj_001', title: 'Site photos', ownerId: 'usr_003', description: '', flagged: false } });
    expect([call.status, call.body.result.isError ?? false]).toEqual([200, false]);
    const kinds = call.later.map((row) => (t.raw.prepare('select kind, done_at from outbox where id = ?').get(Number(row)) as { kind: string; done_at: null }));
    expect(kinds.some((row) => row.kind === 'mail.notice' && row.done_at === null)).toBe(true);
  });

  it('refuses the agent of a person whom an Admin turned off, and a request with no token', async () => {
    const t = await mcpOffice();
    const token = await agentToken(t.parts, t.seed, t.jwk, 'usr_002');
    expect((await t.rpc(token, 'tools/list')).status).toBe(200);
    ok(await t.batch('usr_001', [{ name: 'users.deactivate', input: { id: 'usr_002' } }]));
    expect([401, 403]).toContain((await t.rpc(token, 'tools/list')).status);
    const none = await t.rpc(null, 'tools/list');
    expect([none.status, none.headers['www-authenticate']?.startsWith('Bearer')]).toEqual([401, true]);
  });

  it('answers the metadata of the own sign-in from the object, with no token', async () => {
    const t = await mcpOffice();
    const out = await t.parts.mcp({ url: `${MCP_URL}/.well-known/oauth-authorization-server`, method: 'GET', headers: [], body: null, worker: 0 }, t.net);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toMatchObject({ issuer: MCP_URL });
  });

  it('answers 503 with no key of the own sign-in, and runs nothing', async () => {
    const t = await office();
    const out = await t.parts.mcp({ url: MCP_URL, method: 'POST', headers: [['content-type', 'application/json']], body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}', worker: 0 }, t.net);
    expect([out.status, JSON.parse(out.body).error.code, out.later]).toEqual([503, -32603, []]);
  });
});

describe('the effect ledger of a batch', () => {
  it('runs the other kinds before the answer and the mails and pushes after it, and drops a row that did not commit', () => {
    const ledger = new EffectLedger();
    ledger.wrote(['1', '2', '3', '4'], ['r2.delete', 'mail.notice', 'push.notify', 'mail.notice']);
    ledger.committed(['1', '2', '3']);
    expect(ledger.split()).toEqual({ now: ['1'], later: ['2', '3'] });
    // A second split gives no row again: an MCP request may split more than once on the same deps.
    expect(ledger.split()).toEqual({ now: [], later: [] });
  });
});
