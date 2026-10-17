import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';

/** For tests only: a new P-256 private JWK with a kid, in the form of the secret MADAR_AUTH_PRIVATE_JWK. */
export async function testPrivateJwk(): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  return JSON.stringify({ ...jwk, kid: await calculateJwkThumbprint(jwk) });
}
