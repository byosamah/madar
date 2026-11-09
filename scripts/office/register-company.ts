// The company row and the email directory of VADOs' Companies on a copy (plan E, lead steps L7 and L8, Task E).
//
//   npx tsx scripts/office/register-company.ts --to <page address of the copy>
//
// Order of the move: THIS script first, then scripts/office/import.ts. The import into an enterprise id needs the platform list to hold
// that enterprise already (server/entries/officeWorker.ts, nameAllowed), and the sign-in finds the enterprise of a person through the
// directory. So the script writes, with the op platform-register (the ops secret, MADAR_OPS_SECRET of the copy):
//   - the row ent_001: address vados, name "VADOs' Companies", Arabic name شركات فادو, state active, no limit on people or storage;
//   - the directory: the email of each person of the office who can sign in.
// The emails come from Postgres of the same copy (one read-only snapshot). The script prints counts and names, never an email and never
// a secret, and its error texts hold neither. A second run is safe: the op gets keepExisting, so a row that is there stays as it is (a
// later pause, limit or name of the platform survives) and only the missing emails are added.
// production asks for the typed word production. A refused argument ends with exit code 2, before any read or request.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENT_VADO, normalizeEmail, VADO_ADDRESS } from '../../server/enterprise/ids';
import type { EnterpriseRow } from '../../server/enterprise/types';
import { registerEnterprise } from './enterprise';
import { ArgumentError, askTypedWord, copyValuesOf, flagOf, postgresOf, targetOf } from './import';
import type { PgQuery } from './source';

/** The most emails that one register takes (RegisterBodyShape). The office of VADO has about 15 people. */
export const REGISTER_MAX_EMAILS = 500;

const NOT_REMOVED = "not coalesce((u.doc->>'removed')::boolean, false)";

/**
 * The people who can sign in: every human of the office that the Admin did not remove (a removal frees the email in the directory), by
 * the email of the person, and by the email of the sign-in user that links to the person (the two are the same after an email change).
 */
export const DIRECTORY_SQL = {
  people: `select u.id, u.email, u.doc->>'name' as name from users u where u.kind = 'human' and ${NOT_REMOVED} order by u.id`,
  linked: `select lower(a.email) as email from auth.users a join users u on u.auth_user_id = a.id where u.kind = 'human' and ${NOT_REMOVED} and a.deleted_at is null and a.email is not null order by 1`,
} as const;

/** The first active Admin: the name and email of the row of the enterprise (the platform keeps it as the first Admin). */
export const ADMIN_SQL = `select u.doc->>'name' as name, u.email from users u where u.kind = 'human' and ${NOT_REMOVED} and u.active and u.doc->>'systemRole' = 'admin' order by u.id limit 1`;

/** The emails of both reads, normalized and once, in order. */
export function directoryOf(people: readonly { email: string }[], linked: readonly { email: string }[]): string[] {
  return [...new Set([...people, ...linked].map((row) => normalizeEmail(String(row.email))))];
}

export type Directory = { emails: string[]; admin: { name: string; email: string } };

/** The directory of the office, read inside one read-only snapshot. It refuses an office with no people, with no active Admin, or with too many emails. */
export async function readDirectory(query: PgQuery): Promise<Directory> {
  await query('begin read only');
  let done = false;
  try {
    const people = await query(DIRECTORY_SQL.people);
    const linked = await query(DIRECTORY_SQL.linked);
    const [admin] = await query(ADMIN_SQL);
    await query('commit');
    done = true;
    const emails = directoryOf(people as { email: string }[], linked as { email: string }[]);
    if (emails.length === 0) throw new Error('The office has no people. Nothing changed.');
    if (admin === undefined) throw new Error('The office has no active Admin. Nothing changed.');
    if (emails.length > REGISTER_MAX_EMAILS) throw new Error(`The office has more than ${REGISTER_MAX_EMAILS} emails: one register takes at most that many. Nothing changed.`);
    return { emails, admin: { name: String(admin.name ?? ''), email: normalizeEmail(String(admin.email)) } };
  } finally {
    if (!done) await query('rollback').catch(() => undefined);
  }
}

export function companyRow(admin: { name: string; email: string }, now: Date): EnterpriseRow {
  return {
    id: ENT_VADO, address: VADO_ADDRESS, name: "VADOs' Companies", nameAr: 'شركات فادو', state: 'active', limits: { people: null, storageBytes: null },
    createdAt: now.toISOString(), firstAdmin: { name: admin.name, email: admin.email },
  };
}

/** Reads the directory and sends the register op. Nothing it logs or throws holds an email or the secret. */
export async function registerCompany(o: {
  base: string; secret: string; query: PgQuery; now?: Date; send?: typeof fetch; log?: (line: string) => void;
}): Promise<{ emails: number }> {
  const log = o.log ?? (() => undefined);
  const directory = await readDirectory(o.query);
  await registerEnterprise(o.base, o.secret, { row: companyRow(directory.admin, o.now ?? new Date()), emails: directory.emails, keepExisting: true }, o.send);
  log(`Registered ${ENT_VADO} (${VADO_ADDRESS}) with ${directory.emails.length} emails. A row that was there before stays as it was.`);
  return { emails: directory.emails.length };
}

export function registerArguments(argv: readonly string[]): { target: ReturnType<typeof targetOf>; typed: boolean } {
  const to = flagOf(argv, '--to');
  if (to === '') throw new ArgumentError('--to <page address of the copy> is missing.');
  let target: ReturnType<typeof targetOf>;
  try {
    target = targetOf(to);
  } catch (error) {
    throw new ArgumentError(error instanceof Error ? error.message : String(error));
  }
  return { target, typed: target.copy === 'production' };
}

async function main(argv: string[]): Promise<void> {
  const { target, typed } = registerArguments(argv);
  if (typed && (await askTypedWord('This writes the company row and the email directory of ent_001 on production. Type production to go on: ')) !== 'production') {
    throw new Error('The typed word was not production. Nothing changed.');
  }
  const secret = copyValuesOf(target.copy).MADAR_OPS_SECRET;
  if (!secret) throw new Error(`MADAR_OPS_SECRET is not set for ${target.copy} (scripts/office/new-secret.ts).`);
  const client = await postgresOf(target.copy);
  try {
    await registerCompany({ base: target.base, secret, query: async (text, values) => (await client.query(text, values)).rows, log: (line) => console.log(line) });
  } finally {
    await client.end().catch(() => undefined);
  }
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error instanceof ArgumentError ? 2 : 1);
  });
}
