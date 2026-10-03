import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TABLES, COUNTERS_TABLE, SERVER_TABLES } from '../data/tables';
import { applyMigrations, dropSchema, localClient, localDbUrl, migrationFiles } from './migrate';

/**
 * The database guards (plan 4.1, 4.3, B3; TM suite 11), on the full local stack after "supabase db reset".
 * The server role gets a fixed local test password here; the deploy script sets the real one (plan 4.1).
 */
const SERVER_PASSWORD = 'madar-local-test';
const BROWSER_ROLES = ['anon', 'authenticated'];
const MADAR_TABLES = [...TABLES.map((spec) => spec.table), COUNTERS_TABLE, ...SERVER_TABLES].sort();

type Stack = { apiUrl: string; publishableKey: string; secretKey: string };

/** The URL and keys of the local stack, from the environment or from "supabase status". */
function localStack(): Stack {
  let values: Record<string, string | undefined> = process.env;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY) {
    const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    values = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  }
  const apiUrl = values.SUPABASE_URL ?? values.API_URL ?? 'http://127.0.0.1:54321';
  const host = new URL(apiUrl).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`The guards run only on the local stack, not on ${host}.`);
  return {
    apiUrl,
    publishableKey: values.SUPABASE_PUBLISHABLE_KEY ?? values.PUBLISHABLE_KEY ?? values.ANON_KEY ?? '',
    // The admin calls send the key as a bearer token too, so they need the service-role JWT, not an sb_secret_ key.
    secretKey: values.SUPABASE_SERVICE_ROLE_KEY ?? values.SERVICE_ROLE_KEY ?? '',
  };
}

/** Runs work as postgres in a transaction that always rolls back. */
async function rolledBack<T>(db: pg.Client, work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await work();
  } finally {
    await db.query('rollback');
  }
}

/** The error message of a statement that must fail, or "no error". */
async function failure(db: pg.Client, sql: string): Promise<string> {
  await db.query('savepoint try');
  try {
    await db.query(sql);
    await db.query('release savepoint try');
    return 'no error';
  } catch (error) {
    await db.query('rollback to savepoint try');
    return (error as Error).message;
  }
}

const EVENT_DOC = JSON.stringify({ id: 'evt_guard', seq: 999999, targetType: 'task', targetId: 'tsk_guard' });

describe('the database guards on the local stack', () => {
  let db: pg.Client;
  let server: pg.Client;

  beforeAll(async () => {
    db = await localClient();
    await db.query(`alter role madar_server login password '${SERVER_PASSWORD}'`);
    const url = new URL(localDbUrl());
    url.username = 'madar_server';
    url.password = SERVER_PASSWORD;
    server = await localClient(url.toString());
  });

  afterAll(async () => {
    await server?.end();
    if (db) {
      await db.query('alter role madar_server nologin password null');
      await db.end();
    }
  });

  it('applied every migration, and the non-platform ones apply again into an empty schema', async () => {
    const { rows } = await db.query('select version from supabase_migrations.schema_migrations');
    const applied = rows.map((row) => row.version);
    for (const name of migrationFiles({ platform: true })) expect(applied, name).toContain(name.split('_')[0]);
    const schema = `madar_b3_${process.pid}`;
    await applyMigrations(db, schema);
    const { rows: tables } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind = 'r'`,
      [schema],
    );
    expect(tables.map((row) => row.relname).sort()).toEqual(MADAR_TABLES);
    await dropSchema(db, schema);
  });

  it('has exactly the Madar tables in public', async () => {
    const { rows } = await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`);
    expect(rows.map((row) => row.relname).sort()).toEqual(MADAR_TABLES);
  });

  it('turns RLS on for every table, and the only policy is for madar_server (the token hook may read platform_config)', async () => {
    const { rows } = await db.query(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`);
    for (const row of rows) expect(row.relrowsecurity, row.relname).toBe(true);
    const { rows: policies } = await db.query(`select tablename, policyname, roles::text[] as roles, cmd from pg_policies where schemaname = 'public'`);
    for (const table of MADAR_TABLES) {
      const mine = policies.filter((policy) => policy.tablename === table);
      const expected = [{ tablename: table, policyname: 'server_all', roles: ['madar_server'], cmd: 'ALL' }];
      if (table === 'platform_config') expected.push({ tablename: table, policyname: 'auth_hook_read', roles: ['supabase_auth_admin'], cmd: 'SELECT' });
      expect(mine.map((policy) => ({ ...policy, roles: [...policy.roles] })), table).toEqual(expect.arrayContaining(expected));
      expect(mine.length, table).toBe(expected.length);
    }
  });

  it('gives the browser roles no right on any Madar table or sequence', async () => {
    for (const role of BROWSER_ROLES) {
      for (const table of MADAR_TABLES) {
        const { rows } = await db.query(`select has_table_privilege($1, $2, 'select, insert, update, delete, truncate, references, trigger') as any`, [role, `public.${table}`]);
        expect(rows[0].any, `${role} on ${table}`).toBe(false);
      }
      const { rows: sequences } = await db.query(
        `select c.relname, has_sequence_privilege($1, c.oid, 'usage, select, update') as any from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'`,
        [role],
      );
      for (const row of sequences) expect(row.any, `${role} on ${row.relname}`).toBe(false);
      const refused = await rolledBack(db, async () => {
        await db.query(`set local role ${role}`);
        return failure(db, 'select * from tasks');
      });
      expect(refused).toMatch(/permission denied/);
    }
  });

  it('lets no role change or empty the History, except that postgres may empty it', async () => {
    for (const role of [...BROWSER_ROLES, 'service_role']) {
      const errors = await rolledBack(db, async () => {
        await db.query('insert into events (id, doc) values ($1, $2)', ['evt_guard', EVENT_DOC]);
        await db.query(`set local role ${role}`);
        return [
          await failure(db, `update events set doc = doc where id = 'evt_guard'`),
          await failure(db, `delete from events where id = 'evt_guard'`),
          await failure(db, 'truncate events'),
        ];
      });
      for (const error of errors) expect(error, role).toMatch(/permission denied/);
    }
    const owner = await rolledBack(db, async () => {
      await db.query('insert into events (id, doc) values ($1, $2)', ['evt_guard', EVENT_DOC]);
      return [
        await failure(db, `update events set doc = doc where id = 'evt_guard'`),
        await failure(db, `delete from events where id = 'evt_guard'`),
        await failure(db, 'truncate events'),
      ];
    });
    expect(owner).toEqual(['events only grow: UPDATE is not allowed', 'events only grow: DELETE is not allowed', 'no error']);
  });

  it('lets madar_server read and add events, and nothing more', async () => {
    const result = await rolledBack(server, async () => {
      const added = await failure(server, `insert into events (id, doc) values ('evt_guard', '${EVENT_DOC}')`);
      const { rows } = await server.query(`select seq from events where id = 'evt_guard'`);
      return {
        added,
        seq: rows[0]?.seq,
        update: await failure(server, `update events set doc = doc where id = 'evt_guard'`),
        delete: await failure(server, `delete from events where id = 'evt_guard'`),
        truncate: await failure(server, 'truncate events'),
      };
    });
    expect(result.added).toBe('no error');
    expect(result.seq).toBe(999999);
    for (const error of [result.update, result.delete, result.truncate]) expect(error).toMatch(/permission denied/);
  });

  it('lets madar_server change the other Madar tables', async () => {
    const result = await rolledBack(server, async () => [
      await failure(server, `insert into counters (prefix, n) values ('tsk', 1)`),
      await failure(server, `update counters set n = 2 where prefix = 'tsk'`),
      await failure(server, `update office_meta set version = version + 1`),
      await failure(server, `delete from counters where prefix = 'tsk'`),
      await failure(server, 'select pg_advisory_xact_lock(42)'),
    ]);
    expect(result).toEqual(['no error', 'no error', 'no error', 'no error', 'no error']);
  });

  it('keeps madar_server from altering a table, turning off a trigger or skipping triggers', async () => {
    const errors = await rolledBack(server, async () => [
      await failure(server, 'alter table tasks add column guard integer'),
      await failure(server, 'alter table events disable trigger events_append_only'),
      await failure(server, 'alter table events disable row level security'),
      await failure(server, 'drop table events'),
      await failure(server, `set session_replication_role = replica`),
    ]);
    for (const error of errors.slice(0, 4)) expect(error).toMatch(/must be owner/);
    expect(errors[4]).toMatch(/permission denied/);
  });

  it('gives madar_server no object of its own and no login after the migration', async () => {
    const { rows } = await db.query(
      `select (select count(*) from pg_class where relowner = r.oid)::integer as tables,
              (select count(*) from pg_proc where proowner = r.oid)::integer as functions,
              (select count(*) from pg_namespace where nspowner = r.oid)::integer as schemas,
              r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls
       from pg_roles r where r.rolname = 'madar_server'`,
    );
    expect(rows[0]).toEqual({ tables: 0, functions: 0, schemas: 0, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
  });

  it('lets anon and authenticated execute no function in public', async () => {
    const { rows } = await db.query(
      `select p.oid::regprocedure::text as name,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect({ name: row.name, anon: row.anon, authenticated: row.authenticated }).toEqual({ name: row.name, anon: false, authenticated: false });
    // A function that a later migration makes in public, with no revoke by name: the default privileges must cover it.
    const probe = await rolledBack(db, async () => {
      await db.query('create function public.madar_guard_probe() returns integer language sql as $$ select 1 $$');
      const { rows: grants } = await db.query(
        `select has_function_privilege('anon', 'public.madar_guard_probe()', 'execute') as anon,
                has_function_privilege('authenticated', 'public.madar_guard_probe()', 'execute') as authenticated`,
      );
      return grants[0];
    });
    expect(probe).toEqual({ anon: false, authenticated: false });
  });

  it('checks project_id against projects only at the end of the transaction', async () => {
    const stage = (id: string, projectId: string) => JSON.stringify({ id, projectId });
    const childFirst = await rolledBack(db, async () => [
      await failure(db, `insert into stages (id, doc) values ('stg_9001', '${stage('stg_9001', 'prj_9001')}')`),
      await failure(db, `insert into projects (id, doc) values ('prj_9001', '{"id":"prj_9001"}')`),
      await failure(db, 'set constraints all immediate'),
    ]);
    expect(childFirst).toEqual(['no error', 'no error', 'no error']);
    const orphan = await rolledBack(db, async () => [
      await failure(db, `insert into stages (id, doc) values ('stg_9002', '${stage('stg_9002', 'prj_missing')}')`),
      await failure(db, 'set constraints all immediate'),
    ]);
    expect(orphan[0]).toBe('no error');
    expect(orphan[1]).toMatch(/violates foreign key constraint/);
  });

  it('keeps platform_config read-only for madar_server', async () => {
    const errors = await rolledBack(server, async () => [
      await failure(server, 'update platform_config set value = value'),
      await failure(server, `insert into platform_config (key, value) values ('mcp_url', 'https://guard.invalid')`),
      await failure(server, 'delete from platform_config'),
      await failure(server, 'select * from platform_config'),
    ]);
    for (const error of errors.slice(0, 3)) expect(error).toMatch(/permission denied/);
    expect(errors[3]).toBe('no error');
  });

  it('accepts an agent session only from the person who approved the agent link', async () => {
    const owner = randomUUID();
    const stranger = randomUUID();
    const ownerSession = randomUUID();
    const strangerSession = randomUUID();
    const client = randomUUID();
    const result = await rolledBack(db, async () => {
      for (const id of [owner, stranger]) {
        await db.query(`insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)`, [id, `${id}@madar.invalid`]);
      }
      await db.query('insert into auth.sessions (id, user_id) values ($1, $2), ($3, $4)', [ownerSession, owner, strangerSession, stranger]);
      await db.query(
        `insert into users (id, doc, auth_user_id) values
           ('usr_9001', '{"id":"usr_9001","kind":"human","active":true}', $1),
           ('usr_9002', '{"id":"usr_9002","kind":"human","active":true}', $2),
           ('usr_9003', '{"id":"usr_9003","kind":"agent","ownerId":"usr_9001","active":true}', null)`,
        [owner, stranger],
      );
      await db.query(
        `insert into agent_links (client_id, owner_user_id, agent_user_id, client_name, redirect_host)
         values ($1, 'usr_9001', 'usr_9003', 'Guard app', 'guard.invalid')`,
        [client],
      );
      const ok = async (session: string) => (await db.query('select madar_private.agent_session_ok($1, $2) as ok', [session, client])).rows[0].ok;
      const live = { owner: await ok(ownerSession), stranger: await ok(strangerSession) };
      await db.query('update agent_links set revoked_at = now() where client_id = $1', [client]);
      return { ...live, revoked: await ok(ownerSession) };
    });
    expect(result).toEqual({ owner: true, stranger: false, revoked: false });
  });

  it('applies the migrations from several workers at the same time', async () => {
    const schemas = [1, 2, 3].map((n) => `madar_b3_par${n}_${process.pid}`);
    const clients = await Promise.all(schemas.map(() => localClient()));
    try {
      const results = await Promise.allSettled(schemas.map((schema, i) => applyMigrations(clients[i], schema)));
      expect(results.map((result) => (result.status === 'fulfilled' ? 'ok' : String(result.reason)))).toEqual(['ok', 'ok', 'ok']);
    } finally {
      for (const [i, schema] of schemas.entries()) await dropSchema(clients[i], schema);
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('keeps the madar_private functions for their roles only', async () => {
    const { rows } = await db.query(
      `select p.oid::regprocedure::text as name,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('madar_server', p.oid, 'execute') as server
       from pg_proc p where p.pronamespace = 'madar_private'::regnamespace order by 1`,
    );
    expect(rows).toEqual([
      { name: 'madar_private.agent_session_ok(uuid,uuid)', anon: false, authenticated: false, server: true },
      { name: 'madar_private.current_madar_user_id()', anon: false, authenticated: true, server: true },
    ]);
    const { rows: send } = await db.query(
      `select to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null as present,
              case when to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then false
                   else has_function_privilege('madar_server', 'realtime.send(jsonb, text, text, boolean)', 'execute') end as server`,
    );
    expect(send[0]).toEqual({ present: true, server: true });
  });

  it('serves no table to the publishable key or a signed-in token through /rest/v1/ and /graphql/v1', async () => {
    const stack = localStack();
    const admin = { apikey: stack.secretKey, Authorization: `Bearer ${stack.secretKey}`, 'Content-Type': 'application/json' };
    const email = `guard-${process.pid}@madar.invalid`;
    const password = 'Guard-local-test-1';
    const made = await fetch(`${stack.apiUrl}/auth/v1/admin/users`, {
      method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
    });
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };
    try {
      const signIn = await fetch(`${stack.apiUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: stack.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      expect(signIn.status).toBe(200);
      const { access_token: token } = (await signIn.json()) as { access_token: string };
      const callers: { name: string; headers: Record<string, string> }[] = [
        { name: 'publishable key', headers: { apikey: stack.publishableKey } },
        { name: 'signed-in token', headers: { apikey: stack.publishableKey, Authorization: `Bearer ${token}` } },
      ];
      for (const caller of callers) {
        for (const path of ['/rest/v1/', '/rest/v1/tasks?select=*', '/rest/v1/users?select=*']) {
          const response = await fetch(`${stack.apiUrl}${path}`, { headers: caller.headers });
          const body = await response.text();
          expect(response.ok, `${caller.name} GET ${path}: ${response.status} ${body.slice(0, 120)}`).toBe(false);
        }
        const graphql = await fetch(`${stack.apiUrl}/graphql/v1`, {
          method: 'POST', headers: { ...caller.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ __schema { queryType { name } } }' }),
        });
        const body = await graphql.text();
        expect(graphql.ok, `${caller.name} POST /graphql/v1: ${graphql.status} ${body.slice(0, 120)}`).toBe(false);
      }
    } finally {
      await fetch(`${stack.apiUrl}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin });
    }
  });
});
