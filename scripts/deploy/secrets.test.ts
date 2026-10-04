import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkSecrets,
  parseSecretsFile,
  runSecrets,
  scramSha256Verifier,
  serverRoleSql,
  type Query,
  type SecretsRun,
} from './secrets.ts';

/** scripts/deploy/secrets.ts (plan 5.9; proof Z0a, item 3): function secrets, Vault, platform_config and the madar_server role. */
const TEST = 'qdgwpnesxppnqsaabqzd';
const PRODUCTION = 'oprkvdjudjxxhvodkzgs';
const SERVER_PASSWORD = 'Server-Password-1234';
const ROOT_CA = readFileSync(new URL('../../config/supabase-root-2021-ca.crt', import.meta.url), 'utf8');

const dbUrl = (ref: string, password = SERVER_PASSWORD) => `postgresql://madar_server.${ref}:${password}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`;

function file(ref = TEST, extra = ''): string {
  return [
    '# test deploy secrets',
    `DATABASE_URL=${dbUrl(ref)}`,
    'APP_URL=https://preview.madar.pages.dev',
    'MAIL_FROM="Madar <notices@example.com>"',
    'RESEND_API_KEY=re_secret_value_1',
    'JOBS_SECRET=jobs-secret-value-1',
    extra,
  ].join('\n');
}

/** A run with fakes: it records each database statement, each Management API request and each log line. */
function harness(o: { target?: 'test' | 'production'; text?: string; env?: Record<string, string>; answer?: string; dryRun?: boolean } = {}) {
  const sql: { text: string; values?: unknown[] }[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const logs: string[] = [];
  const asked: string[] = [];
  const query: Query = async (text, values) => {
    sql.push({ text, values });
    return { rowCount: text.includes('update_secret') ? 0 : 1 };
  };
  const run: SecretsRun = {
    target: o.target ?? 'test',
    text: o.text ?? file(o.target === 'production' ? PRODUCTION : TEST),
    rootCa: ROOT_CA,
    env: o.env ?? { SUPABASE_ACCESS_TOKEN: 'sbp_token_value', MADAR_TEST_DB_PASSWORD: 'pg-test-pw', MADAR_DB_PASSWORD: 'pg-prod-pw' },
    dryRun: o.dryRun ?? false,
    connect: async () => ({ query, end: async () => undefined }),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response('[]', { status: 200 });
    },
    ask: async (question) => {
      asked.push(question);
      return o.answer ?? '';
    },
    log: (line) => logs.push(line),
  };
  return { run, sql, requests, logs, asked };
}

const secretValues = [SERVER_PASSWORD, 're_secret_value_1', 'jobs-secret-value-1', 'sbp_token_value', 'pg-test-pw', 'pg-prod-pw'];

describe('parseSecretsFile', () => {
  it('refuses SUPABASE_URL and every other SUPABASE_ name, because Supabase injects them', () => {
    expect(() => parseSecretsFile(file(TEST, 'SUPABASE_URL=https://x.supabase.co'))).toThrow(/SUPABASE_URL.*SUPABASE_/s);
    expect(() => parseSecretsFile(file(TEST, 'SUPABASE_SECRET_KEYS={}'))).toThrow(/SUPABASE_SECRET_KEYS/);
  });

  it('refuses a name the server does not read, a name twice, and DATABASE_CA (secrets.ts sets the root certificate itself)', () => {
    expect(() => parseSecretsFile(file(TEST, 'RESEND_KEY=abc'))).toThrow(/RESEND_KEY/);
    expect(() => parseSecretsFile(file(TEST, 'JOBS_SECRET=again'))).toThrow(/JOBS_SECRET.*twice/);
    expect(() => parseSecretsFile(file(TEST, 'DATABASE_CA=pem'))).toThrow(/DATABASE_CA/);
    expect(() => parseSecretsFile(file(TEST, 'no equals sign here'))).toThrow(/line 7/);
  });

  it('never puts a value into its error', () => {
    for (const extra of ['SUPABASE_URL=leaky-value-1', 'OTHER_NAME=leaky-value-1', 'JOBS_SECRET=leaky-value-1']) {
      try {
        parseSecretsFile(file(TEST, extra));
        throw new Error('no refusal');
      } catch (error) {
        expect(String(error)).not.toContain('leaky-value-1');
      }
    }
  });

  it('takes quoted values and skips comments and empty lines', () => {
    const values = parseSecretsFile(file());
    expect(values.MAIL_FROM).toBe('Madar <notices@example.com>');
    expect(Object.keys(values)).toEqual(['DATABASE_URL', 'APP_URL', 'MAIL_FROM', 'RESEND_API_KEY', 'JOBS_SECRET']);
  });
});

describe('checkSecrets', () => {
  const check = (ref: string, text: string) => checkSecrets(parseSecretsFile(text), ref);

  it('names each missing value the server needs', () => {
    expect(() => check(TEST, `DATABASE_URL=${dbUrl(TEST)}`)).toThrow(/APP_URL, MAIL_FROM, RESEND_API_KEY, JOBS_SECRET/);
    expect(() => check(TEST, file(TEST, 'MAIL_DRIVER=outbox').replace(/RESEND_API_KEY=.*\n/, ''))).not.toThrow();
    expect(() => check(TEST, file(TEST, 'MADAR_FILE_STORE=r2\nR2_ACCOUNT_ID=d76d34779c63849f5acdf3d6af3751cd'))).toThrow(/R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET/);
  });

  it('takes DATABASE_URL only as madar_server of this project on the transaction pooler, with no TLS setting', () => {
    expect(check(TEST, file()).serverPassword).toBe(SERVER_PASSWORD);
    expect(() => check(TEST, file(PRODUCTION))).toThrow(/madar_server\.qdgwpnesxppnqsaabqzd/);
    expect(() => check(TEST, file().replace('madar_server.', 'postgres.'))).toThrow(/madar_server/);
    expect(() => check(TEST, file().replace(':6543/', ':5432/'))).toThrow(/6543/);
    expect(() => check(TEST, file().replace('/postgres\n', '/postgres?sslmode=require\n'))).toThrow(/TLS/);
    expect(() => check(TEST, file().replace(`:${SERVER_PASSWORD}@`, '@'))).toThrow(/password/);
  });

  it('keeps the MCP URL free of a query, because the OAuth resource URL must not change (plan, change 5)', () => {
    expect(check(TEST, file()).mcpUrl).toBe(`https://${TEST}.supabase.co/functions/v1/mcp`);
    expect(() => check(TEST, file(TEST, `MCP_URL=https://${TEST}.supabase.co/functions/v1/mcp?forceFunctionRegion=eu-central-1`))).toThrow(/MCP_URL/);
  });

  it('wants https screens, never a local address', () => {
    expect(() => check(TEST, file().replace('https://preview.madar.pages.dev', 'http://127.0.0.1:5173'))).toThrow(/APP_URL/);
  });
});

describe('serverRoleSql', () => {
  it('sets the madar_server password as a SCRAM verifier, so the statement and the DDL log never hold the plain password', () => {
    const sql = serverRoleSql(SERVER_PASSWORD);
    expect(sql).toMatch(/^alter role madar_server with login noinherit password 'SCRAM-SHA-256\$4096:[^']+'$/);
    expect(sql).not.toContain(SERVER_PASSWORD);
  });

  it('builds the Postgres form of the RFC 7677 example', () => {
    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
    const [, storedB64, serverB64] = /^SCRAM-SHA-256\$4096:[^$]+\$([^:]+):(.+)$/.exec(scramSha256Verifier('pencil', salt))!;
    expect(createHmac('sha256', Buffer.from(serverB64, 'base64')).update(authMessage).digest('base64')).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const clientSignature = createHmac('sha256', Buffer.from(storedB64, 'base64')).update(authMessage).digest();
    expect(createHash('sha256').update(Buffer.from(proof.map((byte, i) => byte ^ clientSignature[i]))).digest('base64')).toBe(storedB64);
  });

  it('refuses a password that is not printable ASCII', () => {
    expect(() => scramSha256Verifier('päss')).toThrow(/ASCII/);
  });
});

describe('runSecrets', () => {
  it('writes Vault, platform_config and the role in one transaction, with every value as a parameter', async () => {
    const h = harness();
    await runSecrets(h.run);
    const texts = h.sql.map((statement) => statement.text);
    expect(texts[0]).toBe('begin');
    expect(texts.at(-1)).toBe('commit');
    expect(h.sql).toContainEqual({ text: 'select vault.create_secret($2, $1)', values: ['project_url', `https://${TEST}.supabase.co`] });
    expect(h.sql).toContainEqual({ text: 'select vault.create_secret($2, $1)', values: ['jobs_secret', 'jobs-secret-value-1'] });
    expect(h.sql.find((s) => s.text.includes('platform_config'))?.values).toEqual([`https://${TEST}.supabase.co/functions/v1/mcp`]);
    expect(texts.some((text) => text.startsWith('alter role madar_server with login noinherit password'))).toBe(true);
    for (const text of texts) for (const secret of secretValues) expect(text).not.toContain(secret);
  });

  it('updates a Vault secret that exists, and makes it only when it does not', async () => {
    const h = harness();
    h.run.connect = async () => ({
      query: async (text, values) => {
        h.sql.push({ text, values });
        return { rowCount: 1 };
      },
      end: async () => undefined,
    });
    await runSecrets(h.run);
    expect(h.sql.filter((s) => s.text.includes('update_secret'))).toHaveLength(2);
    expect(h.sql.filter((s) => s.text.includes('create_secret'))).toHaveLength(0);
  });

  it('sets the function secrets of the chosen project through the Management API, with the root certificate', async () => {
    const h = harness();
    await runSecrets(h.run);
    expect(h.requests).toHaveLength(1);
    const [request] = h.requests;
    expect(request.url).toBe(`https://api.supabase.com/v1/projects/${TEST}/secrets`);
    expect(request.init.method).toBe('POST');
    expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer sbp_token_value');
    const body = JSON.parse(String(request.init.body)) as { name: string; value: string }[];
    expect(body.map((secret) => secret.name)).toEqual(['DATABASE_URL', 'APP_URL', 'MAIL_FROM', 'RESEND_API_KEY', 'JOBS_SECRET', 'DATABASE_CA']);
    expect(body.find((secret) => secret.name === 'DATABASE_CA')?.value).toBe(ROOT_CA);
  });

  it('logs names only, never a value', async () => {
    const h = harness();
    await runSecrets(h.run);
    expect(h.logs.join('\n')).toContain('JOBS_SECRET');
    for (const secret of secretValues) expect(h.logs.join('\n')).not.toContain(secret);
  });

  it('in a dry run, prints the plan and touches neither the database nor the Management API', async () => {
    const h = harness({ dryRun: true, env: {} });
    await runSecrets(h.run);
    expect(h.sql).toEqual([]);
    expect(h.requests).toEqual([]);
    expect(h.logs.join('\n')).toMatch(/dry run/i);
  });

  it('needs the Madar access token and the database password of the chosen project', async () => {
    await expect(runSecrets(harness({ env: { MADAR_TEST_DB_PASSWORD: 'x' } }).run)).rejects.toThrow(/SUPABASE_ACCESS_TOKEN/);
    await expect(runSecrets(harness({ env: { SUPABASE_ACCESS_TOKEN: 'x', MADAR_DB_PASSWORD: 'y' } }).run)).rejects.toThrow(/MADAR_TEST_DB_PASSWORD/);
  });

  it('rolls the transaction back and sets no function secret when a database step fails', async () => {
    const h = harness();
    h.run.connect = async () => ({
      query: async (text, values) => {
        h.sql.push({ text, values });
        if (text.includes('platform_config')) throw new Error('relation "platform_config" does not exist');
        return { rowCount: 0 };
      },
      end: async () => undefined,
    });
    await expect(runSecrets(h.run)).rejects.toThrow(/platform_config/);
    expect(h.sql.at(-1)?.text).toBe('rollback');
    expect(h.requests).toEqual([]);
  });

  describe('production', () => {
    it('stops in GitHub Actions or any CI, before it asks or changes anything (plan, section 10, decision 9)', async () => {
      for (const ci of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }] as Record<string, string>[]) {
        const h = harness({ target: 'production', answer: 'production', env: { SUPABASE_ACCESS_TOKEN: 't', MADAR_DB_PASSWORD: 'p', ...ci } });
        await expect(runSecrets(h.run)).rejects.toThrow(/from the Mac only/);
        expect([h.sql, h.requests, h.asked]).toEqual([[], [], []]);
      }
    });

    it('stops without the typed word production', async () => {
      for (const answer of ['', 'yes', 'Production', 'test']) {
        const h = harness({ target: 'production', answer, env: { SUPABASE_ACCESS_TOKEN: 't', MADAR_DB_PASSWORD: 'p' } });
        await expect(runSecrets(h.run)).rejects.toThrow(/typed word/);
        expect(h.asked).toHaveLength(1);
        expect([h.sql, h.requests]).toEqual([[], []]);
      }
    });

    it('goes on with the typed word, against the production project only', async () => {
      const h = harness({ target: 'production', answer: 'production', env: { SUPABASE_ACCESS_TOKEN: 't', MADAR_DB_PASSWORD: 'p' } });
      await runSecrets(h.run);
      expect(h.requests[0].url).toBe(`https://api.supabase.com/v1/projects/${PRODUCTION}/secrets`);
      expect(h.sql).toContainEqual({ text: 'select vault.create_secret($2, $1)', values: ['project_url', `https://${PRODUCTION}.supabase.co`] });
    });

    it('does not ask again when all.sh already took the typed word', async () => {
      const h = harness({ target: 'production', env: { SUPABASE_ACCESS_TOKEN: 't', MADAR_DB_PASSWORD: 'p', MADAR_DEPLOY_CONFIRMED: 'production' } });
      await runSecrets(h.run);
      expect(h.asked).toEqual([]);
    });
  });
});
