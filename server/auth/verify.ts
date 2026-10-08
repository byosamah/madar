import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { ApiError } from '../../src/api/errors';
import { env, requireEnv } from '../env';

/**
 * The browser token check of the api function (plan 5.1; plan section 2, change 6; proof.md Z0a items 1 and 2).
 *
 * - jose jwtVerify against the JWKS of Supabase Auth, ES256 only, so a token that the legacy HS256 secret signed never passes.
 * - The issuer is ${SUPABASE_URL}/auth/v1. AUTH_ISSUER replaces it where the function sees another address for Auth than the
 *   browser does: a local function sees SUPABASE_URL http://kong:8000, but its tokens name http://127.0.0.1:54321/auth/v1.
 * - The audience check is the audience option of jwtVerify, never a hand comparison: a password sign-in gives
 *   aud ["authenticated"] (an array), a refresh gives aud "authenticated" (a string).
 * - Any token with client_id is an agent token. The api function refuses it with forbidden (403), also when the token hook
 *   has not set its aud to the MCP address. Agents use the mcp function.
 * - role must be "authenticated" and sub must be a text: the id of the auth.users row, for principalOf.
 *
 * A refusal of the token is unauthenticated (401). A key set that cannot load throws a plain Error that names the cause:
 * the batch route logs it and answers the hidden 500 failed, so an outage of the JWKS never signs a person out.
 */

export type TokenCheckOptions = { issuer: string; jwks: JWTVerifyGetKey };
export type TokenChecker = (header: string | null) => Promise<{ authUserId: string }>;

const AUDIENCE = 'authenticated';
/** The tolerance for clock drift between Auth and the function, in seconds. */
const CLOCK_TOLERANCE_S = 5;
const BEARER = /^bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;

/** The jose codes that mean "this token is not good". Every other error (the key set did not load) is a plain Error. */
const TOKEN_REFUSALS = new Set([
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
]);

function signIn(reason?: string): ApiError {
  return new ApiError('unauthenticated', 'Sign in to continue.', reason ? { reason } : {});
}

function agentToken(): ApiError {
  return new ApiError('forbidden', 'An agent token cannot use this address. Agents use the MCP address.', { reason: 'agent_token' });
}

function hasClientId(payload: JWTPayload | undefined): boolean {
  return payload !== undefined && payload.client_id !== undefined && payload.client_id !== null;
}

export function browserTokenChecker(o: TokenCheckOptions): TokenChecker {
  return async (header) => {
    const match = header === null ? null : BEARER.exec(header.trim());
    if (!match) throw signIn();
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(match[1], o.jwks, { issuer: o.issuer, audience: AUDIENCE, algorithms: ['ES256'], clockTolerance: CLOCK_TOLERANCE_S }));
    } catch (error) {
      // jose checks the claims only after the signature, so the payload of a claim error is a payload that Auth signed.
      if ((error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired) && hasClientId(error.payload)) throw agentToken();
      if (error instanceof errors.JWTExpired) throw signIn('token_expired');
      if (error instanceof errors.JOSEError && TOKEN_REFUSALS.has(error.code)) throw signIn();
      // Not a ruling on the token: a plain error, so the batch route logs the cause and answers the hidden 500 failed.
      throw new Error(`The sign-in check did not run: ${error instanceof errors.JOSEError ? error.code : error instanceof Error ? error.message : String(error)}`);
    }
    if (hasClientId(payload)) throw agentToken();
    if (payload.role !== AUDIENCE || typeof payload.sub !== 'string' || payload.sub === '') throw signIn();
    return { authUserId: payload.sub };
  };
}

/** The issuer of the tokens of a project: ${SUPABASE_URL}/auth/v1. */
export function issuerOf(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

/**
 * One checker for each pair of addresses, with its key set. jose keeps the key set in memory and loads it again after a new kid
 * or 10 minutes.
 */
const checkers = new Map<string, { check: TokenChecker; keys: { reload(): Promise<void> } }>();

function checkerFromEnv(): { check: TokenChecker; keys: { reload(): Promise<void> } } {
  const auth = issuerOf(requireEnv('SUPABASE_URL'));
  const issuer = env('AUTH_ISSUER') ?? auth;
  const id = `${auth}|${issuer}`;
  let checker = checkers.get(id);
  if (!checker) {
    const keys = createRemoteJWKSet(new URL(`${auth}/.well-known/jwks.json`));
    checker = { check: browserTokenChecker({ issuer, jwks: keys }), keys };
    checkers.set(id, checker);
  }
  return checker;
}

/** The token check of the batch route (E3), from SUPABASE_URL and AUTH_ISSUER. */
export function verifyBrowserToken(header: string | null): Promise<{ authUserId: string }> {
  try {
    return checkerFromEnv().check(header);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Starts the load of the key set of SUPABASE_URL and does not wait for it (performance audit LIV-7). The api function calls it
 * once when its worker starts, so the first token check finds the keys loaded or on the way: jose shares one load. It checks no
 * token and reads no database. A load that fails changes nothing: the next check loads the keys again. Without SUPABASE_URL it
 * does nothing, and the first check names the missing value as before.
 */
export function warmKeySet(): void {
  let keys: { reload(): Promise<void> };
  try {
    keys = checkerFromEnv().keys;
  } catch {
    return;
  }
  void keys.reload().catch(() => undefined);
}
