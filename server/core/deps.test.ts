import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDeps, configFromEnv, consoleLogger, DEFAULT_LOCK_KEY, HEALTH_LOCK_KEY, MissingConfigError, serverEnvFrom } from './deps';
import { serverHostOf } from './serverHost';

/** A full environment of the hosted test project. Every value here is made up. */
const FULL: Record<string, string> = {
  DATABASE_URL: 'postgres://madar_server.ref:pw-write@aws-1-eu-central-1.pooler.supabase.com:6543/postgres',
  DATABASE_CA: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_made_up_value' }),
  APP_URL: 'https://madar.example',
  MAIL_FROM: 'Madar <notices@madar.example>',
  RESEND_API_KEY: 're_made_up_value',
  SB_REGION: 'eu-central-1',
};

const reader = (values: Record<string, string>) => (name: string) => (values[name] === '' ? undefined : values[name]);

function without(...names: string[]): Record<string, string> {
  const copy = { ...FULL };
  for (const name of names) delete copy[name];
  return copy;
}

function missingOf(values: Record<string, string>): string[] {
  try {
    configFromEnv(reader(values));
  } catch (e) {
    expect(e).toBeInstanceOf(MissingConfigError);
    return (e as MissingConfigError).names;
  }
  return [];
}

describe('the real Deps from the environment', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds every port and the config from a full environment, with the defaults of the plan', () => {
    const deps = buildDeps(reader(FULL));
    expect(Object.keys(deps).sort()).toEqual(['authAdmin', 'clock', 'config', 'db', 'files', 'log', 'mail', 'meter', 'signal']);
    expect(deps.config).toMatchObject({
      appUrl: 'https://madar.example',
      apiUrl: 'https://ref.supabase.co/functions/v1/api',
      mcpUrl: 'https://ref.supabase.co/functions/v1/mcp',
      supabaseUrl: 'https://ref.supabase.co',
      mailFrom: 'Madar <notices@madar.example>',
      minClientBuild: '0',
      allowedOrigins: ['https://madar.example'],
      region: 'eu-central-1',
      forwardRegion: 'eu-central-1',
      fileStore: 'supabase',
      limits: { maxFileBytes: 50 * 1024 * 1024, filesTotalBytes: 1024 * 1024 * 1024 },
    });
    expect(Number.isSafeInteger(deps.config.lockKey)).toBe(true);
    expect(deps.files.kind).toBe('supabase');
    expect(deps.clock.now()).toBeInstanceOf(Date);
  });

  it('reads the optional values when they are set', () => {
    const config = configFromEnv(reader({
      ...FULL,
      API_URL: 'https://api.madar.example/api',
      MCP_URL: 'https://api.madar.example/mcp',
      MIN_CLIENT_BUILD: '2026.10.04',
      ALLOWED_ORIGINS: 'https://madar.example, https://preview.madar.example',
      MCP_FORWARD_REGION: 'eu-west-2',
      MADAR_LOCK_KEY: '42',
    }));
    expect(config).toMatchObject({
      apiUrl: 'https://api.madar.example/api',
      mcpUrl: 'https://api.madar.example/mcp',
      minClientBuild: '2026.10.04',
      allowedOrigins: ['https://madar.example', 'https://preview.madar.example'],
      forwardRegion: 'eu-west-2',
      lockKey: 42,
    });
  });

  it('takes the serving host of the copy from config/server-host.json by SUPABASE_URL, and supabase for a local stack', () => {
    expect(configFromEnv(reader({ ...FULL, SUPABASE_URL: 'http://127.0.0.1:54321' })).servingHost).toBe('supabase');
    expect(configFromEnv(reader({ ...FULL, SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co' })).servingHost).toBe(serverHostOf('test'));
    expect(configFromEnv(reader({ ...FULL, SUPABASE_URL: 'https://oprkvdjudjxxhvodkzgs.supabase.co' })).servingHost).toBe(serverHostOf('production'));
  });

  it('names the Worker by WORKER_REGION when SB_REGION is absent; on Supabase SB_REGION wins (owner, 2026-10-16)', () => {
    const { SB_REGION: _region, ...worker } = FULL as Record<string, string>;
    expect(configFromEnv(reader({ ...worker, WORKER_REGION: 'workers-eu-central-1' })).region).toBe('workers-eu-central-1');
    expect(configFromEnv(reader({ ...FULL, WORKER_REGION: 'workers-eu-central-1' })).region).toBe(FULL.SB_REGION);
    expect(configFromEnv(reader(worker)).region).toBe('unknown');
  });

  it('refuses to start with a missing secret, and names each missing value', () => {
    expect(missingOf(without('DATABASE_URL'))).toEqual(['DATABASE_URL']);
    expect(missingOf(without('APP_URL', 'MAIL_FROM'))).toEqual(['APP_URL', 'MAIL_FROM']);
    expect(missingOf(without('RESEND_API_KEY'))).toEqual(['RESEND_API_KEY']);
    expect(missingOf(without('SUPABASE_SECRET_KEYS'))).toEqual(['SUPABASE_SECRET_KEYS or MADAR_SECRET_KEY']);
    expect(missingOf({})).toEqual(['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEYS or MADAR_SECRET_KEY', 'APP_URL', 'MAIL_FROM', 'RESEND_API_KEY']);
    expect(() => buildDeps(reader(without('DATABASE_URL')))).toThrow('DATABASE_URL');
  });

  it('asks for the root certificate when the database is a hosted Supabase one', () => {
    expect(missingOf(without('DATABASE_CA'))).toEqual(['DATABASE_CA']);
    const local = { ...without('DATABASE_CA'), DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@pooler:6543/postgres' };
    expect(missingOf(local)).toEqual([]);
  });

  it('asks for the root certificate for every database host that is not a local name, so TLS never fails open', () => {
    const at = (host: string) => `postgres://madar_server.ref:pw@${host}:6543/postgres`;
    for (const host of ['3.65.151.229', 'db.madar.example', 'my-hyperdrive.proxy.example']) {
      expect(missingOf({ ...without('DATABASE_CA'), DATABASE_URL: at(host) }), host).toEqual(['DATABASE_CA']);
    }
    const hostedRead = { ...without('DATABASE_CA'), DATABASE_URL: at('127.0.0.1'), DATABASE_READ_URL: FULL.DATABASE_URL };
    expect(missingOf(hostedRead)).toEqual(['DATABASE_CA']);
    for (const host of ['127.0.0.1', 'localhost', '[::1]', 'pooler', 'db', 'host.docker.internal']) {
      expect(missingOf({ ...without('DATABASE_CA'), DATABASE_URL: at(host), DATABASE_READ_URL: at(host) }), host).toEqual([]);
    }
  });

  it('refuses a database URL with sslmode, because the CA goes in the ssl option (plan 4.5)', () => {
    expect(() => configFromEnv(reader({ ...FULL, DATABASE_URL: `${FULL.DATABASE_URL}?sslmode=require` }))).toThrow(/sslmode/);
  });

  it('refuses every other TLS setting in either database URL, as pgDb does (C1 review)', () => {
    for (const extra of ['?ssl=0', '?ssl=true', '?sslrootcert=x', '?SSLKEY=x', '?uselibpqcompat=true']) {
      for (const name of ['DATABASE_URL', 'DATABASE_READ_URL'] as const) {
        expect(() => configFromEnv(reader({ ...FULL, [name]: `${FULL[name]}${extra}` })), `${name}${extra}`).toThrow(new RegExp(name));
      }
    }
  });

  it('takes the secret key from MADAR_SECRET_KEY on a host that does not inject SUPABASE_SECRET_KEYS (Workers)', () => {
    expect(missingOf({ ...without('SUPABASE_SECRET_KEYS'), MADAR_SECRET_KEY: 'sb_secret_x' })).toEqual([]);
  });

  it('needs no Resend key when the mail goes to mail_outbox (test deployment)', () => {
    expect(missingOf({ ...without('RESEND_API_KEY'), MAIL_DRIVER: 'outbox' })).toEqual([]);
    expect(() => configFromEnv(reader({ ...FULL, MAIL_DRIVER: 'smtp' }))).toThrow(/MAIL_DRIVER/);
  });

  it('switches the file store to R2 with its four secrets and its limits', () => {
    expect(missingOf({ ...FULL, MADAR_FILE_STORE: 'r2' })).toEqual(['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']);
    const r2 = { ...FULL, MADAR_FILE_STORE: 'r2', R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'madar-files' };
    const deps = buildDeps(reader(r2));
    expect([deps.files.kind, deps.config.fileStore, deps.config.limits.maxFileBytes]).toEqual(['r2', 'r2', 250 * 1024 * 1024]);
    expect(() => configFromEnv(reader({ ...FULL, MADAR_FILE_STORE: 'disk' }))).toThrow(/MADAR_FILE_STORE/);
  });

  it('refuses a lock key that is not a whole number', () => {
    expect(() => configFromEnv(reader({ ...FULL, MADAR_LOCK_KEY: 'office' }))).toThrow(/MADAR_LOCK_KEY/);
  });

  it('refuses the health lock key as the office lock key, and uses its own default', () => {
    expect(() => configFromEnv(reader({ ...FULL, MADAR_LOCK_KEY: String(HEALTH_LOCK_KEY) }))).toThrow(/MADAR_LOCK_KEY/);
    expect(configFromEnv(reader(FULL)).lockKey).toBe(DEFAULT_LOCK_KEY);
    expect(DEFAULT_LOCK_KEY).not.toBe(HEALTH_LOCK_KEY);
  });

  it('takes the database values from its caller when given, and then neither reads nor checks the three database values (worker.ts, Hyperdrive)', () => {
    const names: string[] = [];
    const bound = reader(without('DATABASE_URL', 'DATABASE_CA'));
    const read = (name: string) => (names.push(name), bound(name));
    // The finished connection string of the binding carries its own TLS setting, which a DATABASE_URL may not.
    const hyperdrive = 'postgresql://madar_server:pw@0123abcd.hyperdrive.local:5432/postgres?sslmode=disable';
    const database = { writeUrl: hyperdrive, readUrl: hyperdrive };
    expect(serverEnvFrom(read, { database }).database).toEqual(database);
    expect(names.filter((name) => name.startsWith('DATABASE_'))).toEqual([]);
    // Without the option, the check stays.
    expect(() => serverEnvFrom(bound)).toThrow(MissingConfigError);
  });

  it('reads the jobs secret when it is set, for the jobs app and the deep health check', () => {
    expect(serverEnvFrom(reader(FULL)).jobsSecret).toBeUndefined();
    expect(serverEnvFrom(reader({ ...FULL, JOBS_SECRET: 'made-up-jobs-secret' })).jobsSecret).toBe('made-up-jobs-secret');
  });

  it('never puts a value into its error', () => {
    const values = { ...without('APP_URL'), DATABASE_URL: `${FULL.DATABASE_URL}?sslmode=require` };
    for (const read of [values, without('APP_URL')]) {
      let message = '';
      try {
        configFromEnv(reader(read));
      } catch (e) {
        message = String((e as Error).message);
      }
      expect(message).not.toBe('');
      for (const secret of ['pw-write', 'sb_secret_made_up_value', 're_made_up_value']) expect(message).not.toContain(secret);
    }
  });

  it('logs one JSON line for each message', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
    vi.spyOn(console, 'warn').mockImplementation((line: string) => void lines.push(line));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void lines.push(line));
    const log = consoleLogger();
    log.info('call done', { name: 'tasks.list', ms: 12 });
    log.warn('slow lock', { ms: 600 });
    log.error('call failed');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { level: 'info', message: 'call done', name: 'tasks.list', ms: 12 },
      { level: 'warn', message: 'slow lock', ms: 600 },
      { level: 'error', message: 'call failed' },
    ]);
  });
});

describe('the entry modules of deps.ts (P1, N2 follow-ups)', () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('loads the effect modules of every entry itself: auth, files and mail, and the mail driver loads none', () => {
    const deps = source('./deps.ts');
    for (const module of ['../auth/effects', '../files/effects', '../mail/effects', '../push/effects']) expect(deps).toContain(`import '${module}';`);
    expect(source('../mail/outboxDriver.ts')).not.toMatch(/^import '\.\/effects';/m);
  });

  it('names AUTH_ISSUER in the list of values of its header comment (server/auth/verify.ts reads it)', () => {
    expect(source('./deps.ts')).toMatch(/^ \*   AUTH_ISSUER {2,}\S/m);
  });

  it('names FILES_PUBLIC_URL in the list of values of its header comment', () => {
    expect(source('./deps.ts')).toMatch(/^ \*   FILES_PUBLIC_URL {2,}\S/m);
  });
});

describe('the VAPID keys of browser push (owner, 2026-10-08)', () => {
  const VAPID = { VAPID_PUBLIC_KEY: 'public-made-up', VAPID_PRIVATE_KEY: 'private-made-up', VAPID_SUBJECT: 'mailto:madar@vado.sa' };

  it('leaves push off when none of the three is set: the server starts, config.push is missing', () => {
    expect(configFromEnv(reader(FULL)).push).toBeUndefined();
  });

  it('reads the three values into config.push when all are set', () => {
    expect(configFromEnv(reader({ ...FULL, ...VAPID })).push).toEqual({ publicKey: 'public-made-up', privateKey: 'private-made-up', subject: 'mailto:madar@vado.sa' });
  });

  it('stops the start and names each missing variable when only some are set, and never a value', () => {
    expect(missingOf({ ...FULL, VAPID_PUBLIC_KEY: 'public-made-up' })).toEqual(['VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
    expect(missingOf({ ...FULL, VAPID_PRIVATE_KEY: 'private-made-up' })).toEqual(['VAPID_PUBLIC_KEY', 'VAPID_SUBJECT']);
    try {
      configFromEnv(reader({ ...FULL, VAPID_PRIVATE_KEY: 'private-made-up' }));
    } catch (error) {
      expect((error as Error).message).not.toContain('private-made-up');
    }
  });

  it('refuses a subject that is not a mailto or https address, with an error that names the variable', () => {
    expect(() => configFromEnv(reader({ ...FULL, ...VAPID, VAPID_SUBJECT: 'madar@vado.sa' }))).toThrow(/VAPID_SUBJECT/);
  });

  it('names the three values in the list of its header comment', () => {
    const header = readFileSync(new URL('./deps.ts', import.meta.url), 'utf8');
    for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) expect(header).toMatch(new RegExp(`^ \\*   ${name} {2,}\\S`, 'm'));
  });
});

describe('the Google Calendar values (fbk_022, owner 2026-10-19)', () => {
  const GOOGLE = { GOOGLE_CLIENT_ID: 'id-made-up.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'cs-made-up', MADAR_GOOGLE_KEY: 'key-made-up' };

  it('leaves Google off when none of the three is set: the server starts, config.google is missing', () => {
    expect(configFromEnv(reader(FULL)).google).toBeUndefined();
  });

  it('reads the three values into config.google when all are set', () => {
    expect(configFromEnv(reader({ ...FULL, ...GOOGLE })).google).toEqual({ clientId: 'id-made-up.apps.googleusercontent.com', clientSecret: 'cs-made-up', key: 'key-made-up' });
  });

  it('stops the start and names each missing variable when only some are set, and never a value', () => {
    expect(missingOf({ ...FULL, GOOGLE_CLIENT_ID: GOOGLE.GOOGLE_CLIENT_ID })).toEqual(['GOOGLE_CLIENT_SECRET', 'MADAR_GOOGLE_KEY']);
    expect(missingOf({ ...FULL, GOOGLE_CLIENT_SECRET: 'cs-made-up' })).toEqual(['GOOGLE_CLIENT_ID', 'MADAR_GOOGLE_KEY']);
    expect(missingOf({ ...FULL, MADAR_GOOGLE_KEY: 'key-made-up' })).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
    try {
      configFromEnv(reader({ ...FULL, GOOGLE_CLIENT_SECRET: 'cs-made-up' }));
    } catch (error) {
      expect((error as Error).message).not.toContain('cs-made-up');
    }
  });

  it('names the three values in the list of its header comment', () => {
    const header = readFileSync(new URL('./deps.ts', import.meta.url), 'utf8');
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MADAR_GOOGLE_KEY']) expect(header).toMatch(new RegExp(`^ \\*   ${name} {2,}\\S`, 'm'));
  });
});

describe('FILES_PUBLIC_URL (whole-product check after wave 4)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives the browser the file links on FILES_PUBLIC_URL, while the server calls Storage on SUPABASE_URL', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return Response.json({ url: '/object/upload/sign/madar-files/up/upl-1/file?token=t' });
    });
    const deps = buildDeps(reader({ ...FULL, SUPABASE_URL: 'http://kong:8000', FILES_PUBLIC_URL: 'http://127.0.0.1:54321' }));
    const put = await deps.files.presignPut('up/upl-1/file', { mimeType: 'image/png' });
    expect(calls).toEqual(['http://kong:8000/storage/v1/object/upload/sign/madar-files/up/upl-1/file']);
    expect(put.url).toBe('http://127.0.0.1:54321/storage/v1/object/upload/sign/madar-files/up/upl-1/file?token=t');
  });
});
