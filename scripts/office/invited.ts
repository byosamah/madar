// The people in state Invited of one copy, before the move of VADO (plan E, Task 3, lead step L5).
//
//   npx tsx scripts/office/invited.ts --env <production|test|local>  > <a file in the scratchpad>
//
// It reads Postgres inside one read-only snapshot and prints one JSON document to stdout: the id, the email, the name and the flags
// active and removed of each person who is Invited. Nothing else goes to stdout, so the lead can keep the output in the scratchpad
// and never in the repo. The emails are real people: the script prints no secret, and a log line or an error text holds no email.
//
// Why Postgres and not the call users.invites as the Admin: production has no Admin token on the Mac. The rule is the one of
// users.invites (server/calls/people.ts) and of the renew route (server/auth/CLAUDE.md, "Accepted or Invited"): a person of kind human
// is Accepted when the sign-in user is there, confirmed AND marked with madar_password_set. Every other human is Invited.
// production asks for the typed word production. A refused argument ends with exit code 2.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PASSWORD_SET_MARK } from '../../src/api/contract/server';
import { ArgumentError, askTypedWord, flagOf, postgresOf } from './import';
import type { PgQuery } from './source';

/** One row for each human of the office, with the state of the sign-in user. The email is the lower-cased column of users. */
export const INVITED_SQL = [
  "select u.id, u.email, u.doc->>'name' as name, coalesce(u.active, false) as active, coalesce((u.doc->>'removed')::boolean, false) as removed,",
  ` (a.id is not null and a.email_confirmed_at is not null and coalesce((a.raw_user_meta_data->>'${PASSWORD_SET_MARK}')::boolean, false)) as accepted`,
  ' from users u left join auth.users a on a.id = u.auth_user_id and a.deleted_at is null',
  " where u.kind = 'human' order by u.id",
].join('');

export type InvitedPerson = { id: string; email: string; name: string; active: boolean; removed: boolean };

/** The people in state Invited, read inside one read-only snapshot. */
export async function invitedPeople(query: PgQuery): Promise<InvitedPerson[]> {
  await query('begin read only');
  let done = false;
  try {
    const rows = await query(INVITED_SQL);
    await query('commit');
    done = true;
    return rows.filter((r) => r.accepted !== true).map((r) => ({
      id: String(r.id), email: String(r.email), name: String(r.name ?? ''), active: r.active === true, removed: r.removed === true,
    }));
  } finally {
    if (!done) await query('rollback').catch(() => undefined);
  }
}

/** The one JSON document of stdout. It has no trailing newline: the caller adds it. */
export function formatInvited(people: readonly InvitedPerson[], madeAt: string): string {
  return JSON.stringify({ madeAt, count: people.length, people });
}

export function invitedArguments(argv: readonly string[]): { env: 'production' | 'test' | 'local'; typed: boolean } {
  const env = flagOf(argv, '--env');
  if (env !== 'production' && env !== 'test' && env !== 'local') throw new ArgumentError('--env must be production, test or local.');
  return { env, typed: env === 'production' };
}

async function main(argv: string[]): Promise<void> {
  const { env, typed } = invitedArguments(argv);
  if (typed && (await askTypedWord('This reads the people of production. Type production to go on: ')) !== 'production') throw new Error('The typed word was not production. Nothing changed.');
  const client = await postgresOf(env);
  try {
    const people = await invitedPeople(async (text, values) => (await client.query(text, values)).rows);
    process.stdout.write(`${formatInvited(people, new Date().toISOString())}\n`);
    console.error(`${people.length} people are in state Invited.`);
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
