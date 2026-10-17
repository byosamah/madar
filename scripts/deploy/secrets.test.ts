import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HEALTH_LOCK_KEY,
  HyperdriveCredentialsRefused,
  KEPT_ON_WORKER,
  NOT_FOR_WORKER,
  OFFICE_WORKER_SECRETS,
  R2_BUCKETS,
  SIGN_IN_LIMIT_MS,
  SIGN_IN_WAIT_MS,
  WORKER_SECRETS,
  checkSecrets,
  officeSecretsOf,
  parseSecretsFile,
  runOfficeSecrets,
  runSecrets,
  scramSha256Verifier,
  serverRoleSql,
  type Query,
  type SecretsRun,
  type WorkerPort,
} from './secrets.ts';

/** scripts/deploy/secrets.ts (plan 5.9; proof Z0a, item 3): function secrets, Vault, platform_config and the madar_server role. */
const TEST = 'qdgwpnesxppnqsaabqzd';
const PRODUCTION = 'oprkvdjudjxxhvodkzgs';
const SERVER_PASSWORD = 'Server-Password-1234';
const ROOT_CA = readFileSync(new URL('../../config/supabase-root-2021-ca.crt', import.meta.url), 'utf8');

const dbUrl = (ref: string, password = SERVER_PASSWORD) => `postgresql://madar_server.${ref}:${password}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres`;

/** Runs fn and gives its error text, or fails when fn does not throw. */
function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return String(error);
  }
  throw new Error('no refusal');
}

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

/**
 * A run with fakes: it records each database statement, each Management API request and each log line. The Worker of the copy
 * does not exist unless the test says so (worker: true), so the steps before the move to Cloudflare run as they did.
 */
function harness(o: { target?: 'test' | 'production'; text?: string; env?: Record<string, string>; answer?: string; dryRun?: boolean; worker?: boolean; hyperdrive?: boolean; hyperdriveRefusals?: number } = {}) {
  let refusals = o.hyperdriveRefusals ?? 0;
  const sql: { text: string; values?: unknown[] }[] = [];
  const workerCalls: { step: string; args: unknown[]; requestsBefore: number }[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const logs: string[] = [];
  const asked: string[] = [];
  const signIns: { url: string; ca: string; afterCommit: boolean; requestsBefore: number }[] = [];
  const slept: number[] = [];
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
    serverUser: async ({ url, ca }) => {
      signIns.push({ url, ca, afterCommit: sql.some((statement) => statement.text === 'commit'), requestsBefore: requests.length });
      return 'madar_server';
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response('[]', { status: 200 });
    },
    ask: async (question) => {
      asked.push(question);
      return o.answer ?? '';
    },
    log: (line) => logs.push(line),
    worker: {
      exists: async (name) => (workerCalls.push({ step: 'exists', args: [name], requestsBefore: requests.length }), o.worker === true),
      hyperdriveId: async (name) => (workerCalls.push({ step: 'hyperdriveId', args: [name], requestsBefore: requests.length }), o.hyperdrive === false ? undefined : `${name}-id`),
      updateHyperdrive: async (id, origin) => {
        workerCalls.push({ step: 'updateHyperdrive', args: [id, origin], requestsBefore: requests.length });
        if (refusals > 0) {
          refusals -= 1;
          throw new HyperdriveCredentialsRefused('The Cloudflare API refused the Hyperdrive password: 2013 Invalid database credentials.');
        }
      },
      secretBulk: async (target, json) => void workerCalls.push({ step: 'secretBulk', args: [target, json], requestsBefore: requests.length }),
    } satisfies WorkerPort,
    secretKey: async (ref, token) => (workerCalls.push({ step: 'secretKey', args: [ref, token], requestsBefore: requests.length }), 'sb_secret_from_api_1'),
  };
  return { run, sql, requests, logs, asked, signIns, slept, workerCalls };
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

// Made-up VAPID values of the right size: 87 and 43 base64url characters.
const VAPID_PUBLIC = `B${'a'.repeat(86)}`;
const VAPID_PRIVATE = 'b'.repeat(43);
const VAPID_LINES = `VAPID_PRIVATE_KEY=${VAPID_PRIVATE}\nVAPID_PUBLIC_KEY=${VAPID_PUBLIC}\nVAPID_SUBJECT=mailto:madar@vado.sa`;

describe('the VAPID keys of browser push (owner, 2026-10-08)', () => {
  const check = (text: string) => checkSecrets(parseSecretsFile(text), TEST);

  it('takes the three names in the secrets file, and sends them to the functions with the other secrets', async () => {
    expect(Object.keys(parseSecretsFile(file(TEST, VAPID_LINES)))).toEqual(
      ['DATABASE_URL', 'APP_URL', 'MAIL_FROM', 'RESEND_API_KEY', 'JOBS_SECRET', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT'],
    );
    const h = harness({ text: file(TEST, VAPID_LINES) });
    await runSecrets(h.run);
    const body = JSON.parse(String(h.requests[0].init.body)) as { name: string }[];
    expect(body.map((secret) => secret.name)).toEqual(expect.arrayContaining(['VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT']));
    expect(h.logs.join('\n')).toContain('VAPID_PRIVATE_KEY');
    expect(h.logs.join('\n')).not.toContain(VAPID_PRIVATE);
  });

  it('needs no VAPID value: push is off without them, and an old secrets file still passes', () => {
    expect(() => check(file())).not.toThrow();
  });

  it('needs all three or none, and names each missing one', () => {
    expect(() => check(file(TEST, `VAPID_PUBLIC_KEY=${VAPID_PUBLIC}`))).toThrow(/needs VAPID_PRIVATE_KEY, VAPID_SUBJECT/);
    expect(() => check(file(TEST, `VAPID_PRIVATE_KEY=${VAPID_PRIVATE}\nVAPID_SUBJECT=mailto:madar@vado.sa`))).toThrow(/needs VAPID_PUBLIC_KEY/);
    expect(() => check(file(TEST, VAPID_LINES))).not.toThrow();
  });

  it('checks the size of each key and the subject, with an error that names the variable and never the value', () => {
    const cases: [string, RegExp][] = [
      [VAPID_LINES.replace(VAPID_PRIVATE, 'short-private-value'), /VAPID_PRIVATE_KEY/],
      [VAPID_LINES.replace(VAPID_PUBLIC, 'short-public-value'), /VAPID_PUBLIC_KEY/],
      [VAPID_LINES.replace('mailto:madar@vado.sa', 'madar@vado.sa'), /VAPID_SUBJECT/],
    ];
    for (const [lines, name] of cases) {
      const message = refusal(() => check(file(TEST, lines)));
      expect(message).toMatch(name);
      for (const value of ['short-private-value', 'short-public-value', VAPID_PRIVATE, VAPID_PUBLIC]) expect(message).not.toContain(value);
    }
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

  it('takes DATABASE_READ_URL only under the rules of DATABASE_URL, with the same madar_server password', () => {
    const read = (url: string) => check(TEST, file(TEST, `DATABASE_READ_URL=${url}`));
    expect(() => read(dbUrl(TEST))).not.toThrow();
    // postgres owns every table: it skips RLS and can truncate events, so the read pool must never sign in as it.
    expect(() => read(dbUrl(TEST).replace('madar_server.', 'postgres.'))).toThrow(/DATABASE_READ_URL.*madar_server/);
    expect(() => read(dbUrl(PRODUCTION))).toThrow(/DATABASE_READ_URL.*madar_server\.qdgwpnesxppnqsaabqzd/);
    expect(() => read(dbUrl(TEST).replace(':6543/', ':5432/'))).toThrow(/DATABASE_READ_URL.*6543/);
    expect(() => read(dbUrl(TEST).replace('aws-1-eu-central-1.pooler', 'db.qdgwpnesxppnqsaabqzd'))).toThrow(/DATABASE_READ_URL.*pooler/);
    expect(() => read(`${dbUrl(TEST)}?sslmode=require`)).toThrow(/DATABASE_READ_URL.*TLS/);
    expect(() => read(`${dbUrl(TEST)}?uselibpqcompat=true`)).toThrow(/DATABASE_READ_URL.*TLS/);
    expect(() => read(dbUrl(TEST, 'Other-Password-99'))).toThrow(/DATABASE_READ_URL.*password of DATABASE_URL/);
    expect(() => read('not a url')).toThrow(/DATABASE_READ_URL is not a URL/);
  });

  it('refuses a MAIL_DRIVER other than resend or outbox, as the server start does', () => {
    expect(() => check(TEST, file(TEST, 'MAIL_DRIVER=resend'))).not.toThrow();
    expect(() => check(TEST, file(TEST, 'MAIL_DRIVER=smtp'))).toThrow(/MAIL_DRIVER must be resend or outbox/);
    expect(() => check(TEST, file(TEST, 'MAIL_DRIVER=Outbox'))).toThrow(/MAIL_DRIVER/);
  });

  it('refuses a MADAR_LOCK_KEY that is not a whole number, or that is the health check key', () => {
    expect(() => check(TEST, file(TEST, 'MADAR_LOCK_KEY=7310002'))).not.toThrow();
    for (const key of ['abc', '1.5', '', '9007199254740993']) {
      expect(() => check(TEST, file(TEST, `MADAR_LOCK_KEY=${key}`)), key).toThrow(/MADAR_LOCK_KEY must be a whole number/);
    }
    expect(() => check(TEST, file(TEST, `MADAR_LOCK_KEY=${HEALTH_LOCK_KEY}`))).toThrow(/MADAR_LOCK_KEY must not be the health check key/);
  });

  it('keeps the health check key of the server start (server/core/deps.ts)', () => {
    const deps = readFileSync(new URL('../../server/core/deps.ts', import.meta.url), 'utf8');
    const [, key] = /export const HEALTH_LOCK_KEY = ([\d_]+);/.exec(deps)!;
    expect(HEALTH_LOCK_KEY).toBe(Number(key.replaceAll('_', '')));
  });

  it('never puts a value into the errors of the read URL, the mail driver and the lock key', () => {
    const errors = [
      refusal(() => check(TEST, file(TEST, `DATABASE_READ_URL=${dbUrl(TEST).replace('madar_server.', 'postgres.')}`))),
      refusal(() => check(TEST, file(TEST, `DATABASE_READ_URL=${dbUrl(TEST, 'Other-Password-99')}`))),
      refusal(() => check(TEST, file(TEST, `DATABASE_READ_URL=${dbUrl(TEST)}?sslmode=leaky-value-2`))),
      refusal(() => check(TEST, file(TEST, 'MAIL_DRIVER=leaky-value-2'))),
      refusal(() => check(TEST, file(TEST, 'MADAR_LOCK_KEY=leaky-value-2'))),
    ];
    for (const error of errors) {
      for (const value of [SERVER_PASSWORD, 'Other-Password-99', 'leaky-value-2']) expect(error).not.toContain(value);
    }
  });

  it('wants https screens, never a local address', () => {
    expect(() => check(TEST, file().replace('https://preview.madar.pages.dev', 'http://127.0.0.1:5173'))).toThrow(/APP_URL/);
  });
});

describe('the R2 values of each copy (owner, 2026-10-16)', () => {
  const check = (ref: string, text: string) => checkSecrets(parseSecretsFile(text), ref);
  const ACCOUNT = 'd76d34779c63849f5acdf3d6af3751cd';
  const r2 = (bucket: string, account = ACCOUNT) =>
    `R2_ACCOUNT_ID=${account}\nR2_ACCESS_KEY_ID=key-id-value-3\nR2_SECRET_ACCESS_KEY=secret-value-3\nR2_BUCKET=${bucket}`;

  it('names the bucket of each copy', () => {
    expect(R2_BUCKETS).toEqual({ test: 'madar-files-test', production: 'madar-files' });
  });

  it('takes the R2 lines before the switch, while the store is still supabase, and after it', () => {
    expect(() => check(TEST, file(TEST, r2('madar-files-test')))).not.toThrow();
    expect(() => check(TEST, file(TEST, `MADAR_FILE_STORE=supabase\n${r2('madar-files-test')}`))).not.toThrow();
    expect(() => check(TEST, file(TEST, `MADAR_FILE_STORE=r2\n${r2('madar-files-test')}`))).not.toThrow();
    expect(() => check(PRODUCTION, file(PRODUCTION, r2('madar-files')))).not.toThrow();
    expect(() => check(PRODUCTION, file(PRODUCTION, `MADAR_FILE_STORE=r2\n${r2('madar-files')}`))).not.toThrow();
  });

  it('refuses the bucket of the other copy, so production never points at the test bucket (or the reverse)', () => {
    expect(() => check(TEST, file(TEST, r2('madar-files')))).toThrow(/R2_BUCKET must be madar-files-test for test/);
    expect(() => check(PRODUCTION, file(PRODUCTION, r2('madar-files-test')))).toThrow(/R2_BUCKET must be madar-files for production/);
    expect(() => check(PRODUCTION, file(PRODUCTION, `MADAR_FILE_STORE=r2\n${r2('madar-files-test')}`))).toThrow(/R2_BUCKET must be madar-files for production/);
    expect(() => check(TEST, file(TEST, r2('other-bucket')))).toThrow(/R2_BUCKET must be madar-files-test/);
  });

  it('wants R2_ACCOUNT_ID as the 32 hex characters of the Cloudflare account', () => {
    for (const account of ['d76d34779c63849f5acdf3d6af3751c', 'D76D34779C63849F5ACDF3D6AF3751CD', 'd76d34779c63849f5acdf3d6af3751cdx', 'not-an-account']) {
      expect(() => check(TEST, file(TEST, r2('madar-files-test', account))), account).toThrow(/R2_ACCOUNT_ID must be the 32 hex characters/);
    }
  });

  it('needs all four R2 names when any one is in the file, and names each missing one', () => {
    expect(() => check(TEST, file(TEST, 'R2_BUCKET=madar-files-test'))).toThrow(/R2 needs all of .*The secrets file needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY\./);
    expect(() => check(TEST, file(TEST, `R2_ACCOUNT_ID=${ACCOUNT}`))).toThrow(/needs R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET\./);
    // No R2 name at all: the store stays on Supabase Storage.
    expect(() => check(TEST, file())).not.toThrow();
  });

  it('never puts a key or a secret into the R2 errors', () => {
    const errors = [
      refusal(() => check(TEST, file(TEST, r2('madar-files')))),
      refusal(() => check(TEST, file(TEST, r2('madar-files-test', 'leaky-value-3')))),
      refusal(() => check(TEST, file(TEST, 'R2_SECRET_ACCESS_KEY=secret-value-3'))),
    ];
    for (const error of errors) {
      for (const value of ['key-id-value-3', 'secret-value-3', 'leaky-value-3']) expect(error).not.toContain(value);
    }
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

  it('signs in as madar_server through the transaction pooler after the commit and before the Management API (proof Z0a, item 7)', async () => {
    const h = harness();
    await runSecrets(h.run);
    expect(h.signIns).toEqual([{ url: dbUrl(TEST), ca: ROOT_CA, afterCommit: true, requestsBefore: 0 }]);
    expect(h.requests).toHaveLength(1);
    expect(h.slept).toEqual([]);
  });

  it('tries the sign in again every 5 s when the pooler refuses the new password at first', async () => {
    const h = harness();
    let calls = 0;
    h.run.serverUser = async () => {
      calls += 1;
      if (calls <= 2) throw new Error('Authentication credentials are invalid. Please reconnect with fresh credentials');
      return 'madar_server';
    };
    await runSecrets(h.run);
    expect(calls).toBe(3);
    expect(h.slept).toEqual([5000, 5000]);
    expect(h.requests).toHaveLength(1);
  });

  it('stops after 60 s of refused sign ins and sets no function secret', async () => {
    const h = harness();
    let calls = 0;
    h.run.serverUser = async () => {
      calls += 1;
      throw new Error('password authentication failed for user "madar_server"');
    };
    await expect(runSecrets(h.run)).rejects.toThrow(/madar_server could not sign in through the transaction pooler/);
    expect(h.slept.reduce((sum, ms) => sum + ms, 0)).toBe(60_000);
    expect(calls).toBe(13);
    expect(h.requests).toEqual([]);
  });

  it('counts a sign in as another role as a failure', async () => {
    const h = harness();
    h.run.serverUser = async () => 'postgres';
    await expect(runSecrets(h.run)).rejects.toThrow(/madar_server could not sign in/);
    expect(h.requests).toEqual([]);
  });

  it('never puts the password or the URL into the sign in error', async () => {
    const h = harness();
    h.run.serverUser = async ({ url }) => {
      throw new Error(`connect failed for ${url} with ${SERVER_PASSWORD}`);
    };
    const error = await runSecrets(h.run).then(
      () => '',
      (failure: unknown) => String(failure),
    );
    expect(error).toMatch(/madar_server could not sign in/);
    expect(error).not.toContain(SERVER_PASSWORD);
    expect(error).not.toContain('pooler.supabase.com:6543');
    for (const secret of secretValues) expect(h.logs.join('\n')).not.toContain(secret);
  });

  it('does not sign in during a dry run', async () => {
    const h = harness({ dryRun: true, env: {} });
    await runSecrets(h.run);
    expect(h.signIns).toEqual([]);
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

describe('the Worker of the copy (owner, 2026-10-16)', () => {
  const MCP = 'MCP_URL=https://preview.madar-46r.pages.dev/mcp';
  const steps = (h: ReturnType<typeof harness>) => h.workerCalls.map((call) => call.step);
  const bulk = (h: ReturnType<typeof harness>) => {
    const call = h.workerCalls.find((c) => c.step === 'secretBulk')!;
    return { target: call.args[0], secrets: JSON.parse(String(call.args[1])) as Record<string, string | null> };
  };

  it('tries the Hyperdrive password again while the session pooler still refuses the new login (2013), then goes on', async () => {
    const h = harness({ text: file(TEST, MCP), worker: true, hyperdriveRefusals: 2 });
    await runSecrets(h.run);
    expect(steps(h)).toEqual(['exists', 'hyperdriveId', 'updateHyperdrive', 'updateHyperdrive', 'updateHyperdrive', 'secretKey', 'secretBulk']);
    expect(h.slept.filter((ms) => ms === SIGN_IN_WAIT_MS).length).toBeGreaterThanOrEqual(2);
    expect(h.logs.join('\n')).toMatch(/Hyperdrive madar-db-test: the madar_server password of DATABASE_URL, on the session pooler/);
  });

  it('stops after the sign-in limit when Hyperdrive keeps refusing the password, and sends no Worker secret', async () => {
    const h = harness({ text: file(TEST, MCP), worker: true, hyperdriveRefusals: 1000 });
    await expect(runSecrets(h.run)).rejects.toThrow(/2013 Invalid database credentials/);
    expect(steps(h)).not.toContain('secretBulk');
    expect(steps(h).filter((step) => step === 'updateHyperdrive')).toHaveLength(SIGN_IN_LIMIT_MS / SIGN_IN_WAIT_MS + 1);
  });

  it('skips the Worker with a clear line when it does not exist yet, and still sets the function secrets', async () => {
    const h = harness({ text: file(TEST, MCP) });
    await runSecrets(h.run);
    expect(steps(h)).toEqual(['exists']);
    expect(h.workerCalls[0].args).toEqual(['madar-server-test']);
    expect(h.requests).toHaveLength(1);
    expect(h.logs.join('\n')).toMatch(/Skip: the Worker madar-server-test does not exist yet/);
  });

  it('sends the Worker every function secret but the database values, as JSON for wrangler secret bulk, after the function secrets', async () => {
    const h = harness({ text: file(TEST, `${MCP}\nMAIL_DRIVER=outbox\nALLOWED_ORIGINS=https://preview.madar-46r.pages.dev`), worker: true });
    await runSecrets(h.run);
    expect(steps(h)).toEqual(['exists', 'hyperdriveId', 'updateHyperdrive', 'secretKey', 'secretBulk']);
    for (const call of h.workerCalls.slice(2)) expect(call.requestsBefore).toBe(1);
    const { target, secrets } = bulk(h);
    expect(target).toBe('test');
    expect(Object.keys(secrets).sort()).toEqual([...WORKER_SECRETS].sort());
    for (const name of NOT_FOR_WORKER) expect(secrets, name).not.toHaveProperty(name);
    expect(secrets).toMatchObject({
      APP_URL: 'https://preview.madar.pages.dev',
      MAIL_FROM: 'Madar <notices@example.com>',
      MAIL_DRIVER: 'outbox',
      JOBS_SECRET: 'jobs-secret-value-1',
      MCP_URL: 'https://preview.madar-46r.pages.dev/mcp',
      ALLOWED_ORIGINS: 'https://preview.madar-46r.pages.dev',
    });
  });

  it('sends null for a name that the file does not set, so the Worker loses a value that was removed from the file', async () => {
    const h = harness({ text: file(TEST, MCP), worker: true });
    await runSecrets(h.run);
    const { secrets } = bulk(h);
    for (const name of ['API_URL', 'MADAR_FILE_STORE', 'R2_BUCKET', 'VAPID_PRIVATE_KEY', 'MIN_CLIENT_BUILD', 'AUTH_ISSUER']) expect(secrets[name], name).toBeNull();
    expect(h.logs.join('\n')).toMatch(/Removed from the Worker \(not in the file\): .*VAPID_PRIVATE_KEY/);
  });

  it('gives the Worker the default secret key of the project from the Management API, never the value of the file', async () => {
    const h = harness({ text: file(TEST, `${MCP}\nMADAR_SECRET_KEY=sb_secret_from_file_9`), worker: true });
    await runSecrets(h.run);
    expect(h.workerCalls.find((c) => c.step === 'secretKey')?.args).toEqual([TEST, 'sbp_token_value']);
    expect(bulk(h).secrets.MADAR_SECRET_KEY).toBe('sb_secret_from_api_1');
  });

  it('needs MCP_URL for the Worker, and stops before any change when it is missing', async () => {
    const h = harness({ worker: true });
    await expect(runSecrets(h.run)).rejects.toThrow(/MCP_URL.*madar-server-test.*Nothing changed/);
    expect([h.sql, h.requests]).toEqual([[], []]);
    expect(steps(h)).toEqual(['exists']);
  });

  it('sets the Hyperdrive origin of the copy from DATABASE_URL: madar_server on the session pooler', async () => {
    const h = harness({ text: file(TEST, MCP), worker: true });
    await runSecrets(h.run);
    const update = h.workerCalls.find((c) => c.step === 'updateHyperdrive')!;
    expect(h.workerCalls.find((c) => c.step === 'hyperdriveId')?.args).toEqual(['madar-db-test']);
    expect(update.args).toEqual(['madar-db-test-id', {
      scheme: 'postgres', host: 'aws-1-eu-central-1.pooler.supabase.com', port: 5432, database: 'postgres', user: `madar_server.${TEST}`, password: SERVER_PASSWORD,
    }]);
  });

  it('skips the Hyperdrive step with a clear line when the config does not exist, and still sends the Worker secrets', async () => {
    const h = harness({ text: file(TEST, MCP), worker: true, hyperdrive: false });
    await runSecrets(h.run);
    expect(steps(h)).toEqual(['exists', 'hyperdriveId', 'secretKey', 'secretBulk']);
    expect(h.logs.join('\n')).toMatch(/Skip: the Hyperdrive config madar-db-test does not exist yet/);
  });

  it('uses the Worker and the Hyperdrive config of production for production, never those of the test copy', async () => {
    const h = harness({ target: 'production', answer: 'production', text: file(PRODUCTION, 'MCP_URL=https://madar.vado.sa/mcp'), env: { SUPABASE_ACCESS_TOKEN: 't', MADAR_DB_PASSWORD: 'p' }, worker: true });
    await runSecrets(h.run);
    expect(h.workerCalls.map((c) => [c.step, c.step === 'secretBulk' ? c.args[0] : c.args[0]])).toEqual([
      ['exists', 'madar-server-production'], ['hyperdriveId', 'madar-db-production'], ['updateHyperdrive', 'madar-db-production-id'], ['secretKey', PRODUCTION], ['secretBulk', 'production'],
    ]);
    expect((h.workerCalls[2].args[1] as { user: string }).user).toBe(`madar_server.${PRODUCTION}`);
  });

  it('logs the Worker names only, never a value', async () => {
    const h = harness({ text: file(TEST, MCP), worker: true });
    await runSecrets(h.run);
    const text = h.logs.join('\n');
    expect(text).toContain('Worker secrets of madar-server-test');
    for (const secret of [...secretValues, 'sb_secret_from_api_1']) expect(text).not.toContain(secret);
  });

  it('lists the Worker names in a dry run, and calls neither Cloudflare nor the Management API', async () => {
    const h = harness({ dryRun: true, env: {}, text: file(TEST, MCP) });
    await runSecrets(h.run);
    const text = h.logs.join('\n');
    expect(text).toMatch(/Worker madar-server-test, when it exists: Hyperdrive madar-db-test/);
    expect(text).toMatch(/Worker secrets: .*JOBS_SECRET.*MADAR_SECRET_KEY\. MADAR_SECRET_KEY comes from the Management API\./);
    expect(text).toContain('Never sent to the Worker: DATABASE_URL, DATABASE_READ_URL, DATABASE_CA.');
    expect(h.workerCalls).toEqual([]);
    for (const secret of secretValues) expect(text).not.toContain(secret);
  });

  it('says in a dry run that the Worker step would stop without MCP_URL', async () => {
    const h = harness({ dryRun: true, env: {} });
    await runSecrets(h.run);
    expect(h.logs.join('\n')).toContain('MCP_URL is missing: the Worker step would stop.');
  });

  it('asks Cloudflare nothing in CI or without the typed word for production', async () => {
    const ci = harness({ target: 'production', answer: 'production', env: { SUPABASE_ACCESS_TOKEN: 't', MADAR_DB_PASSWORD: 'p', CI: 'true' }, worker: true });
    await expect(runSecrets(ci.run)).rejects.toThrow(/from the Mac only/);
    const word = harness({ target: 'production', answer: 'yes', env: { SUPABASE_ACCESS_TOKEN: 't', MADAR_DB_PASSWORD: 'p' }, worker: true });
    await expect(runSecrets(word.run)).rejects.toThrow(/typed word/);
    expect([ci.workerCalls, word.workerCalls]).toEqual([[], []]);
  });
});

describe('the Worker secrets of an office copy (exit wave 4)', () => {
  const office = 'APP_URL=https://preview.madar-46r.pages.dev\nMCP_URL=https://preview.madar-46r.pages.dev/mcp\nMAIL_FROM=Madar <madar@vado.sa>\nMAIL_DRIVER=outbox\nJOBS_SECRET=j\nMADAR_OPS_SECRET=o\nMADAR_EXPORT_SECRET=e\n';
  const worker = (sent: string[] = [], exists = true) => ({ exists: async () => exists, secretBulk: async (_t: string, json: string) => void sent.push(json) });

  it('sends every Worker secret of the file, the office secrets too, and never MADAR_SECRET_KEY or the sign-in key', () => {
    const out = officeSecretsOf(parseSecretsFile(office));
    expect(out).toMatchObject({ MADAR_OPS_SECRET: 'o', MADAR_EXPORT_SECRET: 'e', JOBS_SECRET: 'j', RESEND_API_KEY: null });
    expect(out).not.toHaveProperty('MADAR_SECRET_KEY');
    expect(out).not.toHaveProperty('MADAR_AUTH_PRIVATE_JWK');
    expect(OFFICE_WORKER_SECRETS.every((name) => WORKER_SECRETS.includes(name))).toBe(true);
    expect(KEPT_ON_WORKER.some((name) => WORKER_SECRETS.includes(name))).toBe(false);
  });

  it('refuses a file that holds the sign-in key: scripts/office/auth-key.ts writes it to the Worker', async () => {
    const run = { target: 'test' as const, text: `${office}MADAR_AUTH_PRIVATE_JWK={}\n`, dryRun: true, log: () => undefined, worker: worker() };
    await expect(runOfficeSecrets(run)).rejects.toThrow('MADAR_AUTH_PRIVATE_JWK must not be in secrets/test.env');
    expect(refusal(() => parseSecretsFile('MADAR_AUTH_PRIVATE_JWK={"d":"leaky-value-1"}'))).not.toContain('leaky-value-1');
  });

  it('sends the JSON to wrangler secret bulk once, and needs no Supabase token', async () => {
    const sent: string[] = [];
    const logs: string[] = [];
    await runOfficeSecrets({ target: 'test', text: office, dryRun: false, log: (line) => logs.push(line), worker: worker(sent) });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({ MADAR_OPS_SECRET: 'o' });
    for (const value of ['"o"', '"e"', '"j"']) expect(logs.join('\n')).not.toContain(value);
    expect(logs.join('\n')).toContain('MADAR_OPS_SECRET');
  });

  it('skips a Worker that does not exist yet, sends nothing in a dry run, and needs MCP_URL', async () => {
    const sent: string[] = [];
    const logs: string[] = [];
    await runOfficeSecrets({ target: 'test', text: office, dryRun: false, log: (line) => logs.push(line), worker: worker(sent, false) });
    expect(logs.join('\n')).toContain('Skip: madar-server-test does not exist yet');
    await runOfficeSecrets({ target: 'test', text: office, dryRun: true, log: (line) => logs.push(line), worker: worker(sent) });
    expect(sent).toEqual([]);
    expect(logs.at(-1)).toContain('Dry run of the office copy test');
    await expect(runOfficeSecrets({ target: 'test', text: office.replace(/^MCP_URL=.*\n/m, ''), dryRun: true, log: () => undefined, worker: worker() })).rejects.toThrow('MCP_URL is missing');
  });

  it('takes no production copy before the switch of wave 6', async () => {
    await expect(runOfficeSecrets({ target: 'production', text: office, dryRun: true, log: () => undefined, worker: worker() })).rejects.toThrow('wave 6');
  });

  it('gives the office secrets to the Worker on the Supabase path too, and never to the Supabase functions', async () => {
    const h = harness({ text: file(TEST, 'MCP_URL=https://preview.madar-46r.pages.dev/mcp\nMADAR_OPS_SECRET=ops-secret-value-1\nMADAR_EXPORT_SECRET=export-secret-value-1'), worker: true });
    await runSecrets(h.run);
    const body = JSON.parse(String(h.requests[0].init.body)) as { name: string }[];
    for (const name of OFFICE_WORKER_SECRETS) expect(body.map((secret) => secret.name)).not.toContain(name);
    const call = h.workerCalls.find((c) => c.step === 'secretBulk')!;
    expect(JSON.parse(String(call.args[1]))).toMatchObject({ MADAR_OPS_SECRET: 'ops-secret-value-1', MADAR_EXPORT_SECRET: 'export-secret-value-1' });
    for (const value of ['ops-secret-value-1', 'export-secret-value-1']) expect(h.logs.join('\n')).not.toContain(value);
  });

  it('refuses the sign-in key on the Supabase path too, before any change', async () => {
    const h = harness({ text: file(TEST, 'MADAR_AUTH_PRIVATE_JWK={}'), worker: true });
    await expect(runSecrets(h.run)).rejects.toThrow('MADAR_AUTH_PRIVATE_JWK must not be in secrets/test.env');
    expect([h.sql, h.requests]).toEqual([[], []]);
  });
});
