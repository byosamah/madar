import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The backup workflows (plan 5.7; task O2): db-backup.yml, files-backup.yml and restore-reminder.yml. They run only in GitHub, so
 * these tests check the rules of the plan on the text, and that every script they run exists. scripts/restore-check.test.ts runs
 * the backup script and the restore check on the local stack [Docker].
 */
const root = new URL('../../', import.meta.url);
const read = (name: string) => {
  const path = new URL(`.github/workflows/${name}`, root);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};
const FILES = { db: read('db-backup.yml'), files: read('files-backup.yml'), reminder: read('restore-reminder.yml') };
const all = Object.values(FILES).join('\n');

/** The lines of one step, from its "- name:" or "- uses:" line to the next step. */
function step(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) return '';
  const indent = lines[start].indexOf('-');
  const end = lines.findIndex((line, at) => at > start && line.indexOf('- ') === indent && line.trimStart().startsWith('- '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** The text before the first step of the first job, without comments: the triggers, the permissions and the job settings. */
const head = (text: string) =>
  text
    .slice(0, text.indexOf('    steps:'))
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

describe('the backup workflows', () => {
  it('exist', () => {
    for (const [name, text] of Object.entries(FILES)) expect(text, name).not.toBe('');
  });

  it('run on their schedule in Riyadh time, off the busy start of the hour, and by hand', () => {
    expect(FILES.db).toMatch(/- cron: '7 2 \* \* \*'\n\s+timezone: 'Asia\/Riyadh'/);
    expect(FILES.files).toMatch(/- cron: '7 3 \* \* 5'\n\s+timezone: 'Asia\/Riyadh'/);
    expect(FILES.reminder).toMatch(/- cron: '7 9 1 \* \*'\n\s+timezone: 'Asia\/Riyadh'/);
    for (const text of Object.values(FILES)) expect(text).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it('run only in the Madar repository, one run at a time, with a time limit', () => {
    for (const text of Object.values(FILES)) {
      expect(text).toContain("if: github.repository == 'byosamah/madar'");
      expect(text).toMatch(/concurrency:\n {2}group: [a-z-]+\n {2}cancel-in-progress: false/);
      expect(text).toMatch(/timeout-minutes: \d+/);
    }
  });

  it('read secrets only by name into the environment of a step, never into a run line or the job of an install', () => {
    for (const [name, text] of Object.entries(FILES)) {
      for (const line of text.split('\n')) {
        if (/\$\{\{[^}]*\bsecrets\./.test(line)) expect(line, `${name}: ${line}`).toMatch(/^ +[A-Z0-9_]+: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/);
      }
      expect(head(text), name).not.toMatch(/secrets\./);
    }
    // No secret value in the files: no address with a password, no key forms.
    expect(all).not.toMatch(/postgres(ql)?:\/\/[^\s'"]*:[^\s'"@]*@/);
    expect(all).not.toMatch(/AGE-SECRET-KEY|sb_secret_|ghp_|github_pat_/);
  });

  it('give the job token only the rights it needs', () => {
    expect(head(FILES.db)).toMatch(/permissions:\n {2}contents: read\n/);
    expect(head(FILES.files)).toMatch(/permissions:\n {2}contents: read\n/);
    expect(head(FILES.reminder)).toMatch(/permissions:\n {2}issues: write\n/);
  });

  it('pin every action to a full commit, and keep the job token out of .git/config', () => {
    const uses = [...all.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/@[0-9a-f]{40}$/);
    expect(FILES.db).toMatch(/actions\/checkout@\S+.*\n\s+with:\n\s+persist-credentials: false/);
  });

  it('has no em dash', () => {
    expect(all).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('db-backup.yml', () => {
  it('installs the packages before any step gets a secret', () => {
    const lines = FILES.db.split('\n');
    const firstSecret = lines.findIndex((line) => line.includes('${{ secrets.'));
    expect(firstSecret).toBeGreaterThan(0);
    expect(lines.findIndex((line) => line.includes('run: npm ci'))).toBeLessThan(firstSecret);
    expect(lines.findIndex((line) => line.includes('apt-get install -y -q age'))).toBeLessThan(firstSecret);
  });

  it('installs pg_dump 17 before any secret and puts it first on the PATH, because dump.ts runs the CLI script with it', () => {
    const lines = FILES.db.split('\n');
    const firstSecret = lines.findIndex((line) => line.includes('${{ secrets.'));
    const install = lines.findIndex((line) => line.includes('apt-get install -y -q postgresql-client-17'));
    expect(install).toBeGreaterThan(0);
    expect(install).toBeLessThan(firstSecret);
    expect(FILES.db).toContain('echo /usr/lib/postgresql/17/bin >> "$GITHUB_PATH"');
  });

  it('makes the backup with dump.ts, the session pooler address and the age public key', () => {
    const dump = step(FILES.db, 'Dump, count and encrypt');
    expect(dump).toContain('npx tsx scripts/backup/dump.ts --out');
    expect(dump).toContain('BACKUP_DB_URL: ${{ secrets.BACKUP_DB_URL }}');
    expect(dump).toContain('BACKUP_AGE_RECIPIENT: ${{ vars.BACKUP_AGE_RECIPIENT }}');
    expect(existsSync(new URL('scripts/backup/dump.ts', root))).toBe(true);
  });

  it('uploads the file as a release of the private repository madar-backups', () => {
    expect(FILES.db).toContain('BACKUP_REPO: byosamah/madar-backups');
    expect(step(FILES.db, 'Upload to madar-backups')).toMatch(/gh release create "\$NAME" "\$FILE" --repo "\$BACKUP_REPO"/);
  });

  it('removes only backups older than 30 days, and only after a good upload', () => {
    expect(FILES.db).toContain("KEEP_DAYS: '30'");
    const remove = step(FILES.db, 'Remove backups older than 30 days');
    expect(remove).toContain('startswith(\\"madar-db-\\")');
    expect(remove).toContain('gh release delete "$tag" --repo "$BACKUP_REPO" --yes --cleanup-tag');
    expect(FILES.db.indexOf('- name: Remove backups')).toBeGreaterThan(FILES.db.indexOf('- name: Upload to madar-backups'));
  });

  it('fails, so GitHub mails the owner, when the backup before this run was older than 26 hours', () => {
    expect(FILES.db).toContain("STALE_HOURS: '26'");
    expect(step(FILES.db, 'Age of the newest backup')).toContain('gh release list --repo "$BACKUP_REPO" --limit 1 --json createdAt');
    const stale = step(FILES.db, 'Fail when the backup before this one was older than 26 hours');
    expect(stale).toContain('if: fromJSON(steps.fresh.outputs.hours) > fromJSON(env.STALE_HOURS)');
    expect(stale).toContain('exit 1');
  });
});

describe('files-backup.yml', () => {
  it('syncs the file store to the B2 crypt remote and keeps replaced files in old/<date>', () => {
    expect(FILES.files).toContain('RCLONE_CONFIG_COPY_TYPE: crypt');
    expect(FILES.files).toContain('RCLONE_CONFIG_COPY_REMOTE: b2:${{ vars.B2_BUCKET }}');
    expect(FILES.files).toContain('RCLONE_CONFIG_COPY_DIRECTORY_NAME_ENCRYPTION: \'true\'');
    expect(FILES.files).toContain('RCLONE_CONFIG_B2_TYPE: b2');
    expect(step(FILES.files, 'Copy the files to B2')).toContain('rclone sync "source:$FILES_BUCKET" copy:current --backup-dir "copy:old/$today"');
  });

  it('stops the sync, so GitHub mails the owner, before a mass delete in the source reaches the copy', () => {
    expect(step(FILES.files, 'Copy the files to B2')).toMatch(/rclone sync [^\n]* --max-delete 200\b/);
  });

  it('connects psql with verify-full and the Supabase root certificate from the repository', () => {
    const checkout = step(FILES.files, 'Get the Supabase root certificate');
    expect(checkout).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);
    expect(checkout).toContain('persist-credentials: false');
    expect(checkout).toContain('sparse-checkout: scripts/proof/supabase-root-2021-ca.crt');
    expect(FILES.files.indexOf('- name: Get the Supabase root certificate')).toBeLessThan(FILES.files.indexOf('- name: Write the size of the copy'));
    const meter = step(FILES.files, 'Write the size of the copy to the usage meter');
    expect(meter).toContain('PGSSLMODE: verify-full');
    expect(meter).toContain('PGSSLROOTCERT: scripts/proof/supabase-root-2021-ca.crt');
    expect(existsSync(new URL('scripts/proof/supabase-root-2021-ca.crt', root))).toBe(true);
  });

  it('reads from Supabase Storage while the file store is supabase, and from R2 after the move', () => {
    expect(FILES.files).toContain('FILES_BUCKET: madar-files');
    expect(FILES.files).toContain("RCLONE_CONFIG_SOURCE_PROVIDER: ${{ vars.MADAR_FILE_STORE == 'r2' && 'Cloudflare' || 'Other' }}");
    expect(FILES.files).toContain("RCLONE_CONFIG_SOURCE_REGION: ${{ vars.MADAR_FILE_STORE == 'r2' && 'auto' || 'eu-central-1' }}");
    expect(FILES.files).toContain("RCLONE_CONFIG_SOURCE_FORCE_PATH_STYLE: 'true'");
  });

  it('removes the old/ folders older than 7 days', () => {
    expect(FILES.files).toContain("KEEP_DAYS: '7'");
    const remove = step(FILES.files, 'Remove old/ folders older than 7 days');
    expect(remove).toContain('rclone lsf copy:old --dirs-only');
    expect(remove).toContain('rclone purge "copy:old/$folder"');
  });

  it('writes the size of the B2 bucket to usage_month.backup_bytes', () => {
    const meter = step(FILES.files, 'Write the size of the copy to the usage meter');
    expect(meter).toContain('rclone size "b2:$B2_BUCKET" --json');
    expect(meter).toContain('insert into public.usage_month (month, backup_bytes)');
    expect(meter).toContain('on conflict (month) do update set backup_bytes = excluded.backup_bytes');
    const migration = readFileSync(new URL('supabase/migrations/20261004000101_server_tables.sql', root), 'utf8');
    expect(migration).toMatch(/create table usage_month \([^;]*backup_bytes bigint/);
  });

  it('installs nothing from npm, so no install script runs next to the keys', () => {
    expect(FILES.files).not.toMatch(/npm (ci|install)|npx /);
  });
});

describe('restore-reminder.yml', () => {
  it('opens one issue "Run the restore check" with the command of the check, and no second one while it is open', () => {
    const open = step(FILES.reminder, 'Open the issue "Run the restore check"');
    expect(open).toContain('title="Run the restore check (');
    expect(open).toContain('gh issue list --repo "$REPO" --state open');
    expect(open).toContain('gh issue create --repo "$REPO" --title "$title" --body "$body"');
    expect(open).toContain('npx tsx scripts/restore-check.ts --file');
    expect(existsSync(new URL('scripts/restore-check.ts', root))).toBe(true);
  });

  it('asks the owner to paste only the name of a failed step and its first line, never the rest of the detail (the issue is in the US)', () => {
    const open = step(FILES.reminder, 'Open the issue "Run the restore check"');
    expect(open).toContain('If a step failed, paste only its name and the first line of its detail');
    expect(open).not.toContain('paste the step and its detail');
  });
});
