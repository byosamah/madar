import { importJWK, SignJWT, type JWK } from 'jose';
import type { EnterpriseId } from '../../enterprise/ids';
import { ACCESS_TTL_S, ownIssuer, ownPublicJwks } from '../ownKeys';

/**
 * The sign side of the own tokens (Supabase exit, wave 2). The office object signs (ES256 under 1 ms, wave 0), outside a
 * transaction. The claims keep the shape of the Supabase tokens, so the checks of today accept them:
 * - browser: aud "authenticated", role "authenticated", sub = the auth_users id, session_id, ent.
 * - agent: aud = MCP_URL, role "authenticated", sub, client_id, session_id (server/mcp/auth.ts needs all three), ent.
 * Madar enterprises: every own token carries ent, the id of the enterprise of the person. One key serves all enterprises.
 */

export type SigningKeys = { kid: string; key: CryptoKey; issuer: string; mcpUrl: string };

export async function signingKeysOf(privateJwk: string, mcpUrl: string): Promise<SigningKeys> {
  ownPublicJwks(privateJwk);
  const jwk = JSON.parse(privateJwk) as JWK;
  const key = (await importJWK(jwk, 'ES256')) as CryptoKey;
  return { kid: jwk.kid as string, key, issuer: ownIssuer(mcpUrl), mcpUrl: ownIssuer(mcpUrl) };
}

function base(keys: SigningKeys, claims: Record<string, unknown>, o: { authId: string; now: Date }, audience: string): Promise<string> {
  const iat = Math.floor(o.now.getTime() / 1000);
  return new SignJWT({ role: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: keys.kid, typ: 'JWT' })
    .setIssuer(keys.issuer)
    .setAudience(audience)
    .setSubject(o.authId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_S)
    .sign(keys.key);
}

export function signBrowserToken(keys: SigningKeys, o: { authId: string; sessionId: string; now: Date; ent: EnterpriseId }): Promise<string> {
  return base(keys, { session_id: o.sessionId, ent: o.ent }, o, 'authenticated');
}

export function signAgentToken(keys: SigningKeys, o: { authId: string; sessionId: string; clientId: string; now: Date; ent: EnterpriseId }): Promise<string> {
  return base(keys, { session_id: o.sessionId, client_id: o.clientId, ent: o.ent }, o, keys.mcpUrl);
}
