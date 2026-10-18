import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * scripts/backup/mac-backup.sh: the nightly database backup from the Mac while GitHub Actions refuses jobs (owner, 2026-10-18;
 * .github/CLAUDE.md). It must make the same file as .github/workflows/db-backup.yml and never print a secret.
 */
const file = new URL('./mac-backup.sh', import.meta.url);
const text = existsSync(file) ? readFileSync(file, 'utf8') : '';

describe('scripts/backup/mac-backup.sh', () => {
  it('exists and is a program', () => {
    expect(text).not.toBe('');
    expect(statSync(file).mode & 0o100).not.toBe(0);
    expect(text).toMatch(/^#!\/bin\/bash\n/);
    expect(text).toContain('set -euo pipefail');
  });

  it('makes the backup with dump.ts and pg_dump 17, as db-backup.yml does', () => {
    expect(text).toContain('npx tsx scripts/backup/dump.ts --out "$OUT"');
    expect(text).toContain('/opt/homebrew/opt/postgresql@17/bin');
  });

  it('uploads to madar-backups with the backup token of .env.local, never with the gh login of the Mac', () => {
    expect(text).toContain('GH_TOKEN="$BACKUP_REPO_TOKEN" gh release create "$NAME" "$FILE" --repo byosamah/madar-backups');
  });

  it('builds the database address inside a process and never prints a secret', () => {
    expect(text).toContain('process.env.MADAR_DB_PASSWORD');
    expect(text).not.toMatch(/echo[^\n]*(PASSWORD|BACKUP_DB_URL|TOKEN)/);
    expect(text).not.toMatch(/set -x|set -o xtrace/);
  });

  it('has a --check form that sends one read-only query and makes no dump and no upload', () => {
    const check = text.slice(text.indexOf('if [[ "${1:-}" == "--check" ]]'), text.indexOf('exit 0'));
    expect(check).not.toBe('');
    expect(check).not.toContain('dump.ts --out');
    expect(check).not.toContain('release create');
  });
});
