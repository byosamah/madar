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
    const start = text.indexOf('if [[ "${1:-}" == "--check" ]]');
    const check = text.slice(start, text.indexOf('exit 0', start));
    expect(check).not.toBe('');
    expect(check).not.toContain('dump.ts --out');
    expect(check).not.toContain('release create');
  });

  it('has an --if-due form that asks due.ts with the newest madar-db release, and stops before the dump when none is due', () => {
    const start = text.indexOf('if [[ "${1:-}" == "--if-due" ]]');
    expect(start).toBeGreaterThan(-1);
    const ifDue = text.slice(start, text.indexOf('\nfi\n', start));
    expect(ifDue).toContain('GH_TOKEN="$BACKUP_REPO_TOKEN" gh release list --repo byosamah/madar-backups');
    expect(ifDue).toContain('startswith("madar-db-")');
    // createdAt is the date of the commit of the tag: only publishedAt orders the backups (.github/CLAUDE.md).
    expect(ifDue).toContain('sort_by(.publishedAt)');
    expect(ifDue).toContain('gh run list -R byosamah/madar --workflow "DB backup" --status success --limit 1');
    expect(ifDue).toContain('npx tsx scripts/backup/due.ts "$NEWEST" "$GITHUB"');
    expect(ifDue).toContain('exit 0');
    expect(start).toBeLessThan(text.indexOf('dump.ts --out'));
    expect(start).toBeLessThan(text.indexOf('pg_dump --version'));
  });
});
