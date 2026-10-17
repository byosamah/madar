// The test seed of an office object (Supabase exit, wave 4): the sample office of today and the 4 accounts, as
// scripts/seed-test-office.ts makes them for Postgres, but through the import route in the replace mode.
//
//   npx tsx scripts/office/seed.ts --to <page address> [--no-files] [--due-today <n>]
//
// --to is the local office (http://127.0.0.1:8792, npm run dev:office) or the test copy (https://preview.madar-46r.pages.dev); the
// Worker takes replace only with the test tools on, and never on production. The passwords: the local ones of
// tests/e2e-deploy/local.ts, or MADAR_TEST_PASSWORD_<ROLE> of secrets/test-accounts.env for the test copy. On the test copy the
// sample files go to madar-files-test first (the R2 lines of secrets/test.env), unless --no-files. It never prints a password.
//
// The replace keeps the office version and the meters of the day and the month (KEEP_ON_REPLACE of server/office/import.ts), and
// empties the rest, the job runs and the mail log among them. So a seed after 07:30 Riyadh on a working day lets the next Cron run
// write the morning summary again; on the test copy (MAIL_DRIVER=outbox) it goes only into mail_outbox.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { settleFuture } from '../../src/data/shift';
import { todayISO } from '../../src/lib/dates';
import { hashPassword, PASSWORD_MIN } from '../../server/auth/own/password';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { DEPLOY_ACCOUNTS, DEPLOY_ROLES, type DeployRole } from '../../tests/e2e-deploy/accounts';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { r2Values } from '../deploy/secrets';
import { PNG_PICTURES } from '../seed-pictures';
import { seedAccounts, seedR2Port, testOffice, withObjectKeys } from '../seed-test-office';
import { copyValuesOf, flagOf, importOffice, targetOf } from './import';
import { opsOf } from './ops';
import { stateSource, type OfficeSource } from './source';

/** One fixed sign-in id for each account, so the seed of the office object gives the same ids each time. */
export const SEED_AUTH_IDS: Record<DeployRole, string> = {
  admin: '7d0c0000-0000-4000-8000-000000000001',
  management: '7d0c0000-0000-4000-8000-000000000002',
  accounting: '7d0c0000-0000-4000-8000-000000000003',
  member: '7d0c0000-0000-4000-8000-000000000004',
};

/** The first n open tasks with a lead get today as their due day (the reminders of the next Cron run: the push measure of wave 5). */
export function withDueToday(state: State, n: number, today: string): State {
  const office = structuredClone(state);
  const open = Object.values(office.tasks).filter((task) => task.status !== 'done' && task.ownerId !== null).slice(0, n);
  for (const task of open) task.dueDate = today;
  return office;
}

const PASSWORD_NAMES: readonly string[] = DEPLOY_ROLES.map((role) => DEPLOY_ACCOUNTS[role].passwordSecret);

/**
 * The 4 password lines of secrets/test-accounts.env. parseSecretsFile of scripts/deploy/secrets.ts takes only the names that a
 * Worker reads, so this file has its own small reader. It skips every other line. Errors name the line or the name, never a value.
 */
export function accountPasswordsOf(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const name = at === -1 ? '' : line.slice(0, at).replace(/^export\s+/, '').trim();
    if (!PASSWORD_NAMES.includes(name)) continue;
    if (name in values) throw new Error(`${name}: the file sets it twice.`);
    values[name] = line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return values;
}

export async function seedSource(o: { now: Date; passwords: Readonly<Record<string, string | undefined>>; dueToday?: number }): Promise<{ source: OfficeSource; uploads: { key: string; blob: Blob }[] }> {
  const blobs = new Map<string, Blob>();
  const base = settleFuture(await buildSeed(todayISO(o.now), async (key, blob) => void blobs.set(key, blob), PNG_PICTURES), o.now);
  const keyed = withObjectKeys(testOffice(base), blobs);
  const office = o.dueToday ? withDueToday(keyed.office, o.dueToday, todayISO(o.now)) : keyed.office;
  const accounts = seedAccounts(office);
  for (const account of accounts) {
    const password = o.passwords[account.passwordSecret];
    if (!password || password.length < PASSWORD_MIN) throw new Error(`${account.passwordSecret} must hold at least ${PASSWORD_MIN} characters. Nothing changed.`);
  }
  // The hashes come before any request: PBKDF2 with 100,000 rounds, the form that the own sign-in checks (wave 2).
  const signin = await Promise.all(accounts.map(async (account) => ({
    id: SEED_AUTH_IDS[account.role], email: account.email, password_hash: await hashPassword(o.passwords[account.passwordSecret]!),
    email_confirmed: true, banned: false, password_set: true, user_id: account.userId,
  })));
  return { source: stateSource(office, { signin }), uploads: keyed.uploads };
}

function accountsFile(): Record<string, string> {
  const path = fileURLToPath(new URL('../../secrets/test-accounts.env', import.meta.url));
  return existsSync(path) ? accountPasswordsOf(readFileSync(path, 'utf8')) : {};
}

async function main(argv: string[]): Promise<void> {
  const target = targetOf(flagOf(argv, '--to', 'http://127.0.0.1:8792'));
  const dueText = flagOf(argv, '--due-today');
  const dueToday = dueText === '' ? undefined : Number(dueText);
  if (dueToday !== undefined && (!Number.isSafeInteger(dueToday) || dueToday <= 0)) throw new Error('--due-today takes a whole number above 0.');
  const test = target.copy === 'test';
  const passwords = test ? { ...accountsFile(), ...process.env } : localPasswords();
  const values = copyValuesOf(target.copy);
  const secret = values.MADAR_OPS_SECRET;
  if (!secret) throw new Error('MADAR_OPS_SECRET is not set for this copy (scripts/office/new-secret.ts, or npm run dev:office).');
  const { source, uploads } = await seedSource({ now: new Date(), passwords, ...(dueToday ? { dueToday } : {}) });
  if (test && !argv.includes('--no-files')) {
    const r2 = r2Values(values, 'test');
    if (!r2) throw new Error('secrets/test.env has no R2 lines, so the sample files have no store. Add them, or pass --no-files.');
    const store = seedR2Port(r2);
    for (const upload of uploads) await store.put(upload.key, upload.blob);
    console.log(`Uploaded ${uploads.length} sample files to ${store.where}.`);
  }
  const report = await importOffice(opsOf({ base: target.base, secret, header: OPS_SECRET_HEADER }), source, { mode: 'replace', log: (line) => console.log(line) });
  console.log(`Seeded the office object of ${target.copy}: ${report.records} records in ${report.parts} parts, the 4 accounts of tests/e2e-deploy/accounts.ts.`);
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
