import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDeps, configFromEnv, consoleLogger, MissingConfigError } from './deps';

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
    const local = { ...without('DATABASE_CA'), DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@supabase_pooler_madar:6543/postgres' };
    expect(missingOf(local)).toEqual([]);
  });

  it('refuses a database URL with sslmode, because the CA goes in the ssl option (plan 4.5)', () => {
    expect(() => configFromEnv(reader({ ...FULL, DATABASE_URL: `${FULL.DATABASE_URL}?sslmode=require` }))).toThrow(/sslmode/);
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
