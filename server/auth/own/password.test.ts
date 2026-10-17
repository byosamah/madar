import { describe, expect, it } from 'vitest';
import { equalText, pkceChallengeOf, randomToken, sha256Hex } from './crypto';
import { hashPassword, PASSWORD_MIN, PBKDF2_ROUNDS, verifyPassword } from './password';

describe('the passwords of the own sign-in (server/auth/own/password.ts)', () => {
  it('uses 100,000 rounds: deployed Workers refuse more, and local workerd does not show it', () => {
    expect(PBKDF2_ROUNDS).toBe(100_000);
    expect(PASSWORD_MIN).toBe(8);
  });

  it('keeps the rounds, the salt and the hash in one text', async () => {
    expect(await hashPassword('a good password')).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('a good password');
    expect(await verifyPassword('a good password', stored)).toEqual({ ok: true, upgrade: false });
    expect(await verifyPassword('a good passworD', stored)).toEqual({ ok: false, upgrade: false });
  });

  it('gives each hash its own salt', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('refuses a stored hash with more rounds than the Workers allow, and a text of another form', async () => {
    const [, , salt, hash] = (await hashPassword('x')).split('$');
    expect(await verifyPassword('x', `pbkdf2-sha256$100001$${salt}$${hash}`)).toEqual({ ok: false, upgrade: false });
    expect(await verifyPassword('x', 'plain text')).toEqual({ ok: false, upgrade: false });
    expect(await verifyPassword('x', null)).toEqual({ ok: false, upgrade: false });
  });

  it('asks for a new hash when a stored hash has fewer rounds', async () => {
    const [, , salt] = (await hashPassword('x')).split('$');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('x'), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(salt.replace(/-/g, '+').replace(/_/g, '/') + '=='), (c) => c.charCodeAt(0)), iterations: 1000 }, key, 256));
    const hash = btoa(String.fromCharCode(...bits)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyPassword('x', `pbkdf2-sha256$1000$${salt}$${hash}`)).toEqual({ ok: true, upgrade: true });
  });

  it('makes random tokens of 32 bytes and the sha256 and PKCE forms of a text', async () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // RFC 7636, appendix B.
    expect(await pkceChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(equalText('abc', 'abc')).toBe(true);
    expect(equalText('abc', 'abd')).toBe(false);
    expect(equalText('abc', 'abcd')).toBe(false);
  });
});
