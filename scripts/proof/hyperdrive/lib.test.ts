import { describe, expect, it } from 'vitest';
import { CONFIGS, configBody, envValue, median, originOf, redact, sameSecret, summary } from './lib.ts';

const URL_TX = 'postgresql://madar_server.qdgwpnesxppnqsaabqzd:pa%40ss@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

describe('originOf', () => {
  it('takes the origin fields of the test pooler URL and sets the port of the config', () => {
    expect(originOf(URL_TX, 5432)).toEqual({
      scheme: 'postgres',
      host: 'aws-1-eu-central-1.pooler.supabase.com',
      port: 5432,
      user: 'madar_server.qdgwpnesxppnqsaabqzd',
      password: 'pa@ss',
      database: 'postgres',
    });
  });

  it('refuses the production project in any part of the URL', () => {
    expect(() => originOf(URL_TX.replace('qdgwpnesxppnqsaabqzd', 'oprkvdjudjxxhvodkzgs'), 5432)).toThrow(/production/);
  });

  it('refuses a user of another project, another host, another database and a URL without a password', () => {
    expect(() => originOf(URL_TX.replace('madar_server.qdgwpnesxppnqsaabqzd', 'madar_server.other'), 5432)).toThrow(/user/);
    expect(() => originOf(URL_TX.replace('aws-1-eu-central-1.pooler', 'db.qdgwpnesxppnqsaabqzd'), 5432)).toThrow(/host/);
    expect(() => originOf(URL_TX.replace('/postgres', '/other'), 5432)).toThrow(/database/);
    expect(() => originOf(URL_TX.replace(':pa%40ss', ''), 5432)).toThrow(/password/);
  });

  it('never puts the password in an error text', () => {
    try {
      originOf(URL_TX.replace('/postgres', '/other'), 5432);
    } catch (error) {
      expect(String(error)).not.toContain('pa@ss');
      expect(String(error)).not.toContain('pa%40ss');
    }
  });
});

describe('configBody', () => {
  it('turns caching off and asks verify-full with the CA', () => {
    const body = configBody('madar-db-test', originOf(URL_TX, 5432), 'ca-1');
    expect(body.caching).toEqual({ disabled: true });
    expect(body.mtls).toEqual({ ca_certificate_id: 'ca-1', sslmode: 'verify-full' });
    expect(body.origin.port).toBe(5432);
    expect(body.name).toBe('madar-db-test');
  });

  it('sends no CA with sslmode require (the API refuses a CA with require)', () => {
    const body = configBody('madar-db-test', originOf(URL_TX, 5432), 'ca-1', 'require');
    expect(body.mtls).toEqual({ sslmode: 'require' });
  });
});

describe('CONFIGS', () => {
  it('names the session pooler and the transaction pooler', () => {
    expect(CONFIGS.map((c) => [c.name, c.port, c.binding])).toEqual([
      ['madar-db-test', 5432, 'DB_SESSION'],
      ['madar-db-test-tx', 6543, 'DB_TX'],
    ]);
  });
});

describe('summary', () => {
  it('keeps the names and drops any password', () => {
    const out = summary({
      id: 'x1',
      name: 'n',
      origin: { host: 'h', port: 5432, user: 'u', password: 'secret', database: 'postgres', scheme: 'postgres' },
      caching: { disabled: true },
      mtls: { ca_certificate_id: 'c', sslmode: 'verify-full' },
      origin_connection_limit: 5,
    });
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(out).toMatchObject({ id: 'x1', name: 'n', host: 'h', port: 5432, user: 'u', cachingDisabled: true, sslmode: 'verify-full', caId: 'c' });
  });
});

describe('median', () => {
  it('gives the middle value, and the mean of the two middle values for an even count', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('sameSecret', () => {
  it('accepts only the same text', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', '')).toBe(false);
    expect(sameSecret(null, 'abc')).toBe(false);
  });
});

describe('envValue', () => {
  it('reads one value of an env file, with or without quotes', () => {
    const text = 'A=1\nDATABASE_URL="postgres://x"\n# B=2\nC=\'z\'\n';
    expect(envValue(text, 'DATABASE_URL')).toBe('postgres://x');
    expect(envValue(text, 'C')).toBe('z');
    expect(envValue(text, 'B')).toBeUndefined();
  });
});

describe('redact', () => {
  it('removes each secret and its URL-encoded form', () => {
    expect(redact('a pa@ss b pa%40ss', ['pa@ss'])).toBe('a [redacted] b [redacted]');
  });
});
