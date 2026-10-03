import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_REF,
  TEST_REF,
  assertTestRef,
  decodeJwtPayload,
  parseContentDisposition,
  pkceChallenge,
  poolerConfig,
  redact,
} from './lib.ts';

describe('assertTestRef', () => {
  it('accepts only the test project madar-test', () => {
    expect(assertTestRef(TEST_REF)).toBe(TEST_REF);
  });

  it('refuses the production project and every other ref, so a probe can never change production', () => {
    expect(() => assertTestRef(PRODUCTION_REF)).toThrow(/madar-test/);
    expect(() => assertTestRef('abcdefghijklmnopqrst')).toThrow(/madar-test/);
    expect(() => assertTestRef('')).toThrow(/madar-test/);
  });
});

describe('poolerConfig', () => {
  it('builds a transaction pooler connection for a custom role, with the CA and a verified certificate', () => {
    expect(poolerConfig({ ref: TEST_REF, role: 'madar_server', password: 'pw', mode: 'transaction', ca: 'CA' })).toEqual({
      host: 'aws-1-eu-central-1.pooler.supabase.com',
      port: 6543,
      user: `madar_server.${TEST_REF}`,
      password: 'pw',
      database: 'postgres',
      ssl: { ca: 'CA', rejectUnauthorized: true, servername: 'aws-1-eu-central-1.pooler.supabase.com' },
    });
  });

  it('uses port 5432 for the session pooler, and no TLS when ca is false', () => {
    const config = poolerConfig({ ref: TEST_REF, role: 'postgres', password: 'pw', mode: 'session', ca: false });
    expect(config.port).toBe(5432);
    expect(config.ssl).toBe(false);
  });

  it('refuses the production project', () => {
    expect(() => poolerConfig({ ref: PRODUCTION_REF, role: 'postgres', password: 'pw', mode: 'session', ca: false })).toThrow(/madar-test/);
  });
});

describe('decodeJwtPayload', () => {
  it('reads the claims of a token without a check of the signature', () => {
    const payload = Buffer.from(JSON.stringify({ aud: 'https://x/functions/v1/mcp', client_id: 'c1' })).toString('base64url');
    expect(decodeJwtPayload(`h.${payload}.s`)).toEqual({ aud: 'https://x/functions/v1/mcp', client_id: 'c1' });
  });

  it('refuses a value that is not a token', () => {
    expect(() => decodeJwtPayload('not-a-token')).toThrow(/token/);
  });
});

describe('parseContentDisposition', () => {
  it('reads the type, the ASCII fallback and the RFC 5987 UTF-8 name', () => {
    expect(
      parseContentDisposition(`attachment; filename="plan.pdf"; filename*=UTF-8''%D9%85%D8%AE%D8%B7%D8%B7.pdf`),
    ).toEqual({ type: 'attachment', filename: 'plan.pdf', filenameStar: 'مخطط.pdf' });
  });

  it('reads a header with a plain name only, and a missing header', () => {
    expect(parseContentDisposition('inline; filename=a.txt')).toEqual({ type: 'inline', filename: 'a.txt' });
    expect(parseContentDisposition(null)).toEqual({ type: '' });
  });
});

describe('pkceChallenge', () => {
  it('gives the S256 challenge of RFC 7636, appendix B', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('redact', () => {
  it('replaces every secret in a text, so a probe log never holds one', () => {
    expect(redact('key=abc123 again abc123, pw=xyz', ['abc123', 'xyz', ''])).toBe('key=[secret] again [secret], pw=[secret]');
  });
});
