import { describe, expect, it } from 'vitest';
import { ownPublicJwks } from '../../server/auth/ownKeys';
import { authKeyTarget, newAuthKey } from './auth-key';

describe('a new sign-in key (scripts/office/auth-key.ts)', () => {
  it('makes a P-256 private JWK with a kid, whose public set has one key with no private part', async () => {
    const jwk = JSON.parse(await newAuthKey()) as { kty: string; crv: string; d?: string; kid?: string };
    expect([jwk.kty, jwk.crv, typeof jwk.d, typeof jwk.kid]).toEqual(['EC', 'P-256', 'string', 'string']);
    const set = ownPublicJwks(JSON.stringify(jwk));
    expect(set.keys).toHaveLength(1);
    expect(set.keys[0]).not.toHaveProperty('d');
  });

  it('makes a new key each time', async () => {
    expect(await newAuthKey()).not.toBe(await newAuthKey());
  });

  it('takes the test copy, and production only with the typed word (plan E: the sign-in key is set before the switch)', () => {
    expect(authKeyTarget(['test'])).toEqual({ target: 'test', typed: false });
    expect(authKeyTarget(['production'])).toEqual({ target: 'production', typed: true });
    expect(() => authKeyTarget([])).toThrow('test or production');
    expect(() => authKeyTarget(['staging'])).toThrow('test or production');
    expect(() => authKeyTarget(['Production'])).toThrow('test or production');
  });
});
