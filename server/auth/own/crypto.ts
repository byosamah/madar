import { base64url } from 'jose';

/**
 * The small crypto steps of the own sign-in (Supabase exit, wave 2). crypto.subtle is async, so a caller in the office object
 * runs these before or after a transaction, never inside one (Global Constraints).
 */

/** A random secret: link tokens, refresh tokens, OAuth codes. 32 bytes is 256 bits. */
export function randomToken(bytes = 32): string {
  return base64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The sha256 of a text in hex. The database keeps this form of every token, never the token. */
export async function sha256Hex(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The S256 challenge of a PKCE verifier (RFC 7636, section 4.2). */
export async function pkceChallengeOf(verifier: string): Promise<string> {
  return base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** A compare that takes the same time for each text of one length. */
export function equalText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
