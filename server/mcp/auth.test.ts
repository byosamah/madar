import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { buildSeed } from '../../src/data/seed';
import type { State } from '../../src/api/store';
import { snapshotOf } from '../data/officeCache';
import type { OfficeSnapshot } from '../core/types';
import { AGENT_SQL, agentPrincipalResolver, agentTokenChecker, type AgentRow, type AgentToken } from './auth';

/**
 * The agent token check of the mcp function (plan 5.6; plan section 2, change 6; proof.md Z0a item 2 and G1). Real ES256 keys
 * and real tokens, checked by jose against a key set, as the function does against the JWKS of Supabase Auth.
 */

const ISSUER = 'https://ref.supabase.co/auth/v1';
const MCP_URL = 'https://ref.supabase.co/functions/v1/mcp';
const SUB = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const CLIENT = '907ef9d7-7bfc-4e2b-ac19-e027f13226fa';
const SESSION = '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b';

type Key = { privateKey: CryptoKey; jwk: JWK };
let good: Key;
let other: Key;
let check: (header: string | null) => Promise<AgentToken>;

async function makeKey(kid: string): Promise<Key> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' } };
}

/** The claims of an agent token, as Supabase Auth gives them after the token hook set aud (proof.md G1). */
const agentClaims = (extra: JWTPayload = {}): JWTPayload => ({
  sub: SUB, role: 'authenticated', aud: MCP_URL, client_id: CLIENT, session_id: SESSION, scope: 'email', ...extra,
});

async function token(payload: JWTPayload = agentClaims(), o: { key?: Key; iss?: string; exp?: number | string } = {}): Promise<string> {
  const key = o.key ?? good;
  return new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: key.jwk.kid, typ: 'JWT' }).setIssuer(o.iss ?? ISSUER).setIssuedAt().setExpirationTime(o.exp ?? '1h').sign(key.privateKey);
}

async function refusal(header: string | null): Promise<ApiError> {
  const error = await check(header).then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

beforeAll(async () => {
  good = await makeKey('key-good');
  other = await makeKey('key-other');
  check = agentTokenChecker({ issuer: ISSUER, audience: MCP_URL, jwks: createLocalJWKSet({ keys: [good.jwk] }) });
});

describe('the agent token check', () => {
  it('passes an agent token: aud = the MCP URL, client_id and session_id set', async () => {
    const raw = await token();
    const result = await check(`Bearer ${raw}`);
    expect(result).toMatchObject({ authUserId: SUB, clientId: CLIENT, sessionId: SESSION, token: raw });
    expect(typeof result.expiresAt).toBe('number');
  });

  it('accepts aud as a list that holds the MCP URL (jose checks both forms)', async () => {
    expect((await check(`Bearer ${await token(agentClaims({ aud: [MCP_URL] }))}`)).clientId).toBe(CLIENT);
  });

  it('refuses a browser token: aud "authenticated" (string or list) and no client_id', async () => {
    for (const aud of ['authenticated', ['authenticated']]) {
      const browser = await token({ sub: SUB, role: 'authenticated', aud, session_id: SESSION });
      expect((await refusal(`Bearer ${browser}`)).code).toBe('unauthenticated');
    }
  });

  it('refuses a token with the MCP aud but no client_id, or an empty one', async () => {
    for (const clientId of [undefined, '', null]) {
      expect((await refusal(`Bearer ${await token(agentClaims({ client_id: clientId as never }))}`)).code).toBe('unauthenticated');
    }
  });

  it('refuses a token with no session_id, a foreign issuer, a foreign key, or one that expired', async () => {
    expect((await refusal(`Bearer ${await token(agentClaims({ session_id: undefined }))}`)).code).toBe('unauthenticated');
    expect((await refusal(`Bearer ${await token(agentClaims(), { iss: 'https://evil.example/auth/v1' })}`)).code).toBe('unauthenticated');
    expect((await refusal(`Bearer ${await token(agentClaims(), { key: other })}`)).code).toBe('unauthenticated');
    const expired = await refusal(`Bearer ${await token(agentClaims(), { exp: Math.floor(Date.now() / 1000) - 60 })}`);
    expect(expired.details.reason).toBe('token_expired');
  });

  it('refuses a missing header, a header that is not Bearer, and a token that is not a JWT', async () => {
    for (const header of [null, '', 'Basic abc', 'Bearer', 'Bearer not-a-token']) expect((await refusal(header)).code).toBe('unauthenticated');
  });

  it('refuses an HS256 token, whatever its claims', async () => {
    const hs = await new SignJWT(agentClaims()).setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setExpirationTime('1h').sign(new TextEncoder().encode('x'.repeat(32)));
    expect((await refusal(`Bearer ${hs}`)).code).toBe('unauthenticated');
  });

  it('throws a plain Error (a hidden 500, never a sign-out) when the key set cannot load', async () => {
    const broken = agentTokenChecker({ issuer: ISSUER, audience: MCP_URL, jwks: async () => { throw new TypeError('fetch failed'); } });
    const error = await broken(`Bearer ${await token()}`).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe('the agent principal: the link, the first call of a new approval, and the session check', () => {
  let seed: State;
  let office: OfficeSnapshot;
  const tokenOf = (o: Partial<AgentToken> = {}): AgentToken => ({ authUserId: SUB, clientId: CLIENT, sessionId: SESSION, token: 't', ...o });

  beforeAll(async () => {
    seed = await buildSeed('2026-10-04', async () => undefined);
    office = snapshotOf(seed, 1, new Map([[SUB, 'usr_001']]));
  });

  /** A query that answers AGENT_SQL from a list of rows, one for each call, and records the values. */
  function answers(rows: AgentRow[]) {
    const seen: unknown[][] = [];
    return {
      seen,
      query: async <R>(text: string, values?: unknown[]): Promise<R[]> => {
        expect(text).toBe(AGENT_SQL);
        seen.push(values ?? []);
        const row = rows.shift();
        if (!row) throw new Error('No more answers.');
        return [row as R];
      },
    };
  }
  const row = (o: Partial<AgentRow>): AgentRow => ({ agent_user_id: null, owner_user_id: null, revoked_at: null, session_at: null, ok: false, ...o });

  it('gives the agent user of a live link, with one statement', async () => {
    const db = answers([row({ agent_user_id: 'usr_009', owner_user_id: 'usr_001', session_at: new Date(), ok: true })]);
    const ensured: string[] = [];
    const resolve = agentPrincipalResolver({ query: db.query, office: async () => office, ensure: async (o) => void ensured.push(o.ownerId) });
    expect(await resolve(tokenOf())).toEqual({ principal: { userId: 'usr_009', agent: { clientId: CLIENT } }, ownerId: 'usr_001', linked: false });
    expect(db.seen).toEqual([[SESSION, CLIENT]]);
    expect(ensured).toEqual([]);
  });

  it('makes the agent user on the first call of a new approval, then checks the session again', async () => {
    const db = answers([
      row({ session_at: new Date() }),
      row({ agent_user_id: 'usr_010', owner_user_id: 'usr_001', session_at: new Date(), ok: true }),
    ]);
    const ensured: { ownerId: string; clientId: string }[] = [];
    const resolve = agentPrincipalResolver({ query: db.query, office: async () => office, ensure: async (o) => void ensured.push(o) });
    expect(await resolve(tokenOf())).toEqual({ principal: { userId: 'usr_010', agent: { clientId: CLIENT } }, ownerId: 'usr_001', linked: true });
    expect(ensured).toEqual([{ ownerId: 'usr_001', clientId: CLIENT }]);
  });

  it('links again after a removal when the session started after it (a new approval of the same client)', async () => {
    const revokedAt = new Date('2026-10-04T08:00:00Z');
    const db = answers([
      row({ agent_user_id: 'usr_009', owner_user_id: 'usr_001', revoked_at: revokedAt, session_at: new Date('2026-10-04T09:00:00Z') }),
      row({ agent_user_id: 'usr_011', owner_user_id: 'usr_001', session_at: new Date('2026-10-04T09:00:00Z'), ok: true }),
    ]);
    const ensured: string[] = [];
    const resolve = agentPrincipalResolver({ query: db.query, office: async () => office, ensure: async (o) => void ensured.push(o.clientId) });
    expect((await resolve(tokenOf())).principal.userId).toBe('usr_011');
    expect(ensured).toEqual([CLIENT]);
  });

  it('refuses a removed link whose session is older than the removal, and a session that is gone, with 401', async () => {
    const revokedAt = new Date('2026-10-04T08:00:00Z');
    for (const answer of [
      row({ agent_user_id: 'usr_009', owner_user_id: 'usr_001', revoked_at: revokedAt, session_at: new Date('2026-10-04T07:00:00Z') }),
      row({ agent_user_id: 'usr_009', owner_user_id: 'usr_001', session_at: null }),
      row({ session_at: null }),
    ]) {
      const ensure = async () => { throw new Error('No new link for a dead session.'); };
      const resolve = agentPrincipalResolver({ query: answers([answer]).query, office: async () => office, ensure });
      const error = await resolve(tokenOf()).then(() => null, (e: unknown) => e as ApiError);
      expect(error).toBeInstanceOf(ApiError);
      expect(error!.code).toBe('unauthenticated');
      expect(error!.details.reason).not.toBe('account_off');
    }
  });

  it('refuses a live link whose session check fails: account_off when the person or the agent is off, else 401', async () => {
    const agentOff = snapshotOf({ ...seed, users: { ...seed.users, usr_009: { ...seed.users.usr_009, active: false } } }, 3, new Map([[SUB, 'usr_001']]));
    const live = row({ agent_user_id: 'usr_009', owner_user_id: 'usr_001', session_at: new Date(), ok: false });
    for (const [snapshot, reason] of [[agentOff, 'account_off'], [office, undefined]] as const) {
      const resolve = agentPrincipalResolver({ query: answers([{ ...live }]).query, office: async () => snapshot, ensure: async () => undefined });
      const error = await resolve(tokenOf()).then(() => null, (e: unknown) => e as ApiError);
      // Both active and still refused: the session belongs to another person than the one who approved this client.
      expect([error!.code, error!.details.reason]).toEqual(['unauthenticated', reason]);
    }
  });

  it('makes no link for a sign-in with no Madar person, or for a person who is off', async () => {
    const off = snapshotOf({ ...seed, users: { ...seed.users, usr_001: { ...seed.users.usr_001, active: false } } }, 2, new Map([[SUB, 'usr_001']]));
    for (const [snapshot, authUserId] of [[office, '00000000-0000-4000-8000-000000000000'], [off, SUB]] as const) {
      const ensure = async () => { throw new Error('No link for this sign-in.'); };
      const resolve = agentPrincipalResolver({ query: answers([row({ session_at: new Date() })]).query, office: async () => snapshot, ensure });
      const error = await resolve(tokenOf({ authUserId })).then(() => null, (e: unknown) => e as ApiError);
      expect(error!.code).toBe('unauthenticated');
    }
  });
});
