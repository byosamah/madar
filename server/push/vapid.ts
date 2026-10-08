/**
 * VAPID for browser push (RFC 8292; owner, 2026-10-08). The server proves with a signed token that it is the one the page named
 * when the browser made the subscription. The token is an ES256 JWT, signed with WebCrypto only, so this file runs the same on
 * Supabase Edge Functions (Deno), Cloudflare Workers and Node. No Node API and no package.
 *
 * Keys: VAPID_PRIVATE_KEY is the raw 32 byte P-256 private value as base64url. VAPID_PUBLIC_KEY is the 65 byte uncompressed
 * point (0x04, X, Y) as base64url. VAPID_SUBJECT is a mailto: or https: address of the sender. An error here names a variable and
 * never holds a value.
 */

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** The names of the three function secrets. */
export const VAPID_NAMES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;

/** A token lives under 12 hours (the rule of the owner; RFC 8292 allows up to 24). */
export const VAPID_LIFETIME_SECONDS = 11 * 3600;

/** A push config that is missing or wrong. The message names the variable, never a value. */
export class PushConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushConfigError';
  }
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The bytes of a key, or an error that names the variable. */
function keyBytes(name: 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY', text: string, length: number): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64urlDecode(text);
  } catch {
    throw new PushConfigError(`${name} is not base64url text.`);
  }
  if (bytes.length !== length) throw new PushConfigError(`${name} must be ${length} bytes as base64url (${name === 'VAPID_PRIVATE_KEY' ? 'the raw private value' : 'the uncompressed public point'}).`);
  if (name === 'VAPID_PUBLIC_KEY' && bytes[0] !== 4) throw new PushConfigError('VAPID_PUBLIC_KEY must be an uncompressed P-256 point.');
  return bytes;
}

/** A new P-256 key pair in the form of the three secrets (scripts/push/make-vapid.ts). */
export async function makeVapidKeys(): Promise<Pick<VapidConfig, 'publicKey' | 'privateKey'>> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey, privateKey: jwk.d! };
}

/** The signing key for one pair, kept for the life of the isolate: importing it is the one slow step. */
const signingKeys = new Map<string, Promise<CryptoKey>>();

function signingKey(config: VapidConfig): Promise<CryptoKey> {
  // Check first, so a wrong key fails with its own message and not with a WebCrypto error.
  const point = keyBytes('VAPID_PUBLIC_KEY', config.publicKey, 65);
  keyBytes('VAPID_PRIVATE_KEY', config.privateKey, 32);
  const id = `${config.privateKey}:${config.publicKey}`;
  let key = signingKeys.get(id);
  if (!key) {
    const jwk = { kty: 'EC', crv: 'P-256', d: config.privateKey, x: base64url(point.slice(1, 33)), y: base64url(point.slice(33, 65)), ext: true };
    key = crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']).catch(() => {
      signingKeys.delete(id);
      throw new PushConfigError('VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY are not one P-256 pair.');
    });
    signingKeys.set(id, key);
  }
  return key;
}

/** The origin of the push service: the audience of the token (RFC 8292, section 2). */
export function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

const encoder = new TextEncoder();

/** The Authorization header of one push: `vapid t=<token>, k=<public key>`. */
export async function vapidAuthorization(config: VapidConfig, endpoint: string, now: Date): Promise<string> {
  const key = await signingKey(config);
  const head = base64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64url(encoder.encode(JSON.stringify({ aud: audienceOf(endpoint), exp: Math.floor(now.getTime() / 1000) + VAPID_LIFETIME_SECONDS, sub: config.subject })));
  // WebCrypto gives the signature as r then s (64 bytes), which is the form a JWT needs.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${base64url(signature)}, k=${config.publicKey}`;
}

/**
 * The push config from the environment. None of the three values set means push is off (undefined). Some but not all is a
 * mistake: the error names each missing variable.
 */
export function vapidConfigOf(read: (name: string) => string | undefined): VapidConfig | undefined {
  const [publicKey, privateKey, subject] = VAPID_NAMES.map((name) => read(name));
  if (publicKey === undefined && privateKey === undefined && subject === undefined) return undefined;
  const missing = VAPID_NAMES.filter((name) => read(name) === undefined);
  if (missing.length > 0) throw new PushConfigError(`Push needs all of ${VAPID_NAMES.join(', ')}. Missing: ${missing.join(', ')}.`);
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject!)) throw new PushConfigError('VAPID_SUBJECT must be a mailto: or https: address.');
  return { publicKey: publicKey!, privateKey: privateKey!, subject: subject! };
}
