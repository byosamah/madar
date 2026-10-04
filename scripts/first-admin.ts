// The first Admin of an empty office (plan 5.1; task P3).
//
//   npx tsx scripts/first-admin.ts --env test|production --email <e> --name <n> --language <en|ar> --gender <female|male> [--discipline <d>]
//
// It asks for the password twice without echo, makes the Auth user (email confirmed), and in one transaction under the office
// lock: the users row usr_001 (Admin, with the language and gender), counters.usr = 1, the user.created event with its story,
// and the sign-in link (setAuthUserId). It refuses when the office has an Admin, or any person at all, and then makes nothing.
//
// Values: load ~/dev/madar/.env.local first (set -a; . ~/dev/madar/.env.local; set +a); secrets/<env>.env is read too when it
// exists. The database password: MADAR_TEST_DB_PASSWORD or MADAR_DB_PASSWORD. The secret key: MADAR_SECRET_KEY, else the
// Management API with SUPABASE_ACCESS_TOKEN. Production asks for the typed word "production" first.
// --env local uses the local stack (supabase status); --schema and --password-stdin are for the test harness.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { z } from 'zod';
import { defaultPreferences, Gender, Language, User } from '../src/api/contract/entities';
import { recordCreate } from '../src/api/events';
import { nextId } from '../src/api/store';
import { nowStamp } from '../src/lib/dates';
import { authAdminPort } from '../server/auth/admin';
import { DEFAULT_LOCK_KEY } from '../server/core/deps';
import { takeOfficeLock } from '../server/core/lock';
import type { AuthAdminPort, Query } from '../server/core/ports';
import { newStoryId, sqlStories } from '../server/core/story';
import { setAuthUserId } from '../server/data/officeCache';
import { save } from '../server/data/save';
import { loadWhole } from '../server/data/whole';

const REFS = { test: 'qdgwpnesxppnqsaabqzd', production: 'oprkvdjudjxxhvodkzgs' } as const;
const POOLER_HOST = 'aws-1-eu-central-1.pooler.supabase.com';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIN_PASSWORD = 8;

export type Env = 'test' | 'production' | 'local';
export type Args = {
  env: Env; email: string; name: string; language: Language; gender: Gender; discipline: string; passwordStdin: boolean; schema?: string;
};

export function parseArgs(argv: string[]): Args {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--password-stdin') flags.add(arg);
    else if (arg.startsWith('--')) values[arg.slice(2)] = argv[++i] ?? '';
  }
  const problems: string[] = [];
  const env = values.env;
  if (env !== 'test' && env !== 'production' && env !== 'local') problems.push('--env must be test, production or local.');
  const email = z.email().safeParse((values.email ?? '').trim().toLowerCase());
  if (!email.success) problems.push('--email must be an email.');
  const name = (values.name ?? '').trim();
  if (name === '') problems.push('--name is missing.');
  if (!Language.safeParse(values.language).success) problems.push('--language must be en or ar.');
  if (!Gender.safeParse(values.gender).success) problems.push('--gender must be female or male.');
  if (values.schema !== undefined && env !== 'local') problems.push('--schema works only with --env local.');
  if (values.schema !== undefined && !/^[a-z][a-z0-9_]*$/.test(values.schema)) problems.push('--schema must be a plain schema name.');
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return {
    env: env as Env, email: email.data!, name, language: values.language as Language, gender: values.gender as Gender,
    discipline: (values.discipline ?? 'Admin').trim(), passwordStdin: flags.has('--password-stdin'),
    ...(values.schema !== undefined ? { schema: values.schema } : {}),
  };
}

type PgConfig = { host: string; port: number; user: string; password: string; database: string; ssl: false | { ca: string; rejectUnauthorized: true; servername: string } };

/** The project URL and the postgres connection of a cloud project, through the session pooler with the root certificate. */
export function cloudTarget(env: 'test' | 'production', read: Record<string, string | undefined>): { ref: string; supabaseUrl: string; pg: PgConfig } {
  const ref = REFS[env];
  const passwordName = env === 'test' ? 'MADAR_TEST_DB_PASSWORD' : 'MADAR_DB_PASSWORD';
  const password = read[passwordName];
  if (!password) throw new Error(`${passwordName} is missing: load ~/dev/madar/.env.local first.`);
  const ca = readFileSync(new URL('./proof/supabase-root-2021-ca.crt', import.meta.url), 'utf8');
  return {
    ref,
    supabaseUrl: `https://${ref}.supabase.co`,
    pg: { host: POOLER_HOST, port: 5432, user: `postgres.${ref}`, password, database: 'postgres', ssl: { ca, rejectUnauthorized: true, servername: POOLER_HOST } },
  };
}

/** The secret key (sb_secret_...) of a project from the Management API. The key never reaches the output. */
export async function secretKeyFromApi(ref: string, token: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`The Management API refused the key list with ${response.status}.`);
  const keys = (await response.json()) as { type?: string; api_key?: string }[];
  const secret = keys.find((key) => key.type === 'secret' && typeof key.api_key === 'string' && key.api_key !== '');
  if (!secret) throw new Error(`The project ${ref} has no secret key. Make one in the dashboard (Settings, API keys).`);
  return secret.api_key!;
}

/** The database steps of the script: one query, and one transaction. */
export type FirstAdminDb = { q: Query; tx<T>(work: (q: Query) => Promise<T>): Promise<T> };

export function clientDb(client: pg.Client): FirstAdminDb {
  const q = (async (text: string, values?: unknown[]) => (await client.query(text, values)).rows) as Query;
  return {
    q,
    async tx(work) {
      await client.query('begin');
      try {
        const result = await work(q);
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      }
    },
  };
}

export class FirstAdminRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirstAdminRefused';
  }
}

export const PEOPLE_COUNT_SQL =
  "select count(*)::int as people, (count(*) filter (where kind = 'human' and doc->>'systemRole' = 'admin'))::int as admins from users";

async function assertEmpty(q: Query): Promise<void> {
  const [row] = await q<{ people: number; admins: number }>(PEOPLE_COUNT_SQL);
  if (Number(row.admins) > 0) throw new FirstAdminRefused('An Admin exists. This script makes only the first Admin; the Admin invites everyone else in Madar.');
  if (Number(row.people) > 0) throw new FirstAdminRefused('The office already has people. This script runs only on an empty office.');
}

export type FirstAdminInput = { email: string; name: string; language: Language; gender: Gender; discipline: string; password: string };

/** Makes the first Admin. It refuses (FirstAdminRefused) before any change when the office is not empty. */
export async function makeFirstAdmin(
  o: { db: FirstAdminDb; authAdmin: AuthAdminPort; now: Date; lockKey: number }, input: FirstAdminInput,
): Promise<{ userId: string; authUserId: string }> {
  if (input.password.length < MIN_PASSWORD) throw new FirstAdminRefused(`The password needs at least ${MIN_PASSWORD} characters.`);
  const draft = User.parse({
    id: 'usr_001', name: input.name, email: input.email.toLowerCase(), avatarUrl: null, kind: 'human', systemRole: 'admin',
    discipline: input.discipline, active: true, ownerId: null, gender: input.gender, preferences: { ...defaultPreferences(), language: input.language },
  });
  await assertEmpty(o.db.q);
  const { authUserId } = await o.authAdmin.createUser(draft.email, input.password);
  try {
    return await o.db.tx(async (q) => {
      await takeOfficeLock(q, o.lockKey);
      await assertEmpty(q);
      const before = await loadWhole(q);
      const after = structuredClone(before);
      const user: User = { ...draft, id: nextId(after, 'usr') };
      after.users[user.id] = user;
      const storyId = newStoryId();
      await sqlStories(q).insert(storyId, user.id, o.now);
      recordCreate({ state: after, actor: user, stamp: nowStamp(o.now), correlationId: storyId }, { projectId: null, verb: 'user.created', targetType: 'user', targetId: user.id, entity: user });
      await save(q, before, after, { story: { storyId, actorId: user.id }, signals: false });
      if (!(await setAuthUserId(q, user.id, authUserId))) throw new Error(`The users row ${user.id} is missing after the save.`);
      return { userId: user.id, authUserId };
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`${why}\nThe Auth user ${draft.email} exists now with no person in Madar. Remove it in the Supabase dashboard (Authentication, Users) before you run the script again.`);
  }
}

// ---------- The command line ----------

function loadSecretsFile(env: Env): void {
  const file = `${ROOT}secrets/${env}.env`;
  if (env === 'local' || !existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function localTarget(): { supabaseUrl: string; secretKey: string; dbUrl: string } {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const values = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string | undefined>;
  const supabaseUrl = values.API_URL ?? 'http://127.0.0.1:54321';
  const dbUrl = values.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  for (const url of [supabaseUrl, dbUrl]) {
    const host = new URL(url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`--env local runs only on the local stack, not on ${host}.`);
  }
  return { supabaseUrl, secretKey: values.SECRET_KEY ?? values.SERVICE_ROLE_KEY ?? '', dbUrl };
}

async function readStdinLine(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text.split(/\r?\n/)[0] ?? '';
}

/** Reads a line from the terminal with no echo. */
function askHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.reject(new Error('Type the password in a terminal (or pass --password-stdin).'));
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Error('Stopped.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadSecretsFile(args.env);
  let supabaseUrl: string;
  let secretKey: string;
  let client: pg.Client;
  if (args.env === 'local') {
    const local = localTarget();
    supabaseUrl = local.supabaseUrl;
    secretKey = local.secretKey;
    client = new pg.Client({ connectionString: local.dbUrl });
  } else {
    const cloud = cloudTarget(args.env, process.env);
    supabaseUrl = cloud.supabaseUrl;
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    secretKey = process.env.MADAR_SECRET_KEY ?? (token ? await secretKeyFromApi(cloud.ref, token) : '');
    if (!secretKey) throw new Error('MADAR_SECRET_KEY and SUPABASE_ACCESS_TOKEN are missing: load ~/dev/madar/.env.local first.');
    client = new pg.Client(cloud.pg);
    if (args.env === 'production') {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const word = await rl.question(`This makes the first Admin of the PRODUCTION office (${cloud.ref}). Type production to go on: `);
      rl.close();
      if (word.trim() !== 'production') throw new FirstAdminRefused('Stopped: the typed word was not production.');
    }
  }

  let password: string;
  if (args.passwordStdin) {
    password = await readStdinLine();
  } else {
    password = await askHidden(`Password for ${args.email}: `);
    if ((await askHidden('The same password again: ')) !== password) throw new FirstAdminRefused('The two passwords are not the same.');
  }

  await client.connect();
  try {
    if (args.schema) await client.query(`set search_path to ${args.schema}`);
    const lockText = process.env.MADAR_LOCK_KEY;
    const made = await makeFirstAdmin(
      { db: clientDb(client), authAdmin: authAdminPort({ supabaseUrl, secretKey }), now: new Date(), lockKey: lockText ? Number(lockText) : DEFAULT_LOCK_KEY },
      { email: args.email, name: args.name, language: args.language, gender: args.gender, discipline: args.discipline, password },
    );
    console.log(`Made the first Admin ${made.userId} (${args.email}). Sign in with this email and the password.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
