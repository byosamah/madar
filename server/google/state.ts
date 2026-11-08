import { isEnterpriseId, type EnterpriseId } from '../enterprise/ids';
import { base64url, base64urlDecode } from '../push/vapid';
import type { GoogleKeys } from './keys';

/**
 * The state of the Google connect (fbk_022). The server signs it when a person starts the connect, Google sends it back to the
 * callback, and the signed-in screen hands it to google.connect. It ties the Google screen to one person for 10 minutes.
 *
 * state = base64url(JSON { u: person, n: 16 random bytes, e: expiry in seconds, ent: enterprise }) + '.' + base64url(HMAC-SHA256).
 * The claim ent (Madar enterprises, design 5.17) tells the callback, which has no sign-in, which keys to derive. The HMAC key of the state
 * holds the enterprise id too, so a state of one enterprise never verifies for another, and a state with no valid ent reads as bad.
 * The PKCE verifier (RFC 7636) needs no storage: it is base64url(HMAC('pkce:' + n)), so the server makes it again from the nonce
 * in the state, and nobody without the key can.
 */

export const STATE_LIFE_MS = 600_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function mac(keys: GoogleKeys, text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', keys.sign, encoder.encode(text)));
}

/** The S256 challenge of a verifier: base64url(SHA-256(verifier)). */
export async function challengeOf(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
}

const verifierOf = async (keys: GoogleKeys, nonce: string): Promise<string> => base64url(await mac(keys, `pkce:${nonce}`));

export async function signState(keys: GoogleKeys, userId: string, now: Date, ent: EnterpriseId): Promise<{ state: string; challenge: string }> {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const expiry = Math.floor(now.getTime() / 1000) + STATE_LIFE_MS / 1000;
  const payload = base64url(encoder.encode(JSON.stringify({ u: userId, n: nonce, e: expiry, ent })));
  const signature = base64url(await mac(keys, `state:${payload}`));
  return { state: `${payload}.${signature}`, challenge: await challengeOf(await verifierOf(keys, nonce)) };
}

export type StateRead = { ok: true; userId: string; ent: EnterpriseId; verifier: string } | { ok: false; why: 'bad' | 'old' };

/** The person and the verifier of a state. A changed or foreign state gives bad (also when it is old); a true state past 10 minutes gives old. */
export async function readState(keys: GoogleKeys, state: string, now: Date): Promise<StateRead> {
  const bad: StateRead = { ok: false, why: 'bad' };
  try {
    const parts = state.split('.');
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return bad;
    const [payload, signature] = parts;
    const signed = await crypto.subtle.verify('HMAC', keys.sign, base64urlDecode(signature), encoder.encode(`state:${payload}`));
    if (!signed) return bad;
    const claims = JSON.parse(decoder.decode(base64urlDecode(payload))) as { u?: unknown; n?: unknown; e?: unknown; ent?: unknown };
    if (typeof claims.u !== 'string' || typeof claims.n !== 'string' || typeof claims.e !== 'number' || !isEnterpriseId(claims.ent)) return bad;
    if (Math.floor(now.getTime() / 1000) > claims.e) return { ok: false, why: 'old' };
    return { ok: true, userId: claims.u, ent: claims.ent, verifier: await verifierOf(keys, claims.n) };
  } catch {
    return bad;
  }
}

/**
 * The claim ent of a state, read WITHOUT the signature: the callback needs it to pick the keys that check the signature. It gives only
 * an id of the enterprise form, or null for any other shape (a text that is not a state, a payload without ent, a bad id). The caller
 * must check the id against the list of enterprises and then verify the state with the keys of that enterprise (readState).
 */
export function entOfState(state: string): EnterpriseId | null {
  try {
    const parts = state.split('.');
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null;
    const claims = JSON.parse(decoder.decode(base64urlDecode(parts[0]))) as { ent?: unknown };
    return isEnterpriseId(claims.ent) ? claims.ent : null;
  } catch {
    return null;
  }
}
