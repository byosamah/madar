import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, errors, exportJWK, generateKeyPair, jwtVerify } from 'jose';
import type { ServerHostSetting } from '../core/serverHost';
import { OWN_KEYS_PATH, ownKeySetFor, ownKeySetOfBinding } from './pagesOwnKeys';

type Pair = { kid: string; sign: CryptoKey; jwk: Record<string, unknown> };
let one: Pair;
let two: Pair;
let three: Pair;

async function pairOf(kid: string): Promise<Pair> {
  const pair = await generateKeyPair('ES256');
  return { kid, sign: pair.privateKey, jwk: { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid, use: 'sig' } };
}
const tokenOf = (pair: Pair) => new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: pair.kid }).setSubject('auth-1').setIssuedAt().setExpirationTime('10m').sign(pair.sign);

beforeAll(async () => {
  [one, two, three] = [await pairOf('k1'), await pairOf('k2'), await pairOf('k3')];
});

/** A fake binding that counts its calls. `answer` is the next answer. */
function binding(answer: () => Response) {
  const seen: string[] = [];
  return { seen, fetch: async (request: Request) => (seen.push(`${request.method} ${new URL(request.url).pathname}`), answer()) };
}
const setOf = (...pairs: Pair[]) => Response.json({ keys: pairs.map((pair) => pair.jwk) });

describe('ownKeySetOfBinding (server/http/pagesOwnKeys.ts)', () => {
  it('asks the Worker for the key set through the binding, once for many checks', async () => {
    const fake = binding(() => setOf(one));
    const keys = ownKeySetOfBinding(fake);
    for (let n = 0; n < 5; n += 1) await jwtVerify(await tokenOf(one), keys);
    expect(fake.seen).toEqual([`GET ${OWN_KEYS_PATH}`]);
  });

  it('loads again after 10 minutes', async () => {
    const fake = binding(() => setOf(one));
    let at = 1_000_000;
    const keys = ownKeySetOfBinding(fake, { now: () => at });
    await jwtVerify(await tokenOf(one), keys);
    at += 9 * 60_000;
    await jwtVerify(await tokenOf(one), keys);
    expect(fake.seen).toHaveLength(1);
    at += 2 * 60_000;
    await jwtVerify(await tokenOf(one), keys);
    expect(fake.seen).toHaveLength(2);
  });

  it('loads again once for an unknown key id, and a second miss inside 30 seconds does not load', async () => {
    let current = setOf(one);
    const fake = binding(() => current.clone());
    let at = 1_000_000;
    const keys = ownKeySetOfBinding(fake, { now: () => at });
    await jwtVerify(await tokenOf(one), keys);
    // The Worker has a new key set. A token of the new key finds it after one more load.
    current = setOf(one, two);
    at += 5 * 60_000;
    await jwtVerify(await tokenOf(two), keys);
    expect(fake.seen).toHaveLength(2);
    // Another key that nobody knows: the set was loaded a moment ago, so there is no third load.
    at += 5_000;
    await expect(jwtVerify(await tokenOf(three), keys)).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
    expect(fake.seen).toHaveLength(2);
    // After 30 seconds a miss may load again.
    at += 31_000;
    await expect(jwtVerify(await tokenOf(three), keys)).rejects.toBeInstanceOf(errors.JWKSNoMatchingKey);
    expect(fake.seen).toHaveLength(3);
  });

  it('throws a plain Error, not a jose error, for a 500 answer and for a body that is not a key set', async () => {
    for (const answer of [() => new Response('boom', { status: 500 }), () => Response.json({}), () => Response.json({ keys: [] }), () => new Response('not json', { status: 200 })]) {
      const keys = ownKeySetOfBinding(binding(answer));
      const error = await jwtVerify(await tokenOf(one), keys).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(errors.JOSEError);
    }
  });

  it('loads again after a failed load', async () => {
    let good = false;
    const fake = binding(() => (good ? setOf(one) : new Response('boom', { status: 500 })));
    const keys = ownKeySetOfBinding(fake);
    await expect(jwtVerify(await tokenOf(one), keys)).rejects.toThrow();
    good = true;
    await jwtVerify(await tokenOf(one), keys);
    expect(fake.seen).toHaveLength(2);
  });
});

describe('ownKeySetFor', () => {
  const setting = (production: 'supabase' | 'workers' | 'office'): ServerHostSetting => ({ test: 'supabase', production });

  it('gives undefined for a copy on supabase or on workers', () => {
    const env = { MADAR_SERVER_PRODUCTION: binding(() => setOf(one)) };
    expect(ownKeySetFor('production', env, setting('supabase'))).toBeUndefined();
    expect(ownKeySetFor('production', env, setting('workers'))).toBeUndefined();
  });

  it('gives undefined for office with no binding, and a set for office with the binding of the copy', () => {
    expect(ownKeySetFor('production', {}, setting('office'))).toBeUndefined();
    const env = { MADAR_SERVER_PRODUCTION: binding(() => setOf(one)) };
    const keys = ownKeySetFor('production', env, setting('office'));
    expect(typeof keys).toBe('function');
    // One set for each copy and binding.
    expect(ownKeySetFor('production', env, setting('office'))).toBe(keys);
  });
});
