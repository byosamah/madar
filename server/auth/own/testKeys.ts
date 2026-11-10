import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';

/**
 * For tests only: the server secret of the test harnesses (as MADAR_SECRET_KEY). The key of the known addresses comes from it
 * (knownKey.ts), so no test path falls back to a plain hash. It is not a real key. This file imports only jose, so workerd tests use it too.
 */
export const TEST_SERVER_SECRET = 'sb_secret_test_not_a_key';

/** For tests only: a new P-256 private JWK with a kid, in the form of the secret MADAR_AUTH_PRIVATE_JWK. */
export async function testPrivateJwk(): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  return JSON.stringify({ ...jwk, kid: await calculateJwkThumbprint(jwk) });
}
