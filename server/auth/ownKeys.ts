import { createLocalJWKSet, type JSONWebKeySet, type JWK, type JWTVerifyGetKey } from 'jose';

/**
 * The verify side of the own tokens (Supabase exit, wave 2): the Worker checks each token with the public part of its key, with
 * no network. This file holds only jose, so the Supabase entries may load it (server/workerGraph.test.ts).
 * - The secret MADAR_AUTH_PRIVATE_JWK: a P-256 private JWK with a kid. Error texts name the secret, never a value.
 * - The issuer of every own token is MCP_URL without a trailing slash: the OAuth metadata names it, and the browser tokens use it too.
 */

export const OWN_AUTH_SECRET = 'MADAR_AUTH_PRIVATE_JWK';
/** 15 minutes (owner rule 2026-10-06, Z7). */
export const ACCESS_TTL_S = 900;

export function ownIssuer(mcpUrl: string): string {
  return mcpUrl.replace(/\/+$/, '');
}

function privateJwkOf(text: string): JWK {
  let jwk: JWK;
  try {
    jwk = JSON.parse(text) as JWK;
  } catch {
    throw new Error(`${OWN_AUTH_SECRET} is not JSON.`);
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.kid !== 'string' || typeof jwk.d !== 'string' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new Error(`${OWN_AUTH_SECRET} must be a P-256 private JWK with a kid.`);
  }
  return jwk;
}

/** The public key set: kty, crv, x, y, kid, alg and use. Never d. */
export function ownPublicJwks(privateJwk: string): JSONWebKeySet {
  const jwk = privateJwkOf(privateJwk);
  return { keys: [{ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: jwk.kid, alg: 'ES256', use: 'sig' }] };
}

let held: { text: string; set: JWTVerifyGetKey } | undefined;

/** The local key set of the own tokens, made once for each value of the secret. */
export function ownKeySet(privateJwk: string): JWTVerifyGetKey {
  if (held?.text !== privateJwk) held = { text: privateJwk, set: createLocalJWKSet(ownPublicJwks(privateJwk)) };
  return held.set;
}
