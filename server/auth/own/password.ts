import { base64url } from 'jose';
import { isBcryptHash, verifyBcrypt } from './bcrypt';

/**
 * The password hash of the own sign-in (Supabase exit, wave 2; spec section 2): PBKDF2 with SHA-256.
 * - 100,000 rounds. Deployed Workers refuse more ("iteration counts above 100000 are not supported"); local workerd accepts more,
 *   so only the test of this file pins the number. A stored hash with more rounds can never verify on a Worker: it is refused.
 * - The CPU: 30 to 35 ms in the office object (wave 0). The Worker never hashes: Workers Free stops it at 10 ms under load.
 * - The form: pbkdf2-sha256$<rounds>$<salt, 16 bytes>$<hash, 32 bytes>, base64url.
 * - A stored text of another form (no password yet, an unknown email) runs one hash anyway, so the answer takes the same time.
 * - A bcrypt hash copied from Supabase Auth (owner decision 4, bcrypt.ts) verifies once and asks for an upgrade.
 */

export const PBKDF2_ROUNDS = 100_000;
/** The shortest password: minimum_password_length of supabase/config.toml and MIN_PASSWORD of the screens. */
export const PASSWORD_MIN = 8;
const PREFIX = 'pbkdf2-sha256';
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export type PasswordCheck = { ok: boolean; upgrade: boolean };

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, HASH_BYTES * 8));
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return `${PREFIX}$${PBKDF2_ROUNDS}$${base64url.encode(salt)}$${base64url.encode(await derive(password, salt, PBKDF2_ROUNDS))}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<PasswordCheck> {
  // A bcrypt hash copied from Supabase Auth (owner decision 4): the right password asks for a PBKDF2 hash in its place.
  if (stored !== null && isBcryptHash(stored)) {
    const ok = verifyBcrypt(password, stored);
    return { ok, upgrade: ok };
  }
  const parts = (stored ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    await derive(password, new Uint8Array(SALT_BYTES), PBKDF2_ROUNDS);
    return { ok: false, upgrade: false };
  }
  const rounds = Number(parts[1]);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > PBKDF2_ROUNDS) return { ok: false, upgrade: false };
  let salt: Uint8Array<ArrayBuffer>;
  let want: Uint8Array;
  try {
    // A copy: Web Crypto takes a salt on a plain ArrayBuffer.
    salt = new Uint8Array(base64url.decode(parts[2]));
    want = base64url.decode(parts[3]);
  } catch {
    return { ok: false, upgrade: false };
  }
  return { ok: equalBytes(await derive(password, salt, rounds), want), upgrade: rounds < PBKDF2_ROUNDS };
}
