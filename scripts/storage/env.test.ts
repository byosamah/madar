import { describe, expect, it } from 'vitest';
import { accessToken, confirmProduction, copyEnv, envArg } from './env';

/** scripts/storage/env.ts: the values of one copy for the storage scripts (owner, 2026-10-16). No network, no secret file. */

const ACCOUNT = 'd76d34779c63849f5acdf3d6af3751cd';
const r2Lines = (bucket: string) =>
  `R2_ACCOUNT_ID=${ACCOUNT}\nR2_ACCESS_KEY_ID=key-id-value-4\nR2_SECRET_ACCESS_KEY=secret-value-4\nR2_BUCKET=${bucket}`;

/** Runs fn and gives its error text, or fails when fn does not throw. */
function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return String(error);
  }
  throw new Error('no refusal');
}

describe('envArg', () => {
  it('takes --env test or --env production, and nothing when the flag is not there', () => {
    expect(envArg(['--env', 'test'])).toBe('test');
    expect(envArg(['--copy-only', '--env', 'production'])).toBe('production');
    expect(envArg([])).toBeUndefined();
  });

  it('refuses another copy, and a flag with no value', () => {
    expect(() => envArg(['--env', 'local'])).toThrow(/--env must be test or production/);
    expect(() => envArg(['--env'])).toThrow(/--env must be test or production/);
  });
});

describe('copyEnv', () => {
  it('takes the project URL from the fixed ref, and the R2 values and the store from the secrets file of that copy', () => {
    const test = copyEnv('test', `MADAR_FILE_STORE=supabase\n${r2Lines('madar-files-test')}`);
    expect(test).toMatchObject({
      target: 'test', ref: 'qdgwpnesxppnqsaabqzd', supabaseUrl: 'https://qdgwpnesxppnqsaabqzd.supabase.co', fileStore: 'supabase', filesBucket: 'madar-files',
      r2: { accountId: ACCOUNT, accessKeyId: 'key-id-value-4', secretAccessKey: 'secret-value-4', bucket: 'madar-files-test' },
    });
    expect(test.r2).not.toHaveProperty('endpoint');
    const production = copyEnv('production', `MADAR_FILE_STORE=r2\n${r2Lines('madar-files')}`);
    expect(production).toMatchObject({ ref: 'oprkvdjudjxxhvodkzgs', supabaseUrl: 'https://oprkvdjudjxxhvodkzgs.supabase.co', fileStore: 'r2', r2: { bucket: 'madar-files' } });
  });

  it('takes the store as supabase when the file names none', () => {
    expect(copyEnv('test', r2Lines('madar-files-test')).fileStore).toBe('supabase');
  });

  it('refuses the bucket of the other copy, a file with no R2 values, and an unknown store', () => {
    expect(() => copyEnv('production', r2Lines('madar-files-test'))).toThrow(/R2_BUCKET must be madar-files for production/);
    expect(() => copyEnv('test', r2Lines('madar-files'))).toThrow(/R2_BUCKET must be madar-files-test for test/);
    expect(() => copyEnv('test', 'MADAR_FILE_STORE=supabase')).toThrow(/secrets\/test\.env has no R2 values/);
    expect(() => copyEnv('test', `MADAR_FILE_STORE=s3\n${r2Lines('madar-files-test')}`)).toThrow(/MADAR_FILE_STORE must be supabase or r2/);
  });

  it('refuses a name that the server does not read (R2_ENDPOINT points only the tests at MinIO)', () => {
    expect(() => copyEnv('test', `${r2Lines('madar-files-test')}\nR2_ENDPOINT=http://127.0.0.1:9100`)).toThrow(/R2_ENDPOINT: the server reads no such value/);
  });

  it('never puts a key or a secret into an error', () => {
    const error = refusal(() => copyEnv('production', r2Lines('madar-files-test')));
    for (const value of ['key-id-value-4', 'secret-value-4']) expect(error).not.toContain(value);
  });
});

describe('accessToken', () => {
  it('takes SUPABASE_ACCESS_TOKEN from the environment first, then from .env.local', () => {
    expect(accessToken({ SUPABASE_ACCESS_TOKEN: 'sbp_shell' }, () => 'SUPABASE_ACCESS_TOKEN=sbp_file')).toBe('sbp_shell');
    expect(accessToken({}, () => '# Madar\nexport SUPABASE_ACCESS_TOKEN="sbp_file"\nOTHER=x\n')).toBe('sbp_file');
  });

  it('names the variable, never a value, when neither has it', () => {
    const error = refusal(() => accessToken({}, () => 'OTHER=sbp_other'));
    expect(error).toMatch(/SUPABASE_ACCESS_TOKEN is not set/);
    expect(error).not.toContain('sbp_other');
    expect(() => accessToken({}, () => null)).toThrow(/SUPABASE_ACCESS_TOKEN is not set/);
  });
});

describe('confirmProduction', () => {
  const never = async () => {
    throw new Error('asked');
  };

  it('asks nothing for the test copy', async () => {
    await expect(confirmProduction('test', {}, never)).resolves.toBeUndefined();
  });

  it('goes on in production only after the typed word production', async () => {
    const asked: string[] = [];
    await expect(confirmProduction('production', {}, async (question) => (asked.push(question), 'production\n'))).resolves.toBeUndefined();
    expect(asked[0]).toMatch(/production project oprkvdjudjxxhvodkzgs.*Type production/);
    await expect(confirmProduction('production', {}, async () => 'yes')).rejects.toThrow(/the typed word was not production/);
    await expect(confirmProduction('production', {}, async () => '')).rejects.toThrow(/the typed word was not production/);
  });

  it('refuses production under CI, and a MADAR_DEPLOY_CONFIRMED from the shell never counts', async () => {
    await expect(confirmProduction('production', { CI: 'true' }, never)).rejects.toThrow(/from the Mac only/);
    await expect(confirmProduction('production', { GITHUB_ACTIONS: 'true' }, never)).rejects.toThrow(/from the Mac only/);
    await expect(confirmProduction('production', { MADAR_DEPLOY_CONFIRMED: 'production' }, async () => 'no')).rejects.toThrow(/typed word/);
  });
});
