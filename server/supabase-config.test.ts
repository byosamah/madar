import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const seedPath = new URL('../supabase/seed.sql', import.meta.url);

/** The plain key = value lines of one [section] of config.toml (the file has no nested tables inside these sections). */
function section(name: string): Record<string, string> {
  const lines = config.split('\n');
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  expect(start, `config.toml has a [${name}] section`).toBeGreaterThanOrEqual(0);
  const values: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('[')) break;
    const match = /^(\w+)\s*=\s*(.+)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

describe('the local Supabase stack (supabase/config.toml)', () => {
  it('runs the transaction pooler on port 54329, which E1 and the set local timeouts of C need', () => {
    expect(section('db.pooler')).toMatchObject({ enabled: 'true', port: '54329', pool_mode: '"transaction"' });
  });

  it('keeps the token hook on, so G1 can prove it', () => {
    expect(section('auth.hook.custom_access_token')).toMatchObject({
      enabled: 'true',
      uri: '"pg-functions://postgres/public/madar_access_token_hook"',
    });
  });

  it('seeds ./seed.sql after the migrations of a reset', () => {
    expect(section('db.seed')).toMatchObject({ enabled: 'true', sql_paths: '["./seed.sql"]' });
    expect(existsSync(seedPath)).toBe(true);
  });
});

describe('supabase/seed.sql', () => {
  const seed = existsSync(seedPath) ? readFileSync(seedPath, 'utf8') : '';

  it('makes a pass-through token hook only while the real one (G1) is missing, so sign-in works before G merges', () => {
    expect(seed).toMatch(/if to_regprocedure\('public\.madar_access_token_hook\(jsonb\)'\) is null then/);
    expect(seed).toMatch(/create function public\.madar_access_token_hook\(event jsonb\)/);
    expect(seed).toMatch(/jsonb_build_object\('claims', event->'claims'\)/);
  });

  it('lets only Auth run the hook', () => {
    expect(seed).toMatch(/grant execute on function public\.madar_access_token_hook\(jsonb\) to supabase_auth_admin;/);
    expect(seed).toMatch(/revoke execute on function public\.madar_access_token_hook\(jsonb\) from public, anon, authenticated;/);
  });

  it('holds no em dash', () => {
    expect(seed).not.toContain('—');
  });
});
