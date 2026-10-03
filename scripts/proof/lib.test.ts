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
  scramSha256Verifier,
  serverRoleSql,
} from './lib.ts';
import { createHash, createHmac } from 'node:crypto';

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

describe('scramSha256Verifier', () => {
  // RFC 7677, section 3: user "user", password "pencil", salt W22ZaJ0SNY7soEsUEjb6gQ==, 4096 iterations.
  const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
  const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
  const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;

  it('builds the Postgres form of the RFC 7677 example, so the server signature and the client proof of the RFC check out', () => {
    const verifier = scramSha256Verifier('pencil', salt);
    const match = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(verifier);
    expect(match).not.toBeNull();
    const [, saltB64, storedB64, serverB64] = match!;
    expect(saltB64).toBe('W22ZaJ0SNY7soEsUEjb6gQ==');
    const serverSignature = createHmac('sha256', Buffer.from(serverB64, 'base64')).update(authMessage).digest('base64');
    expect(serverSignature).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const clientSignature = createHmac('sha256', Buffer.from(storedB64, 'base64')).update(authMessage).digest();
    const clientKey = Buffer.from(proof.map((byte, i) => byte ^ clientSignature[i]));
    expect(createHash('sha256').update(clientKey).digest('base64')).toBe(storedB64);
  });

  it('uses a new random salt for each call when none is given', () => {
    expect(scramSha256Verifier('pencil')).not.toBe(scramSha256Verifier('pencil'));
  });

  it('refuses a password that is not printable ASCII, because Postgres would SASLprep it first', () => {
    expect(() => scramSha256Verifier('p\u00e4ss')).toThrow(/ASCII/);
    expect(() => scramSha256Verifier('')).toThrow(/ASCII/);
  });
});

describe('serverRoleSql', () => {
  it('sets the madar_server password as a SCRAM verifier, so the statement (and the DDL log) never holds the plain password', () => {
    const password = 'Zx9_plain-password-value-123';
    const sql = serverRoleSql(password);
    expect(sql).toMatch(/^alter role madar_server with login noinherit password 'SCRAM-SHA-256\$4096:[^']+'$/);
    expect(sql).not.toContain(password);
  });
});
