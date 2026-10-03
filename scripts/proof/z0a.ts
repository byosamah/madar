// Z0a cloud proof, probes (plan, section 6.3, track Z, adapted by section 2b). Runs on madar-test only.
//   set -a; . ~/dev/madar/.env.local; set +a
//   npx tsx scripts/proof/z0a.ts <step>     steps: deploy keys region pg ssl hook realtime storage worker cleanup
// Each step prints a JSON report with every secret redacted. docs/superpowers/real-build/proof.md, section Z0a, records the results.
// The probe objects (the z0a-probe function and its secret, the madar_server role, the hook, the probe tables, users and buckets) go in cleanup.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { POOLER_HOST, poolerConfig } from './lib.ts';
import { storageStep } from './storage.ts';
import { PROBE_FUNCTION, REF, ROOT_CA, SUPABASE_URL, adminClient, mgmt, need, probe, report, serverClient, sleep, stateDir, stateValue } from './cloud.ts';

const LOCK_KEY = 7310001;

function supabaseCli(args: string[]): { code: number | null; out: string } {
  const run = spawnSync('npx', ['supabase', ...args, '--project-ref', REF], { env: { ...process.env, SUPABASE_ACCESS_TOKEN: need('SUPABASE_ACCESS_TOKEN') }, encoding: 'utf8' });
  return { code: run.status, out: `${run.stdout}\n${run.stderr}`.trim().split('\n').slice(-6).join('\n') };
}

async function deploy() {
  const token = stateValue('probe-token');
  const envFile = join(stateDir(), 'fn.env');
  writeFileSync(envFile, `Z0A_PROBE_TOKEN=${token}\n`, { mode: 0o600 });
  const secret = supabaseCli(['secrets', 'set', '--env-file', envFile]);
  rmSync(envFile);
  const work = join(stateDir(), 'fnwork');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, 'supabase', 'functions', PROBE_FUNCTION), { recursive: true });
  writeFileSync(join(work, 'supabase', 'config.toml'), `project_id = "z0a-probe"\n\n[functions.${PROBE_FUNCTION}]\nverify_jwt = false\n`);
  cpSync(new URL('./function/index.ts', import.meta.url), join(work, 'supabase', 'functions', PROBE_FUNCTION, 'index.ts'));
  const fn = supabaseCli(['functions', 'deploy', PROBE_FUNCTION, '--use-api', '--no-verify-jwt', '--workdir', work]);
  report('deploy', { secretSet: secret.code === 0 ? 'ok' : secret.out, deployed: fn.code === 0 ? 'ok' : fn.out });
}

async function keys() {
  const signing = await mgmt('/config/auth/signing-keys');
  const jwks = await (await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)).json();
  report('keys', {
    signingKeys: (signing.body.keys ?? []).map((k: any) => ({ algorithm: k.algorithm, status: k.status })),
    jwks: jwks.keys.map((k: any) => ({ alg: k.alg, kty: k.kty, crv: k.crv })),
  });
}

async function region() {
  const forced = await probe('region', undefined, '?forceFunctionRegion=eu-central-1');
  const plain = await probe('region');
  report('region', {
    forced: { status: forced.status, sbRegion: forced.body.sbRegion, edgeRegionHeader: forced.headers.get('x-sb-edge-region') },
    noParameter: { status: plain.status, sbRegion: plain.body.sbRegion, edgeRegionHeader: plain.headers.get('x-sb-edge-region') },
  });
}

/** Makes madar_server a login role with a fresh password. The real migration makes it nologin, and secrets.ts sets login and the password. */
async function serverRole(): Promise<string> {
  const password = stateValue('server-password');
  const a = await adminClient();
  try {
    await a.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'madar_server') then create role madar_server; end if; end $$`);
    // The password is base64url, so it holds no quote.
    await a.query(`alter role madar_server with login noinherit password '${password}'`);
  } finally {
    await a.end();
  }
  return password;
}

async function connectWithRetry(client: () => pg.Client, tries = 6): Promise<pg.Client> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const c = client();
    try {
      await c.connect();
      return c;
    } catch (e) {
      last = e;
      await c.end().catch(() => undefined);
      await sleep(5000);
    }
  }
  throw last;
}

async function attempt(label: string, config: pg.ClientConfig | string): Promise<{ label: string; ok: boolean; detail: string }> {
  const c = new pg.Client(typeof config === 'string' ? { connectionString: config, connectionTimeoutMillis: 10000 } : { ...config, connectionTimeoutMillis: 10000 });
  try {
    await c.connect();
    const r = await c.query('select current_user');
    const stream = (c as any).connection?.stream;
    return { label, ok: true, detail: `user ${r.rows[0].current_user}, tls ${Boolean(stream?.encrypted)}, verified ${stream?.authorized ?? 'n/a'}` };
  } catch (e) {
    return { label, ok: false, detail: String((e as Error).message) };
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function codeOf(work: Promise<unknown>): Promise<{ code: string; ms: number }> {
  const t0 = Date.now();
  try {
    await work;
    return { code: 'ok', ms: Date.now() - t0 };
  } catch (e) {
    return { code: `${(e as any).code ?? '?'} ${(e as Error).message}`, ms: Date.now() - t0 };
  }
}

async function pgStep() {
  const password = await serverRole();
  const a = await adminClient();
  const owns = (await a.query(`select count(*)::int n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'madar_server'`)).rows[0].n;
  await a.end();

  const holder = await connectWithRetry(() => serverClient(password));
  const stream = (holder as any).connection.stream;
  const who = (await holder.query(`select current_user, current_setting('lock_timeout') lock_timeout, current_setting('statement_timeout') statement_timeout`)).rows[0];
  const tls = { encrypted: Boolean(stream.encrypted), authorized: stream.authorized, servername: stream.servername, protocol: stream.getProtocol?.() };

  // 1. The transaction lock holds across statements of one transaction, and a second connection waits for it.
  await holder.query('begin');
  await holder.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]);
  await holder.query('select 1'); // a second statement in the same transaction: the pooler keeps the backend for the whole transaction
  const busy = await connectWithRetry(() => serverClient(password));
  await busy.query('begin');
  await busy.query(`set local lock_timeout = '2s'`);
  const timedOut = await codeOf(busy.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]));
  await busy.query('rollback');
  const leaked = (await busy.query(`select current_setting('lock_timeout') lock_timeout`)).rows[0].lock_timeout;

  const waiter = await connectWithRetry(() => serverClient(password));
  await waiter.query('begin');
  const waiting = codeOf(waiter.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]));
  await sleep(1500);
  await holder.query('commit');
  const waited = await waiting;
  const tryAfter = (await busy.query('select pg_try_advisory_xact_lock($1) got', [LOCK_KEY])).rows[0].got; // waiter still holds it
  await waiter.query('commit');
  const tryReleased = (await busy.query('select pg_try_advisory_xact_lock($1) got', [LOCK_KEY])).rows[0].got;

  // 2. statement_timeout through set local.
  await busy.query('begin');
  await busy.query(`set local statement_timeout = '1s'`);
  const slow = await codeOf(busy.query('select pg_sleep(3)'));
  await busy.query('rollback');

  // 3. A session-level SET in transaction mode: does it reach a later transaction? (The plan uses set local only.)
  await busy.query(`set statement_timeout = '7s'`);
  const sessionSet = (await busy.query(`select current_setting('statement_timeout') st`)).rows[0].st;
  for (const c of [holder, busy, waiter]) await c.end();

  // 4. TLS and certificate checks.
  const base = poolerConfig({ ref: REF, role: 'madar_server', password, mode: 'transaction', ca: ROOT_CA });
  const checks = await Promise.all([
    attempt('CA in ssl, rejectUnauthorized, no sslmode (planned)', base),
    attempt('no CA, rejectUnauthorized (public roots only)', { ...base, ssl: { rejectUnauthorized: true } }),
    attempt('URL with sslmode=require (pg treats it as verify-full)', `postgresql://${base.user}:${password}@${POOLER_HOST}:6543/postgres?sslmode=require`),
    attempt('no TLS at all', { ...base, ssl: false }),
  ]);

  report('pg', {
    role: { name: 'madar_server', ownsRelations: owns, connectedAs: who.current_user, defaults: { lock_timeout: who.lock_timeout, statement_timeout: who.statement_timeout } },
    tls,
    lock: {
      secondConnectionWithLockTimeout2s: timedOut,
      lockTimeoutAfterRollback: leaked,
      waiterGotLockAfterHolderCommit: waited,
      tryLockWhileWaiterHolds: tryAfter,
      tryLockAfterWaiterCommit: tryReleased,
    },
    statementTimeout1s: slow,
    sessionLevelSetSeenOnSameClient: sessionSet,
    connections: checks,
  });
}

async function sslStep() {
  const password = await serverRole();
  const before = await mgmt('/ssl-enforcement');
  const base = poolerConfig({ ref: REF, role: 'madar_server', password, mode: 'transaction', ca: ROOT_CA });
  const session = poolerConfig({ ref: REF, role: 'postgres', password: need('MADAR_TEST_DB_PASSWORD'), mode: 'session', ca: ROOT_CA });
  const plainBefore = [await attempt('transaction pooler, no TLS', { ...base, ssl: false }), await attempt('session pooler, no TLS', { ...session, ssl: false })];
  let after: unknown = null;
  let plainAfter: unknown = null;
  let tlsAfter: unknown = null;
  if (!before.body?.currentConfig?.database) {
    const put = await mgmt('/ssl-enforcement', { method: 'PUT', body: JSON.stringify({ requestedConfig: { database: true } }) });
    after = put.body;
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const now = await mgmt('/ssl-enforcement');
      if (now.body?.currentConfig?.database && now.body?.appliedSuccessfully) {
        after = now.body;
        break;
      }
    }
    await sleep(10000);
    plainAfter = [await attempt('transaction pooler, no TLS', { ...base, ssl: false }), await attempt('session pooler, no TLS', { ...session, ssl: false })];
    tlsAfter = [await attempt('transaction pooler, CA (planned)', base)];
  }
  report('ssl', { enforcementBefore: before.body, plainBefore, enforcementAfter: after, plainAfter, tlsAfter });
}

const HOOK_SQL = `
create table if not exists public.z0a_probe_config (key text primary key, value text not null);
alter table public.z0a_probe_config enable row level security;
insert into public.z0a_probe_config values ('mcp_url', '${SUPABASE_URL}/functions/v1/mcp') on conflict (key) do update set value = excluded.value;
create table if not exists public.z0a_probe_hook_log (at timestamptz not null default now(), event_keys text[], claims_has_client_id boolean, event_has_client_id boolean, auth_method text, aud_in text);
alter table public.z0a_probe_hook_log enable row level security;
revoke all on public.z0a_probe_config, public.z0a_probe_hook_log from anon, authenticated, public;
create or replace function public.z0a_probe_access_token_hook(event jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  claims jsonb := event->'claims';
begin
  insert into public.z0a_probe_hook_log (event_keys, claims_has_client_id, event_has_client_id, auth_method, aud_in)
  values (array(select jsonb_object_keys(event)), claims ? 'client_id', event ? 'client_id', event->>'authentication_method', claims->>'aud');
  if coalesce(claims->>'client_id', event->>'client_id') is not null then
    claims := jsonb_set(claims, '{aud}', to_jsonb((select value from public.z0a_probe_config where key = 'mcp_url')));
  end if;
  return jsonb_build_object('claims', claims);
end $$;
revoke execute on function public.z0a_probe_access_token_hook(jsonb) from authenticated, anon, public;
grant execute on function public.z0a_probe_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on public.z0a_probe_config to supabase_auth_admin;
grant insert on public.z0a_probe_hook_log to supabase_auth_admin;
drop policy if exists z0a_auth_read on public.z0a_probe_config;
create policy z0a_auth_read on public.z0a_probe_config for select to supabase_auth_admin using (true);
drop policy if exists z0a_auth_log on public.z0a_probe_hook_log;
create policy z0a_auth_log on public.z0a_probe_hook_log for insert to supabase_auth_admin with check (true);
`;

const AUTH_KEYS = ['hook_custom_access_token_enabled', 'hook_custom_access_token_uri', 'oauth_server_enabled', 'oauth_server_allow_dynamic_registration', 'oauth_server_authorization_path'];

async function probeUser(): Promise<{ id: string; email: string; password: string }> {
  const email = `z0a-probe-${stateValue('user-tag').slice(0, 8).toLowerCase()}@example.com`;
  const password = stateValue('user-password');
  const made = await probe('user-create', { email, password });
  if (!made.body.id) throw new Error(`user-create: ${JSON.stringify(made.body)}`);
  return { id: made.body.id, email, password };
}

async function hook() {
  const a = await adminClient();
  await a.query(HOOK_SQL);
  const saved = await mgmt('/config/auth');
  const savedValues = Object.fromEntries(AUTH_KEYS.map((k) => [k, saved.body[k]]));
  writeFileSync(join(stateDir(), 'auth-saved.json'), JSON.stringify(savedValues), { mode: 0o600 });
  const patch = await mgmt('/config/auth', {
    method: 'PATCH',
    body: JSON.stringify({
      hook_custom_access_token_enabled: true,
      hook_custom_access_token_uri: 'pg-functions://postgres/public/z0a_probe_access_token_hook',
      oauth_server_enabled: true,
      oauth_server_allow_dynamic_registration: true,
      oauth_server_authorization_path: '/oauth/consent',
    }),
  });
  await sleep(15000);
  const user = await probeUser();
  let flow: any = null;
  try {
    flow = await probe('oauth-flow', { email: user.email, password: user.password, redirectUri: 'http://127.0.0.1:8976/callback' });
  } finally {
    await probe('user-delete', { id: user.id });
  }
  const log = (await a.query('select event_keys, claims_has_client_id, event_has_client_id, auth_method, aud_in from public.z0a_probe_hook_log order by at')).rows;
  await a.end();
  report('hook', { patchStatus: patch.status, savedValues, flow: flow.body, flowStatus: flow.status, hookCalls: log });
}

async function restoreAuth() {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(stateValue('auth-saved.json', false));
  } catch {
    return { restored: 'nothing saved' };
  }
  const put = await mgmt('/config/auth', { method: 'PATCH', body: JSON.stringify(saved) });
  return { restored: put.status };
}

async function realtime() {
  const password = await serverRole();
  const a = await adminClient();
  await a.query(`drop policy if exists z0a_probe_receive on realtime.messages;
    create policy z0a_probe_receive on realtime.messages for select to authenticated
    using ((select realtime.topic()) = 'z0a-probe' and realtime.messages.extension = 'broadcast')`);
  const user = await probeUser();
  const server = await connectWithRetry(() => serverClient(password));
  const grants: Record<string, string> = {};
  try {
    const listening = probe('listen', { email: user.email, password: user.password, topic: 'z0a-probe', seconds: 14 });
    await sleep(9000);
    // realtime.send catches every error and raises only a WARNING, so a send counts as ok only with no warning.
    const notices: string[] = [];
    server.on('notice', (n) => notices.push(n.message ?? String(n)));
    const send = async (n: string, end: 'commit' | 'rollback') => {
      notices.length = 0;
      const r = await codeOf(
        (async () => {
          await server.query('begin');
          try {
            await server.query(`select realtime.send(jsonb_build_object('n', $1::text), 'changed', 'z0a-probe', true)`, [n]);
          } finally {
            await server.query(end);
          }
        })(),
      );
      return r.code === 'ok' && notices.length ? `warning: ${notices.join('; ')}` : r.code;
    };
    grants.noGrant = await send('no-grant', 'commit');
    await a.query(`grant usage on schema realtime to madar_server; grant execute on function realtime.send(jsonb, text, text, boolean) to madar_server`);
    grants.usageAndExecute = await send('usage-execute', 'commit');
    await a.query('grant insert on realtime.messages to madar_server');
    grants.plusInsert = await send('plus-insert', 'commit');
    if (grants.plusInsert !== 'ok') {
      await a.query(`drop policy if exists z0a_probe_server_send on realtime.messages;
        create policy z0a_probe_server_send on realtime.messages for insert to madar_server with check (true)`);
      grants.plusInsertPolicy = await send('plus-insert-policy', 'commit');
    }
    const rolled = await send('rolled-back', 'rollback');
    const committed = await send('committed', 'commit');
    const heard = await listening;
    report('realtime', { grants, rolledBackSend: rolled, committedSend: committed, listener: heard.body });
  } finally {
    await server.end();
    await probe('user-delete', { id: user.id });
    await a.end();
  }
}

async function cleanup() {
  const out: Record<string, unknown> = {};
  out.auth = await restoreAuth();
  const a = await adminClient();
  await a.query(`drop policy if exists z0a_probe_receive on realtime.messages;
    drop policy if exists z0a_probe_server_send on realtime.messages;
    drop function if exists public.z0a_probe_access_token_hook(jsonb);
    drop table if exists public.z0a_probe_config, public.z0a_probe_hook_log;
    do $$ begin
      if exists (select 1 from pg_roles where rolname = 'madar_server') then
        revoke all on schema realtime from madar_server;
        revoke all on function realtime.send(jsonb, text, text, boolean) from madar_server;
        revoke all on realtime.messages from madar_server;
        drop role madar_server;
      end if;
    end $$;`);
  out.leftovers = (
    await a.query(`select (select count(*) from pg_roles where rolname = 'madar_server')::int roles,
      (select count(*) from pg_proc where proname like 'z0a_%')::int functions,
      (select count(*) from pg_class where relname like 'z0a_%')::int tables,
      (select count(*) from pg_policy where polname like 'z0a_%')::int policies,
      (select count(*) from auth.users where email like 'z0a-probe-%')::int users,
      (select count(*) from storage.buckets where id like 'z0a-%')::int buckets`)
  ).rows[0];
  await a.end();
  out.function = supabaseCli(['functions', 'delete', PROBE_FUNCTION]).code === 0 ? 'deleted' : 'delete failed';
  out.secret = supabaseCli(['secrets', 'unset', 'Z0A_PROBE_TOKEN']).code === 0 ? 'unset' : 'unset failed';
  const auth = await mgmt('/config/auth');
  out.authNow = Object.fromEntries(AUTH_KEYS.map((k) => [k, auth.body[k]]));
  rmSync(stateDir(), { recursive: true, force: true });
  report('cleanup', out);
}

const steps: Record<string, () => Promise<void>> = { deploy, keys, region, pg: pgStep, ssl: sslStep, hook, realtime, storage: storageStep, cleanup };

const name = process.argv[2];
if (name) {
  const step = steps[name];
  if (!step) {
    console.error(`unknown step ${name}; steps: ${Object.keys(steps).join(' ')}`);
    process.exit(2);
  }
  await step();
}
