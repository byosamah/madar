import { describe, expect, it } from 'vitest';
import { PushConfigError, VAPID_LIFETIME_SECONDS, audienceOf, base64url, base64urlDecode, makeVapidKeys, vapidAuthorization, vapidConfigOf } from './vapid';

/** The sender signs with WebCrypto only. These tests check the token with the public key, as a push service does. */

const NOW = new Date('2026-10-08T10:00:00Z');
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bE-sample';

const decode = (part: string) => JSON.parse(new TextDecoder().decode(base64urlDecode(part))) as Record<string, unknown>;

async function verify(token: string, publicKey: string): Promise<boolean> {
  const [head, claims, signature] = token.split('.');
  const key = await crypto.subtle.importKey('raw', base64urlDecode(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64urlDecode(signature), new TextEncoder().encode(`${head}.${claims}`));
}

describe('base64url', () => {
  it('round-trips bytes with no padding, plus or slash', () => {
    for (const bytes of [new Uint8Array([]), new Uint8Array([251, 255, 254]), crypto.getRandomValues(new Uint8Array(65))]) {
      const text = base64url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect([...base64urlDecode(text)]).toEqual([...bytes]);
    }
  });
});

describe('makeVapidKeys', () => {
  it('makes a P-256 pair: 32 private bytes and a 65 byte public point, both as base64url', async () => {
    const keys = await makeVapidKeys();
    expect(base64urlDecode(keys.privateKey)).toHaveLength(32);
    const point = base64urlDecode(keys.publicKey);
    expect(point).toHaveLength(65);
    expect(point[0]).toBe(4);
    expect(keys.publicKey).toHaveLength(87);
    expect(keys.privateKey).toHaveLength(43);
    expect((await makeVapidKeys()).privateKey).not.toBe(keys.privateKey);
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  it('gives "vapid t=<token>, k=<public key>" with a token that the public key verifies', async () => {
    const keys = await makeVapidKeys();
    const header = await vapidAuthorization({ ...keys, subject: 'mailto:madar@vado.sa' }, ENDPOINT, NOW);
    const match = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, token, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(await verify(token, keys.publicKey)).toBe(true);
    // Another key does not verify it.
    expect(await verify(token, (await makeVapidKeys()).publicKey)).toBe(false);
  });

  it('puts the right claims in the token: the origin of the endpoint, an exp under 12 hours, and the subject', async () => {
    const keys = await makeVapidKeys();
    const header = await vapidAuthorization({ ...keys, subject: 'mailto:madar@vado.sa' }, ENDPOINT, NOW);
    const [head, claims] = /t=([^,]+)/.exec(header)![1].split('.');
    expect(decode(head)).toEqual({ typ: 'JWT', alg: 'ES256' });
    const body = decode(claims);
    expect(body).toEqual({ aud: 'https://fcm.googleapis.com', exp: Math.floor(NOW.getTime() / 1000) + VAPID_LIFETIME_SECONDS, sub: 'mailto:madar@vado.sa' });
    expect(VAPID_LIFETIME_SECONDS).toBeLessThan(12 * 3600);
    expect(VAPID_LIFETIME_SECONDS).toBeGreaterThan(3600);
  });

  it('takes the origin of each push service as the audience, with no path and no port', () => {
    expect(audienceOf('https://updates.push.services.mozilla.com/wpush/v2/gAAAA')).toBe('https://updates.push.services.mozilla.com');
    expect(audienceOf('https://web.push.apple.com/QGsample')).toBe('https://web.push.apple.com');
    expect(audienceOf('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe('https://wns2-par02p.notify.windows.com');
  });

  it('signs a new token for a new time', async () => {
    const keys = await makeVapidKeys();
    const config = { ...keys, subject: 'mailto:madar@vado.sa' };
    const first = await vapidAuthorization(config, ENDPOINT, NOW);
    const later = await vapidAuthorization(config, ENDPOINT, new Date(NOW.getTime() + 3_600_000));
    expect(later).not.toBe(first);
  });

  it('refuses a key of the wrong size with an error that names the variable and never the value', async () => {
    const keys = await makeVapidKeys();
    const secret = 'c2hvcnQ';
    await expect(vapidAuthorization({ ...keys, privateKey: secret, subject: 'mailto:madar@vado.sa' }, ENDPOINT, NOW)).rejects.toThrow(/VAPID_PRIVATE_KEY/);
    await expect(vapidAuthorization({ ...keys, publicKey: secret, subject: 'mailto:madar@vado.sa' }, ENDPOINT, NOW)).rejects.toThrow(/VAPID_PUBLIC_KEY/);
    for (const field of ['privateKey', 'publicKey'] as const) {
      const error = await vapidAuthorization({ ...keys, [field]: secret, subject: 'mailto:madar@vado.sa' }, ENDPOINT, NOW).catch((e: Error) => e);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain(keys.privateKey);
    }
  });
});

describe('vapidConfigOf', () => {
  const read = (values: Record<string, string>) => (name: string) => values[name];

  it('gives nothing when no VAPID value is set: push is off', () => {
    expect(vapidConfigOf(read({}))).toBeUndefined();
  });

  it('gives the three values when all are set', () => {
    expect(vapidConfigOf(read({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:madar@vado.sa' }))).toEqual({
      publicKey: 'pub', privateKey: 'priv', subject: 'mailto:madar@vado.sa',
    });
  });

  it('names every missing variable when only some are set', () => {
    expect(() => vapidConfigOf(read({ VAPID_PUBLIC_KEY: 'pub' }))).toThrow(/Missing: VAPID_PRIVATE_KEY, VAPID_SUBJECT/);
    expect(() => vapidConfigOf(read({ VAPID_PRIVATE_KEY: 'priv-secret-value' }))).toThrow(/VAPID_PUBLIC_KEY, VAPID_SUBJECT/);
    try {
      vapidConfigOf(read({ VAPID_PRIVATE_KEY: 'priv-secret-value' }));
    } catch (error) {
      expect(error).toBeInstanceOf(PushConfigError);
      expect((error as Error).message).not.toContain('priv-secret-value');
    }
  });

  it('refuses a subject that is not a mailto or https address', () => {
    expect(() => vapidConfigOf(read({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'madar@vado.sa' }))).toThrow(/VAPID_SUBJECT/);
  });
});
