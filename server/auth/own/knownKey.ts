import type { EnterpriseId } from '../../enterprise/ids';
import { UNKNOWN_ADDRESS } from '../rateLimit';

/**
 * The pair key of a known sign-in address (review 2026-11-10, task K2b). The tables auth_known_addresses (each office object) and
 * platform_known_addresses (the platform object) keep the pair of an email and an address for 90 days. A plain sha256 of the pair is open to
 * a guess: an email is known, and IPv4 has only 4 billion addresses. So a reader of a database copy or of a backup could test "did this
 * person sign in from this address?". The pair key is an HMAC-SHA-256 under a key that HKDF derives from the server secret (MADAR_SECRET_KEY,
 * or the first key of SUPABASE_SECRET_KEYS: ServerEnv.secretKey). That secret is in no database and in no backup, so a copy of the database
 * cannot check a guess.
 *
 * Each object gets its own key: the HKDF info text holds the enterprise id (madar-known-address:<ent>), or "platform" for the platform
 * object. A new server secret gives new keys: every address then reads as not known, and the person becomes known again at the next
 * sign-in. WebCrypto only, so this file runs on Workers and on Node. Never log the secret, the derived key, or a text with its key.
 */

/** The owner of a key: the enterprise of an office object, or the platform object. */
export type KnownOwner = EnterpriseId | 'platform';

/** The keyed form of one text, as hashedKey gives it: "<prefix>:<64 hex>". The text is trimmed and lower-case first, as in hashedKey. */
export type KnownKey = (prefix: string, text: string) => Promise<string>;

const encoder = new TextEncoder();

/** The HKDF info text of the key of one owner. */
export const knownInfoOf = (owner: KnownOwner): string => `madar-known-address:${owner}`;

/** The HMAC key of one owner. An empty secret throws an error that names the variable: no step falls back to the plain hash. */
async function deriveKnownKey(secret: string, owner: KnownOwner): Promise<CryptoKey> {
  if (secret === '') throw new Error('The server secret key (MADAR_SECRET_KEY) is empty: the key of the known addresses needs it.');
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(knownInfoOf(owner)) },
    base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
}

/**
 * The keyed form for one server secret and one owner. The function derives the key at its first use and keeps it for its own life (an
 * object keeps one function). A failed derive is not kept, so the next use tries again.
 */
export function knownKeyOf(secret: string, owner: KnownOwner): KnownKey {
  let key: Promise<CryptoKey> | undefined;
  return async (prefix, text) => {
    if (!key) {
      const next = deriveKnownKey(secret, owner);
      key = next;
      next.catch(() => {
        if (key === next) key = undefined;
      });
    }
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key, encoder.encode(text.trim().toLowerCase())));
    return `${prefix}:${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  };
}

/**
 * True when an address (after limitAddress) can become known. The fallback of clientAddress (UNKNOWN_ADDRESS: no address header) and an
 * empty text are no place: the step reads no row and writes no row for them, so the total of the email always applies.
 */
export const knowableAddress = (address: string): boolean => address !== '' && address !== UNKNOWN_ADDRESS;
