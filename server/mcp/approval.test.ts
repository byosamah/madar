import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { browserTokenChecker } from '../auth/verify';
import type { Db, Query } from '../core/ports';
import type { CallData, CallTx } from '../core/runCall';
import { snapshotOf } from '../data/officeCache';
import { apiApp } from '../http/app';
import { ROUTES } from '../http/routes';
import { fakeDeps } from '../test/fakes/deps';
import { CLIENT_SQL, ensureAgentUser, LINK_INSERT_SQL, LINK_SQL, SAME_APP_SQL } from './agentUser';
import { roleWithout } from './aiRoles.testing';
import { addressListOf, APPROVAL_INSERT_SQL, APPROVAL_SQL, APPROVE_PATH, approveRoute, hiddenAddresses, PENDING_SQL, REMOVED_LINK_SQL, withApproveRoute } from './approval';

/**
 * The approval that a person records in Madar for an AI app (plan 5.6; task G4; proof.md G4). The route runs in the api app with
 * the real browser token check over a local key set, and a small database in memory that answers its exact statements.
 * server/it/consent.it.test.ts runs the whole flow on the local stack.
 */

const ISSUER = 'https://ref.supabase.co/auth/v1';
const MCP_AUD = 'https://ref.supabase.co/functions/v1/mcp';
const HALA_AUTH = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const SARA_AUTH = '7a1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const CLIENT = '11111111-2222-4333-8444-555555555555';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const ATTACKER = 'https://attacker.example/cb';

let seed: State;
let sign: (payload: JWTPayload) => Promise<string>;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }] });
  sign = (payload) => new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: 'k1', typ: 'JWT' }).setIssuer(ISSUER).setIssuedAt().setExpirationTime('1h').sign(privateKey);
});

const personToken = (sub = HALA_AUTH) => sign({ sub, role: 'authenticated', aud: ['authenticated'], session_id: 's1' });
const agentToken = (sub = HALA_AUTH) => sign({ sub, role: 'authenticated', aud: MCP_AUD, client_id: CLIENT, session_id: 's2' });

type Pending = { clientId: string; authUserId: string; seen?: string | null; registered?: string[] };

function setup(o: { pending?: Record<string, Pending>; off?: string[]; removed?: { client_id: string; owner_user_id: string }[]; connectOff?: string[] } = {}) {
  const pending = o.pending ?? { 'auth-1': { clientId: CLIENT, authUserId: HALA_AUTH } };
  const approvals: { client_id: string; owner_user_id: string; redirect_uri: string | null }[] = [];
  const q = (async (text: string, values: unknown[] = []) => {
    if (text === PENDING_SQL) {
      const found = pending[String(values[0])];
      if (!found || found.authUserId !== values[1]) return [];
      // The screen showed the seen address (Auth: oauth_authorizations.redirect_uri); the client holds its registered addresses.
      const seen = found.seen === undefined ? CLAUDE : found.seen;
      return [{ client_id: found.clientId, redirect_uri: seen, redirect_uris: (found.registered ?? (seen === null ? [CLAUDE] : [seen])).join(',') }];
    }
    if (text === REMOVED_LINK_SQL) return (o.removed ?? []).some((row) => row.client_id === values[0] && row.owner_user_id === values[1]) ? [{ removed: 1 }] : [];
    if (text === APPROVAL_INSERT_SQL) {
      const old = approvals.find((row) => row.client_id === values[0] && row.owner_user_id === values[1]);
      if (old) old.redirect_uri = (values[2] as string | null) ?? null;
      else approvals.push({ client_id: String(values[0]), owner_user_id: String(values[1]), redirect_uri: (values[2] as string | null) ?? null });
      return [];
    }
    throw new Error(`No answer for: ${text.slice(0, 80)}`);
  }) as Query;
  const db: Db = { tx: (_mode, work) => work(q), savepoint: (qq, work) => work(qq), statement: (_m, text, values) => q(text, values) as never };
  const deps = fakeDeps({ db });
  const lists = structuredClone(seed);
  for (const id of o.off ?? []) lists.users[id].active = false;
  // A person whose role has Connect AI assistants off (the role sheet turns the other AI switches off with it).
  if ((o.connectOff ?? []).length > 0) lists.settings.roles = { custom: [roleWithout(['ai.connect'])] };
  for (const id of o.connectOff ?? []) lists.users[id] = { ...lists.users[id], systemRole: 'member', roleId: 'rol_001' };
  const office = snapshotOf(lists, 1, new Map([[HALA_AUTH, 'usr_001'], [SARA_AUTH, 'usr_005']]));
  const route = approveRoute({ verifyToken: browserTokenChecker({ issuer: ISSUER, jwks }), readOffice: async () => office });
  const app = apiApp(deps, { routes: withApproveRoute(ROUTES, route) });
  const approve = async (token: string | null, body: unknown = { authorizationId: 'auth-1' }) => {
    const response = await app.fetch(new Request(`http://127.0.0.1${APPROVE_PATH}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: (await response.json()) as { approved?: boolean; error?: { code: string; details?: Record<string, unknown> } } };
  };
  return { approvals, approve };
}

describe('POST /agents/approve: the approval that the person records in Madar', () => {
  it('records the client of the person\'s pending authorization, read from Auth, never from the browser', async () => {
    const { approvals, approve } = setup();
    const answer = await approve(await personToken(), { authorizationId: 'auth-1', clientId: 'something-else' });
    expect(answer).toEqual({ status: 200, body: { approved: true } });
    expect(approvals).toEqual([{ client_id: CLIENT, owner_user_id: 'usr_001', redirect_uri: CLAUDE }]);
    // The same approval again keeps one row.
    expect((await approve(await personToken())).status).toBe(200);
    expect(approvals).toHaveLength(1);
  });

  it('refuses an agent token of the same person with 403 agent_token, so an agent cannot approve a client of its own', async () => {
    const { approvals, approve } = setup();
    const answer = await approve(await agentToken());
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'agent_token' } });
    expect(approvals).toEqual([]);
  });

  it('refuses no token (401), a turned-off person (403 account_off), and an authorization that ended or is someone else\'s (400)', async () => {
    const { approvals, approve } = setup({ pending: { 'auth-1': { clientId: CLIENT, authUserId: HALA_AUTH } }, off: ['usr_005'] });
    expect((await approve(null)).status).toBe(401);
    const off = await approve(await personToken(SARA_AUTH));
    expect([off.status, off.body.error?.details?.reason]).toEqual([403, 'account_off']);
    const ended = await approve(await personToken(), { authorizationId: 'auth-gone' });
    expect([ended.status, ended.body.error?.details?.reason]).toEqual([400, 'authorization_ended']);
    expect((await approve(await personToken(), {})).status).toBe(400);
    expect(approvals).toEqual([]);
  });
});

describe('hiddenAddresses: the addresses that the person did not see on the consent screen (CWE-863)', () => {
  const MY_APP = 'https://myapp.example/cb';
  const LOCAL = 'http://localhost:8080/cb';
  it('splits the text of Auth (commas) and the JSON list of SQLite', () => {
    expect(addressListOf(` ${CLAUDE} , ${ATTACKER},,`, false)).toEqual([CLAUDE, ATTACKER]);
    expect(addressListOf(JSON.stringify([CLAUDE, ATTACKER]), true)).toEqual([CLAUDE, ATTACKER]);
    expect(addressListOf(null, false)).toEqual([]);
  });

  it('never counts the seen address, loopback, or a known AI app, even beside a warned address that the person saw', () => {
    expect(hiddenAddresses([MY_APP, LOCAL], MY_APP)).toEqual([]);
    expect(hiddenAddresses(['myapp://callback', CLAUDE], 'myapp://callback')).toEqual([]);
    expect(hiddenAddresses([MY_APP, CLAUDE, 'http://127.0.0.1:5/cb', 'https://chatgpt.com/x'], MY_APP)).toEqual([]);
    // The same scheme and host with another path or port is the address that the person saw.
    expect(hiddenAddresses(['https://myapp.example:8443/other', MY_APP], MY_APP)).toEqual([]);
    expect(hiddenAddresses([CLAUDE], CLAUDE)).toEqual([]);
  });

  it('counts a warned address on another scheme or host than the seen one (the finding)', () => {
    expect(hiddenAddresses([CLAUDE, ATTACKER], CLAUDE)).toEqual([ATTACKER]);
    expect(hiddenAddresses(['http://127.0.0.1:33418/callback', ATTACKER], 'http://127.0.0.1:33418/callback')).toEqual([ATTACKER]);
    expect(hiddenAddresses(['https://a.example/cb', 'https://b.example/cb'], 'https://a.example/cb')).toEqual(['https://b.example/cb']);
    expect(hiddenAddresses(['https://a.example/cb', 'http://a.example/cb'], 'https://a.example/cb')).toEqual(['http://a.example/cb']);
    expect(hiddenAddresses(['myapp://callback', 'other://callback'], 'myapp://callback')).toEqual(['other://callback']);
  });

  it('counts an address that does not parse', () => {
    expect(hiddenAddresses(['not an address', CLAUDE], CLAUDE)).toEqual(['not an address']);
  });

  it('is strict when the seen address is not known (an approval from before this fix): a warned address beside another place counts', () => {
    expect(hiddenAddresses([CLAUDE, ATTACKER], null)).toEqual([ATTACKER]);
    expect(hiddenAddresses([LOCAL, MY_APP], null)).toEqual([MY_APP]);
    expect(hiddenAddresses(['https://a.example/cb', 'https://b.example/cb'], null)).toEqual(['https://a.example/cb', 'https://b.example/cb']);
    // One place only: nothing is hidden, so a client of one unknown host stays approved. So do the known and loopback addresses.
    expect(hiddenAddresses([MY_APP, 'https://myapp.example/other'], null)).toEqual([]);
    expect(hiddenAddresses([ATTACKER], null)).toEqual([]);
    expect(hiddenAddresses([CLAUDE, 'https://chatgpt.com/x', LOCAL], null)).toEqual([]);
  });
});

describe('POST /agents/approve and the addresses that the screen did not show (CWE-863)', () => {
  const pending = (p: Omit<Pending, 'clientId' | 'authUserId'>) => ({ 'auth-1': { clientId: CLIENT, authUserId: HALA_AUTH, ...p } });

  it('refuses 403 agent_redirect_hidden when a known address was seen and another warned address is registered, and writes nothing', async () => {
    const { approvals, approve } = setup({ pending: pending({ seen: CLAUDE, registered: [CLAUDE, ATTACKER] }) });
    const answer = await approve(await personToken());
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'agent_redirect_hidden' } });
    expect(approvals).toEqual([]);
  });

  it('refuses a loopback address that was seen beside a warned one, and two different warned hosts', async () => {
    const loopback = setup({ pending: pending({ seen: 'http://127.0.0.1:33418/callback', registered: ['http://127.0.0.1:33418/callback', ATTACKER] }) });
    expect((await loopback.approve(await personToken())).body.error?.details?.reason).toBe('agent_redirect_hidden');
    const two = setup({ pending: pending({ seen: 'https://a.example/cb', registered: ['https://a.example/cb', 'https://b.example/cb'] }) });
    expect((await two.approve(await personToken())).body.error?.details?.reason).toBe('agent_redirect_hidden');
    expect(loopback.approvals.concat(two.approvals)).toEqual([]);
  });

  it('approves the real apps that a rule without the seen address refused, and stores the seen address', async () => {
    for (const [seen, registered] of [
      ['https://myapp.example/cb', ['https://myapp.example/cb', 'http://localhost:8080/cb']],
      ['myapp://callback', ['myapp://callback', CLAUDE]],
      ['https://myapp.example/cb', ['https://myapp.example/cb', CLAUDE]],
    ] as const) {
      const { approvals, approve } = setup({ pending: pending({ seen, registered: [...registered] }) });
      expect((await approve(await personToken())).status).toBe(200);
      expect(approvals).toEqual([{ client_id: CLIENT, owner_user_id: 'usr_001', redirect_uri: seen }]);
    }
  });

  it('is strict for a pending authorization with no seen address, and keeps null for it', async () => {
    const bad = setup({ pending: pending({ seen: null, registered: [CLAUDE, ATTACKER] }) });
    expect((await bad.approve(await personToken())).body.error?.details?.reason).toBe('agent_redirect_hidden');
    const good = setup({ pending: pending({ seen: null, registered: [ATTACKER] }) });
    expect((await good.approve(await personToken())).status).toBe(200);
    expect(good.approvals).toEqual([{ client_id: CLIENT, owner_user_id: 'usr_001', redirect_uri: null }]);
  });

  it('writes the seen address over the null of an old approval, so a person can approve again after the deploy', async () => {
    const { approvals, approve } = setup({ pending: pending({ seen: 'https://myapp.example/cb', registered: ['https://myapp.example/cb', 'http://localhost:8080/cb'] }) });
    approvals.push({ client_id: CLIENT, owner_user_id: 'usr_001', redirect_uri: null });
    expect((await approve(await personToken())).status).toBe(200);
    expect(approvals).toEqual([{ client_id: CLIENT, owner_user_id: 'usr_001', redirect_uri: 'https://myapp.example/cb' }]);
  });
});

describe('POST /agents/approve and the switch Connect AI assistants (role rights version 2)', () => {
  it('refuses a person whose role has ai.connect off with 403 ai_off, and records nothing', async () => {
    const { approvals, approve } = setup({ pending: { 'auth-1': { clientId: CLIENT, authUserId: SARA_AUTH } }, connectOff: ['usr_005'] });
    const answer = await approve(await personToken(SARA_AUTH));
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.connect' } });
    expect(approvals).toEqual([]);
  });

  it('records the approval of a person whose role has ai.connect on (a Member by default), and of the Admin', async () => {
    const member = setup({ pending: { 'auth-1': { clientId: CLIENT, authUserId: SARA_AUTH } } });
    expect((await member.approve(await personToken(SARA_AUTH))).status).toBe(200);
    expect(member.approvals).toEqual([{ client_id: CLIENT, owner_user_id: 'usr_005', redirect_uri: CLAUDE }]);
    const admin = setup();
    expect((await admin.approve(await personToken())).status).toBe(200);
  });

  it('refuses before it reads the pending authorization, so an off person learns nothing about the client', async () => {
    const { approve } = setup({ connectOff: ['usr_005'] });
    const answer = await approve(await personToken(SARA_AUTH), { authorizationId: 'auth-gone' });
    expect(answer.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'ai_off' } });
  });
});

describe('POST /agents/approve after the person removed the agent of this client (review of G4)', () => {
  it('refuses with 403 agent_removed and records nothing, so the screen never asks Auth to approve a client that can never link again', async () => {
    const { approvals, approve } = setup({ removed: [{ client_id: CLIENT, owner_user_id: 'usr_001' }] });
    const answer = await approve(await personToken());
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'agent_removed' } });
    expect(approvals).toEqual([]);
  });

  it('records the approval when the removed link is another person\'s', async () => {
    const { approvals, approve } = setup({ removed: [{ client_id: CLIENT, owner_user_id: 'usr_005' }] });
    expect((await approve(await personToken())).status).toBe(200);
    expect(approvals).toEqual([{ client_id: CLIENT, owner_user_id: 'usr_001', redirect_uri: CLAUDE }]);
  });
});

describe('ensureAgentUser and the recorded approval', () => {
  function tx(answers: { approved: boolean; client?: boolean; lists?: State; seen?: string | null; uris?: string }) {
    const asked: string[] = [];
    const q = (async (text: string) => {
      asked.push(text);
      if (text === LINK_SQL) return [];
      if (text === APPROVAL_SQL) return answers.approved ? [{ approved: 1, redirect_uri: answers.seen ?? null }] : [];
      if (text === CLIENT_SQL) return answers.client ? [{ client_name: 'Claude Code', redirect_uris: answers.uris ?? 'https://claude.ai/cb' }] : [];
      if (text === SAME_APP_SQL) return [];
      throw new Error(`No answer for: ${text.slice(0, 80)}`);
    }) as Query;
    const office = async () => snapshotOf(answers.lists ?? seed, 1);
    const data: CallData = {
      tx: (_mode, work) => work({ q, lock: async () => undefined, office } as unknown as CallTx),
      office,
    };
    return { asked, data };
  }

  // Role rights version 2: a first call of a person whose role has ai.connect off makes no agent user and no link.
  it('makes no agent user and no link for a person whose role has ai.connect off: forbidden, ai_off, and nothing written', async () => {
    const lists = structuredClone(seed);
    lists.settings.roles = { custom: [roleWithout(['ai.connect'])] };
    lists.users.usr_005 = { ...lists.users.usr_005, systemRole: 'member', roleId: 'rol_001' };
    const { asked, data } = tx({ approved: true, client: true, lists });
    const error = await ensureAgentUser(fakeDeps(), { ownerId: 'usr_005', clientId: CLIENT, data }).then(() => null, (e: unknown) => e);
    expect(error).toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.connect' } });
    expect(asked).toEqual([LINK_SQL, APPROVAL_SQL, CLIENT_SQL]);
    expect(asked).not.toContain(LINK_INSERT_SQL);
    expect(Object.keys(lists.users).filter((id) => lists.users[id].kind === 'agent').length).toBe(Object.keys(seed.users).filter((id) => seed.users[id].kind === 'agent').length);
  });

  it('goes on to the search for an earlier agent of the same app for a person whose role has ai.connect on', async () => {
    const { asked, data } = tx({ approved: true, client: true });
    // The memory transaction has no office save step, so the new user fails there; the point is that the switch did not stop it.
    const error = await ensureAgentUser(fakeDeps(), { ownerId: 'usr_001', clientId: CLIENT, data }).then(() => null, (e: unknown) => e);
    expect(error).not.toMatchObject({ details: { reason: 'ai_off' } });
    expect(asked.slice(0, 4)).toEqual([LINK_SQL, APPROVAL_SQL, CLIENT_SQL, SAME_APP_SQL]);
  });

  it('makes no link for a client that the person did not approve in Madar: forbidden, agent_not_approved', async () => {
    const { asked, data } = tx({ approved: false });
    const error = await ensureAgentUser(fakeDeps(), { ownerId: 'usr_001', clientId: CLIENT, data }).then(() => null, (e: unknown) => e);
    expect(error).toMatchObject({ code: 'forbidden', details: { reason: 'agent_not_approved' } });
    expect(asked).toEqual([LINK_SQL, APPROVAL_SQL]);
  });

  it('goes on to the client of an approved one (an unknown client then asks to connect again)', async () => {
    const { asked, data } = tx({ approved: true });
    const error = await ensureAgentUser(fakeDeps(), { ownerId: 'usr_001', clientId: CLIENT, data }).then(() => null, (e: unknown) => e);
    expect(error).toMatchObject({ code: 'unauthenticated' });
    expect(asked).toEqual([LINK_SQL, APPROVAL_SQL, CLIENT_SQL]);
  });

  it('refuses a client with an address that the person did not see, before it writes anything (CWE-863)', async () => {
    const { asked, data } = tx({ approved: true, client: true, seen: CLAUDE, uris: `${CLAUDE},${ATTACKER}` });
    const error = await ensureAgentUser(fakeDeps(), { ownerId: 'usr_001', clientId: CLIENT, data }).then(() => null, (e: unknown) => e);
    expect(error).toMatchObject({ code: 'forbidden', details: { reason: 'agent_redirect_hidden' } });
    expect(asked).toEqual([LINK_SQL, APPROVAL_SQL, CLIENT_SQL]);
  });

  it('is strict for an approval with no seen address: a warned address beside another place stops, one place goes on', async () => {
    const bad = tx({ approved: true, client: true, seen: null, uris: `http://127.0.0.1:5/cb,${ATTACKER}` });
    expect(await ensureAgentUser(fakeDeps(), { ownerId: 'usr_001', clientId: CLIENT, data: bad.data }).then(() => null, (e: unknown) => e)).toMatchObject({ details: { reason: 'agent_redirect_hidden' } });
    const good = tx({ approved: true, client: true, seen: null, uris: ATTACKER });
    const error = await ensureAgentUser(fakeDeps(), { ownerId: 'usr_001', clientId: CLIENT, data: good.data }).then(() => null, (e: unknown) => e);
    expect(error).not.toMatchObject({ details: { reason: 'agent_redirect_hidden' } });
  });

  it('goes on for a seen warned address with loopback beside it (the real app that a rule without the seen address refused)', async () => {
    const { data } = tx({ approved: true, client: true, seen: 'https://myapp.example/cb', uris: 'https://myapp.example/cb,http://localhost:8080/cb' });
    const error = await ensureAgentUser(fakeDeps(), { ownerId: 'usr_001', clientId: CLIENT, data }).then(() => null, (e: unknown) => e);
    expect(error).not.toMatchObject({ details: { reason: 'agent_redirect_hidden' } });
  });
});
