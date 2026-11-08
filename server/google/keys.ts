import { ENT_VADO, isEnterpriseId, type EnterpriseId } from '../enterprise/ids';
import { base64url, base64urlDecode } from '../push/vapid';

/**
 * The secrets of the Google Calendar connect and the sealed refresh token (fbk_022, owner 2026-10-19).
 *
 * Three values, all or none (the rule of the VAPID keys): GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are the OAuth client of the
 * Google Cloud project. MADAR_GOOGLE_KEY is 32 random bytes in base64, one key for each copy. From it, HKDF-SHA256 makes two keys:
 * one seals the refresh token of a person (AES-256-GCM), one signs the state of the connect (HMAC-SHA256). WebCrypto only, so this
 * file runs on Supabase Edge Functions, Cloudflare Workers and Node.
 *
 * Madar enterprises (design 5.17): the one MADAR_GOOGLE_KEY serves every enterprise, but each enterprise gets its own two keys, because the
 * HKDF info text holds the enterprise id. A sealed token or a state of one enterprise never opens for another. ENT_VADO keeps the info
 * texts it always had, so the sealed tokens that the move imports still open.
 *
 * An error here names a variable or a code, never a value, a token or a person.
 */

export type GoogleConfig = { clientId: string; clientSecret: string; key: string };

/** The names of the three function secrets. */
export const GOOGLE_NAMES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MADAR_GOOGLE_KEY'] as const;

/** The three values from the environment. None set means Google is off (undefined). Some but not all is a mistake. */
export function googleConfigOf(read: (name: string) => string | undefined): GoogleConfig | undefined {
  const [clientId, clientSecret, key] = GOOGLE_NAMES.map((name) => read(name));
  if (clientId === undefined && clientSecret === undefined && key === undefined) return undefined;
  const missing = GOOGLE_NAMES.filter((name) => read(name) === undefined);
  if (missing.length > 0) throw new GoogleConfigError(`Google Calendar needs all of ${GOOGLE_NAMES.join(', ')}. Missing: ${missing.join(', ')}.`);
  return { clientId: clientId!, clientSecret: clientSecret!, key: key! };
}

/** A Google config that is wrong. The message names the variable, never a value. */
export class GoogleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleConfigError';
  }
}

/** A sealed text that does not open: a wrong key, a wrong person or a changed text. The message is a code and holds no detail. */
export class SealBroken extends Error {
  constructor() {
    super('seal_broken');
    this.name = 'SealBroken';
  }
}

export type GoogleKeys = { seal: CryptoKey; sign: CryptoKey };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SEAL_INFO = 'madar-google-seal';
const STATE_INFO = 'madar-google-state';
const IV_BYTES = 12;
const VERSION = 'v1';

/** The 32 bytes of MADAR_GOOGLE_KEY, or an error that names the variable. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new GoogleConfigError('MADAR_GOOGLE_KEY must be 32 bytes in base64.');
  const binary = atob(key);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The most key pairs that an isolate keeps. At the limit the cache drops all of them: a flood of ids cannot grow it. */
export const GOOGLE_KEY_CACHE_MAX = 64;
const cache = new Map<string, Promise<GoogleKeys>>();

/** The number of key pairs that the isolate holds now (a test reads it). */
export const googleKeyCacheSize = (): number => cache.size;

/** The HKDF info text: the old text for ENT_VADO, and the old text with ":<ent>" for every other enterprise. */
const infoOf = (base: string, ent: EnterpriseId): string => (ent === ENT_VADO ? base : `${base}:${ent}`);

/**
 * The two keys of one MADAR_GOOGLE_KEY for one enterprise (ENT_VADO when none is given), kept for the life of the isolate: the HKDF import
 * is the one slow step. An id that is not an enterprise id throws, so no text can name a key that no enterprise owns.
 */
export function googleKeysOf(key: string, ent: EnterpriseId = ENT_VADO): Promise<GoogleKeys> {
  if (!isEnterpriseId(ent)) return Promise.reject(new Error('The enterprise id is not valid.'));
  const slot = `${ent}|${key}`;
  let found = cache.get(slot);
  if (!found) {
    found = (async () => {
      const base = await crypto.subtle.importKey('raw', keyBytes(key), 'HKDF', false, ['deriveKey']);
      const salt = new Uint8Array(0);
      const seal = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(infoOf(SEAL_INFO, ent)) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const sign = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(infoOf(STATE_INFO, ent)) }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
      return { seal, sign };
    })();
    if (cache.size >= GOOGLE_KEY_CACHE_MAX) cache.clear();
    cache.set(slot, found);
    found.catch(() => cache.delete(slot));
  }
  return found;
}

/** The additional data of the seal: the cipher text opens for this person only. */
const aadOf = (userId: string) => encoder.encode(`madar-google:${userId}`);

/** 'v1.' + base64url(12 byte iv) + '.' + base64url(cipher and tag). */
export async function sealToken(keys: GoogleKeys, userId: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(userId) }, keys.seal, encoder.encode(token)));
  return `${VERSION}.${base64url(iv)}.${base64url(cipher)}`;
}

/** The token of a sealed text. A wrong key, a wrong person or a changed text throws SealBroken. */
export async function openToken(keys: GoogleKeys, userId: string, sealed: string): Promise<string> {
  try {
    const parts = sealed.split('.');
    if (parts.length !== 3 || parts[0] !== VERSION) throw new SealBroken();
    const iv = base64urlDecode(parts[1]);
    if (iv.length !== IV_BYTES) throw new SealBroken();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aadOf(userId) }, keys.seal, base64urlDecode(parts[2]));
    return decoder.decode(plain);
  } catch {
    // Every failure reads the same, so nothing tells a wrong key from a wrong person.
    throw new SealBroken();
  }
}
