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
import { CLIENT_SQL, ensureAgentUser, LINK_SQL } from './agentUser';
import { APPROVAL_INSERT_SQL, APPROVAL_SQL, APPROVE_PATH, approveRoute, AUTHORIZATION_SQL } from './approval';

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

function setup(o: { pending?: Record<string, { clientId: string; authUserId: string }>; off?: string[] } = {}) {
  const pending = o.pending ?? { 'auth-1': { clientId: CLIENT, authUserId: HALA_AUTH } };
  const approvals: { client_id: string; owner_user_id: string }[] = [];
  const q = (async (text: string, values: unknown[] = []) => {
    if (text === AUTHORIZATION_SQL) {
      const found = pending[String(values[0])];
      return [{ client_id: found && found.authUserId === values[1] ? found.clientId : null }];
    }
    if (text === APPROVAL_INSERT_SQL) {
      if (!approvals.some((row) => row.client_id === values[0] && row.owner_user_id === values[1])) approvals.push({ client_id: String(values[0]), owner_user_id: String(values[1]) });
      return [];
    }
    throw new Error(`No answer for: ${text.slice(0, 80)}`);
  }) as Query;
  const db: Db = { tx: (_mode, work) => work(q), savepoint: (qq, work) => work(qq), statement: (_m, text, values) => q(text, values) as never };
  const deps = fakeDeps({ db });
  const lists = structuredClone(seed);
  for (const id of o.off ?? []) lists.users[id].active = false;
  const office = snapshotOf(lists, 1, new Map([[HALA_AUTH, 'usr_001'], [SARA_AUTH, 'usr_005']]));
  const route = approveRoute({ verifyToken: browserTokenChecker({ issuer: ISSUER, jwks }), readOffice: async () => office });
  const app = apiApp(deps, { routes: [...ROUTES, route] });
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
    expect(approvals).toEqual([{ client_id: CLIENT, owner_user_id: 'usr_001' }]);
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

describe('ensureAgentUser and the recorded approval', () => {
  function tx(answers: { approved: boolean }) {
    const asked: string[] = [];
    const q = (async (text: string) => {
      asked.push(text);
      if (text === LINK_SQL) return [];
      if (text === APPROVAL_SQL) return answers.approved ? [{ approved: 1 }] : [];
      if (text === CLIENT_SQL) return [];
      throw new Error(`No answer for: ${text.slice(0, 80)}`);
    }) as Query;
    const data: CallData = {
      tx: (_mode, work) => work({ q, lock: async () => undefined } as unknown as CallTx),
      office: async () => snapshotOf(seed, 1),
    };
    return { asked, data };
  }

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
});
