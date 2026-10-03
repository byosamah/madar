import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkMigrationSecrets, findLiteralSecrets } from './check-migration-secrets.ts';

const dirs: string[] = [];

/** A migrations folder with the given files. */
function migrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'madar-migrations-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const lines = (sql: string) => findLiteralSecrets(sql).map((finding) => finding.line);

describe('findLiteralSecrets', () => {
  it('finds create_secret with a literal value, on the line of the call', () => {
    expect(lines("create table t (id int);\nselect vault.create_secret('hunter2', 'resend_key');\n")).toEqual([2]);
  });

  it('finds every literal form: plain, E string, Unicode string, dollar quotes with and without a tag', () => {
    const sql = [
      "select vault.create_secret(E'a\\tb', 'one');",
      "select vault.create_secret(U&'d\\0061t', 'two');",
      "select vault.create_secret($$abc$$, 'three');",
      "select vault.create_secret($k$abc$k$, 'four');",
    ].join('\n');
    expect(lines(sql)).toEqual([1, 2, 3, 4]);
  });

  it('finds a literal value that starts on the next line of the call', () => {
    expect(lines("select vault.create_secret(\n  'hunter2',\n  'resend_key'\n);")).toEqual([1]);
  });

  it('finds a named new_secret argument with a literal value, in any position', () => {
    expect(lines("select vault.create_secret(new_name => 'n', new_secret => 'hunter2');")).toEqual([1]);
  });

  it('finds update_secret with a literal value in its second argument', () => {
    expect(lines("select vault.update_secret(id, 'hunter2') from vault.secrets where name = 'k';")).toEqual([1]);
    expect(lines("select vault.update_secret('6f1c', new_secret => 'hunter2');")).toEqual([1]);
  });

  it('ignores the case of the name and finds the call without the vault schema', () => {
    expect(lines("SELECT VAULT.CREATE_SECRET('hunter2');\nselect create_secret('x');")).toEqual([1, 2]);
  });

  it('finds a call inside a function body', () => {
    expect(lines("do $$\nbegin\n  perform vault.create_secret('hunter2', 'k');\nend\n$$;")).toEqual([3]);
  });

  it('passes a value that comes from a setting, a parameter or a variable', () => {
    const sql = [
      "select vault.create_secret(current_setting('app.resend_key'), 'resend_key');",
      'create function madar_private.put_secret(p_value text) returns void language sql as $f$',
      "  select vault.create_secret(p_value, 'mcp_url');",
      '$f$;',
      "select vault.update_secret(id, new_secret => p_value) from vault.secrets where name = 'k';",
    ].join('\n');
    expect(lines(sql)).toEqual([]);
  });

  it('passes a literal name or description, which are not the secret', () => {
    expect(lines("select vault.create_secret(p_value, 'resend_key', 'The Resend key');")).toEqual([]);
  });

  it('ignores calls in line comments and block comments, and text in strings', () => {
    const sql = [
      "-- select vault.create_secret('hunter2', 'k');",
      "/* select vault.create_secret('hunter2', 'k');",
      "   still a comment */ select 1;",
      "comment on table t is 'Do not call create_secret(''x'') here';",
    ].join('\n');
    expect(lines(sql)).toEqual([]);
  });

  it('keeps a comment marker inside a string from hiding the next call', () => {
    expect(lines("select '--', vault.create_secret('hunter2');")).toEqual([1]);
  });
});

describe('checkMigrationSecrets', () => {
  it('prints what it searched, also when nothing matched', () => {
    const result = checkMigrationSecrets(migrations({ '20261004000100_core.sql': 'create table t (id int);', 'notes.txt': 'x' }));
    expect(result.ok).toBe(true);
    const text = result.lines.join('\n');
    expect(text).toMatch(/1 file\b/);
    expect(text).toContain('create_secret(');
    expect(text).toContain('update_secret(');
  });

  it('passes a missing folder and says that it searched no file', () => {
    const result = checkMigrationSecrets(join(tmpdir(), 'madar-no-such-folder-x9'));
    expect(result.ok).toBe(true);
    expect(result.lines.join('\n')).toMatch(/0 files/);
  });

  it('fails with the file and the line, and never prints the secret value', () => {
    const dir = migrations({
      '20261004000300_platform_cron.sql': "select 1;\nselect vault.create_secret('hunter2', 'jobs_key');\n",
      '20261004000100_core.sql': 'select 1;',
    });
    const result = checkMigrationSecrets(dir);
    expect(result.ok).toBe(false);
    const text = result.lines.join('\n');
    expect(text).toContain('20261004000300_platform_cron.sql:2');
    expect(text).not.toContain('hunter2');
  });
});

describe('the command', () => {
  const script = fileURLToPath(new URL('./check-migration-secrets.ts', import.meta.url));
  const run = (dir: string) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });

  it('exits 1 on a literal secret and 0 on a clean folder', () => {
    const bad = run(migrations({ 'a.sql': "select vault.create_secret('hunter2');" }));
    expect(bad.status).toBe(1);
    expect(bad.stdout + bad.stderr).not.toContain('hunter2');
    const good = run(migrations({ 'a.sql': "select vault.create_secret(current_setting('app.k'));" }));
    expect(good.status).toBe(0);
    expect(good.stdout).toMatch(/1 file\b/);
  });
});
