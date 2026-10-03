import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./stack-env.sh', import.meta.url));
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs stack-env.sh with a fake supabase command that prints the given status text and records its arguments. */
function run(statusText: string, exitCode = 0, extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'madar-stack-env-'));
  dirs.push(dir);
  const fake = join(dir, 'fake-supabase.sh');
  writeFileSync(join(dir, 'status.txt'), statusText);
  writeFileSync(fake, `#!/usr/bin/env bash\necho "$@" > "${dir}/args.txt"\ncat "${dir}/status.txt"\nexit ${exitCode}\n`);
  chmodSync(fake, 0o755);
  const result = spawnSync('bash', [script], { encoding: 'utf8', env: { ...process.env, SUPABASE: fake, ...extraEnv } });
  const args = spawnSync('cat', [join(dir, 'args.txt')], { encoding: 'utf8' }).stdout.trim();
  return { ...result, args };
}

const status = [
  'ANON_KEY="eyJ.local.anon"',
  'DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
  'SUPABASE_URL="http://127.0.0.1:54321"',
  'SERVICE_ROLE_KEY="eyJ.local.service"',
  'Stopped services: [supabase_kong_madar]',
  '',
].join('\n');

describe('scripts/ci/stack-env.sh', () => {
  it('asks the CLI for the env form, with DATABASE_URL and SUPABASE_URL as names', () => {
    const result = run(status);
    expect(result.status).toBe(0);
    expect(result.args).toBe('status -o env --override-name db.url=DATABASE_URL --override-name api.url=SUPABASE_URL');
  });

  it('prints NAME=value lines without quotes, and drops every other line', () => {
    expect(run(status).stdout.trim().split('\n')).toEqual([
      'ANON_KEY=eyJ.local.anon',
      'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      'SUPABASE_URL=http://127.0.0.1:54321',
      'SERVICE_ROLE_KEY=eyJ.local.service',
    ]);
  });

  it('adds SUPABASE_URL from the api port of config.toml when the status has none (the Data API is off)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'madar-config-'));
    dirs.push(dir);
    const config = join(dir, 'config.toml');
    writeFileSync(config, 'project_id = "madar"\n\n[api]\nenabled = false\nport = 54999\n\n[db]\nport = 54322\n');
    const result = run('DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\n', 0, { SUPABASE_CONFIG: config });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      'SUPABASE_URL=http://127.0.0.1:54999',
    ]);
  });

  it('reads the real config.toml by default', () => {
    const result = run('DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\n');
    expect(result.stdout).toContain('SUPABASE_URL=http://127.0.0.1:54321');
  });

  it('fails when the status has no database address', () => {
    const result = run('ANON_KEY="x"\n');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('DATABASE_URL');
  });

  it('fails when the database address is not on this machine', () => {
    const result = run('DATABASE_URL="postgresql://postgres:x@db.qdgwpnesxppnqsaabqzd.supabase.co:5432/postgres"\n');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });

  it('fails when the CLI fails', () => {
    expect(run(status, 1).status).not.toBe(0);
  });
});
