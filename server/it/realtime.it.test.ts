import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps, SignalPort } from '../core/ports';
import { runCall } from '../core/runCall';
import type { ChangeSignal, RunResult } from '../core/types';
import { pgDb } from '../data/sql';
import { recordingMeter } from '../test/fakes/meter';
import { realtimeSender, SIGNAL_EVENT } from '../signal/realtime';
import { localClient, localDbUrl } from './migrate';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * Suite 7 of plan 5.3 on the full local stack after "supabase db reset" (task N1.1): the Realtime sender of
 * server/signal/realtime.ts inside runCall as madar_server, and the policies of 20261004000200_platform_realtime.sql.
 * The writes run on the it office (a schema of its own, server/it/runCallOffice.ts). The Realtime policies read the people
 * of public.users (madar_private.current_madar_user_id), so the test adds its people there, with an Auth user each, and
 * removes them at the end. It talks only to 127.0.0.1.
 */

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
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`The Realtime tests run only on the local stack, not on ${host}.`);
  return {
    apiUrl,
    publishableKey: values.SUPABASE_PUBLISHABLE_KEY ?? values.PUBLISHABLE_KEY ?? values.ANON_KEY ?? '',
    secretKey: values.SUPABASE_SERVICE_ROLE_KEY ?? values.SERVICE_ROLE_KEY ?? '',
  };
}

type JoinOutcome = { outcome: 'refused' | 'joined' | 'timeout'; reason?: string };
/** The words of the Realtime server when a policy refuses a private channel (proof.md, N1.0). */
const AUTHORIZATION_REFUSAL = /Unauthorized|permission/i;

/** Joins a private channel and waits for the answer of the server. A refusal keeps the error that the server sent. */
function join(channel: RealtimeChannel, ms = 15_000): Promise<JoinOutcome> {
  return new Promise((done) => {
    const timer = setTimeout(() => done({ outcome: 'timeout' }), ms);
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        done({ outcome: 'joined' });
      } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        clearTimeout(timer);
        done({ outcome: 'refused', reason: err?.message });
      }
    });
  });
}

/** A refusal by a policy, not a socket drop or a timeout. */
const refusedByPolicy = (o: JoinOutcome) => o.outcome === 'refused' && AUTHORIZATION_REFUSAL.test(o.reason ?? '');

async function until(test: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('The awaited message did not arrive in time.');
    await new Promise((done) => setTimeout(done, 50));
  }
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

describe('suite 7: change signals on Realtime, on the local stack', () => {
  const stack = localStack();
  const run = randomUUID().slice(0, 8);
  const password = randomUUID();
  const admin = createClient(stack.apiUrl, stack.secretKey, options);
  const clients: SupabaseClient[] = [];
  const authUsers: string[] = [];
  const publicUsers: string[] = [];
  let office: ItOffice;
  let deps: Deps;
  let pgAdmin: pg.Client;
  /** Every signal that runCall gave the sender, so a test can name the ones it waits for. */
  const handed: ChangeSignal[] = [];
  const failed: number[] = [];
  /** What the person me received, for each topic. */
  const received: Record<string, ChangeSignal[]> = {};
  let me = '';
  let leader = '';
  let other = '';
  let noticeId = '';
  const joins: Record<string, JoinOutcome> = {};

  /** A signed-in client for a Madar user of public.users; active false makes a turned-off person. */
  async function person(userId: string, active: boolean): Promise<SupabaseClient> {
    const email = `n1-${run}-${userId}@madar.test`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw new Error(`createUser: ${made.error?.message}`);
    authUsers.push(made.data.user.id);
    const doc = { id: userId, name: userId, email, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Test', active, ownerId: null, preferences: {} };
    await pgAdmin.query('delete from public.users where id = $1', [userId]);
    await pgAdmin.query('insert into public.users (id, doc, auth_user_id) values ($1, $2, $3)', [userId, JSON.stringify(doc), made.data.user.id]);
    publicUsers.push(userId);
    const client = createClient(stack.apiUrl, stack.publishableKey, options);
    clients.push(client);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw new Error(`signIn: ${signedIn.error?.message}`);
    await client.realtime.setAuth(signedIn.data.session.access_token);
    return client;
  }

  function listen(client: SupabaseClient, topic: string, into?: ChangeSignal[]): RealtimeChannel {
    const channel = client.channel(topic, { config: { private: true } });
    if (into) channel.on('broadcast', { event: SIGNAL_EVENT }, ({ payload }) => into.push(payload as ChangeSignal));
    return channel;
  }

  const call = (userId: string, name: string, input: unknown, signal?: SignalPort): Promise<RunResult> =>
    runCall(signal ? { ...deps, signal } : deps, { principal: { userId }, name, input, batch: newBatch() });

  const arrivals = (topic: string, id: string) => (received[topic] ?? []).filter((signal) => signal.id === id);

  beforeAll(async () => {
    office = await startOffice('rt');
    const isolate = office.isolate();
    const sender = realtimeSender({ log: isolate.log, meter: { ...recordingMeter(), signalsFailed: (n) => failed.push(n) } });
    deps = { ...isolate, signal: { send: async (q, signals) => { handed.push(...signals); await sender.send(q, signals); } } };
    pgAdmin = await localClient();

    const notice = Object.values(office.seed.notifications).find((n) => !n.read)!;
    me = notice.userId;
    noticeId = notice.id;
    leader = office.seed.projects.prj_001.leaderId!;
    other = Object.values(office.seed.users).find((u) => u.id !== me && u.active && u.kind === 'human')!.id;

    const mine = await person(me, true);
    const second = await person(other, true);
    const off = await person(`usr_n1off${run}`, false);
    const outsider = createClient(stack.apiUrl, stack.publishableKey, options);
    clients.push(outsider);

    received.office = [];
    received[`person:${me}`] = [];
    joins.mineOffice = await join(listen(mine, 'office', received.office));
    joins.minePerson = await join(listen(mine, `person:${me}`, received[`person:${me}`]));
    joins.outsiderOffice = await join(listen(outsider, 'office'));
    joins.offOffice = await join(listen(off, 'office'));
    joins.offPerson = await join(listen(off, `person:usr_n1off${run}`));
    joins.otherMine = await join(listen(second, `person:${me}`));
    joins.otherOwn = await join(listen(second, `person:${other}`));
  }, 120_000);

  afterAll(async () => {
    for (const client of clients) await client.removeAllChannels().catch(() => undefined);
    for (const id of authUsers) await admin.auth.admin.deleteUser(id).catch(() => undefined);
    if (pgAdmin) {
      await pgAdmin.query('delete from public.users where id = any($1)', [publicUsers]).catch(() => undefined);
      await pgAdmin.end();
    }
    await office?.close();
  });

  it('lets an active person join the office topic and the own person topic', () => {
    expect([joins.mineOffice, joins.minePerson, joins.otherOwn].map((o) => o.outcome)).toEqual(['joined', 'joined', 'joined']);
  });

  it('refuses a client with no session, a turned-off person, and a person on the topic of another person', () => {
    for (const name of ['outsiderOffice', 'offOffice', 'offPerson', 'otherMine']) {
      expect(refusedByPolicy(joins[name]), `${name}: ${joins[name].outcome} ${joins[name].reason ?? ''}`).toBe(true);
    }
  });

  it('commits a write as madar_server and sends one message on each channel of its signals', async () => {
    const created = await call(leader, 'tasks.create', { projectId: 'prj_001', title: `Signal ${run}` });
    if (!created.ok) throw new Error(created.error.message);
    const officeSignal = handed.find((s) => s.storyId === created.storyId && s.channel === 'office')!;
    expect(officeSignal).toBeDefined();
    const read = await call(me, 'notifications.markRead', { ids: [noticeId] });
    if (!read.ok) throw new Error(read.error.message);
    const personSignal = handed.find((s) => s.storyId === read.storyId && s.channel === `person:${me}`)!;
    expect(personSignal).toBeDefined();

    await until(() => arrivals('office', officeSignal.id).length > 0 && arrivals(`person:${me}`, personSignal.id).length > 0);
    // Let a second copy arrive, if one were sent.
    await new Promise((done) => setTimeout(done, 500));
    expect(arrivals('office', officeSignal.id)).toEqual([officeSignal]);
    expect(arrivals(`person:${me}`, personSignal.id)).toEqual([personSignal]);
    expect(arrivals('office', personSignal.id)).toEqual([]);

    expect(await office.sql('select doc->>\'title\' as title from tasks where doc->>\'title\' = $1', [`Signal ${run}`])).toHaveLength(1);
    const rows = await pgAdmin.query<{ topic: string; n: string }>(
      "select topic, count(*) as n from realtime.messages where payload->>'id' = any($1) and extension = 'broadcast' and private group by topic order by topic",
      [[officeSignal.id, personSignal.id]],
    );
    expect(rows.rows.map((r) => [r.topic, Number(r.n)])).toEqual([['office', 1], [`person:${me}`, 1]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(failed).toEqual([]);
  });

  it('sends nothing after a rollback or a read', async () => {
    const before = handed.length;
    const read = await call(me, 'dashboard.get', {});
    expect(read.ok).toBe(true);
    expect(handed.length).toBe(before);

    const rolledBack: ChangeSignal[] = [];
    const failing: SignalPort = {
      async send(q, signals) {
        await deps.signal.send(q, signals);
        rolledBack.push(...signals);
        throw new Error('A failure after the send, so the save rolls back.');
      },
    };
    const lost = await call(leader, 'tasks.create', { projectId: 'prj_001', title: `Rolled back ${run}` }, failing);
    expect(lost.ok).toBe(false);
    expect(rolledBack.map((s) => s.channel)).toContain('office');
    expect(await office.sql('select 1 from tasks where doc->>\'title\' = $1', [`Rolled back ${run}`])).toEqual([]);

    // A commit after the rollback: its message proves that the channel still listened when the rolled-back one would have come.
    const marker = await call(leader, 'tasks.create', { projectId: 'prj_001', title: `Marker ${run}` });
    if (!marker.ok) throw new Error(marker.error.message);
    const markerSignal = handed.find((s) => s.storyId === marker.storyId && s.channel === 'office')!;
    await until(() => arrivals('office', markerSignal.id).length > 0);
    await new Promise((done) => setTimeout(done, 500));
    for (const signal of rolledBack) expect(arrivals(signal.channel, signal.id)).toEqual([]);
    const stored = await pgAdmin.query<{ n: string }>("select count(*) as n from realtime.messages where payload->>'id' = any($1)", [rolledBack.map((s) => s.id)]);
    expect(Number(stored.rows[0].n)).toBe(0);
    expect(failed).toEqual([]);
  });

  it.each([
    ['without the insert grant (the rights before this migration: usage and execute)', [], /BroadcastMessage: permission denied for table messages/],
    ['with the insert grant but no insert policy for the role', ['grant insert on realtime.messages to %I'], /BroadcastMessage: new row violates row-level security policy/],
  ])('counts a send %s as a failed signal: realtime.send warns, the sender logs it and reports it to the meter', async (_, more, warning) => {
    // A role of its own with the rights of the case, so the test never takes a right from madar_server.
    const role = `madar_n1_nosend_${process.pid}`;
    const rolePassword = randomUUID();
    const dropRole = async () => {
      if ((await pgAdmin.query('select 1 from pg_roles where rolname = $1', [role])).rowCount === 0) return;
      await pgAdmin.query(`revoke all on realtime.messages from ${role}`);
      await pgAdmin.query(`revoke all on function realtime.send(jsonb, text, text, boolean) from ${role}`);
      await pgAdmin.query(`revoke usage on schema realtime from ${role}`);
      await pgAdmin.query(`drop role ${role}`);
    };
    await dropRole();
    await pgAdmin.query(`create role ${role} login password '${rolePassword}'`);
    await pgAdmin.query(`grant usage on schema realtime to ${role}`);
    await pgAdmin.query(`grant execute on function realtime.send(jsonb, text, text, boolean) to ${role}`);
    for (const grant of more) await pgAdmin.query(grant.replace('%I', role));
    const url = new URL(localDbUrl());
    url.username = role;
    url.password = rolePassword;
    const db = pgDb({ writeUrl: url.toString(), readUrl: url.toString() });
    const logs: { level: string; message: string; fields?: Record<string, unknown> }[] = [];
    const counted: number[] = [];
    const sender = realtimeSender({
      log: { info: () => undefined, warn: () => undefined, error: (message, fields) => logs.push({ level: 'error', message, fields }) },
      meter: { ...recordingMeter(), signalsFailed: (n) => counted.push(n) },
    });
    const signal: ChangeSignal = {
      v: 1, id: `sig_nosend_${run}_${more.length}`, channel: 'office', seq: 1, projects: [], office: true, kinds: ['tasks'], people: [], storyId: 'sty_nosend', actorId: leader,
    };
    try {
      // The statement succeeds and the transaction commits: realtime.send turns the failure into a warning.
      await expect(db.tx('write', (q) => sender.send(q, [signal]))).resolves.toBeUndefined();
    } finally {
      await db.close();
      await dropRole();
    }
    expect(counted).toEqual([1]);
    expect(logs).toHaveLength(1);
    expect(logs[0].fields).toMatchObject({ failed: 1, channels: ['office'] });
    expect((logs[0].fields?.warnings as string[])[0]).toMatch(warning);
    const stored = await pgAdmin.query<{ n: string }>("select count(*) as n from realtime.messages where payload->>'id' = $1", [signal.id]);
    expect(Number(stored.rows[0].n)).toBe(0);
  });

  it('keeps a token of an agent (client_id) out of both topics', async () => {
    const authId = (await pgAdmin.query<{ auth_user_id: string }>('select auth_user_id from public.users where id = $1', [me])).rows[0].auth_user_id;
    const visible = async (claims: Record<string, unknown>, topic: string): Promise<number> => {
      await pgAdmin.query('begin');
      try {
        await pgAdmin.query(
          "insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'broadcast', 'changed', '{}'::jsonb, true)",
          [topic],
        );
        await pgAdmin.query('set local role authenticated');
        await pgAdmin.query("select set_config('request.jwt.claims', $1, true), set_config('realtime.topic', $2, true)", [JSON.stringify(claims), topic]);
        const seen = await pgAdmin.query<{ n: string }>('select count(*) as n from realtime.messages where topic = $1', [topic]);
        return Number(seen.rows[0].n);
      } finally {
        await pgAdmin.query('rollback');
      }
    };
    const browser = { sub: authId, role: 'authenticated', aud: 'authenticated' };
    const agent = { ...browser, client_id: randomUUID() };
    expect(await visible(browser, 'office')).toBeGreaterThan(0);
    expect(await visible(browser, `person:${me}`)).toBeGreaterThan(0);
    expect(await visible(agent, 'office')).toBe(0);
    expect(await visible(agent, `person:${me}`)).toBe(0);
  });
});
