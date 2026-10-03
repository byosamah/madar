import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

/**
 * N1.0, the Realtime rollback spike (plan, sections 5.3 and 6.3; PF 4.1).
 * On the local stack: a realtime.send inside a rolled-back transaction sends nothing,
 * and one inside a committed transaction arrives on a private channel.
 *
 *   npx tsx scripts/proof/realtime-rollback.ts
 *
 * It reads the local URLs and keys from "supabase status -o env" (or from SUPABASE_URL, SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL), and refuses any host except 127.0.0.1 and localhost.
 * It adds a select policy for its own topic and one person, and removes both at the end.
 * The result goes into docs/superpowers/real-build/proof.md, section N1.0.
 */

export type JoinOutcome = 'refused' | 'joined' | 'timeout';

export type SpikeObservation = {
  /** Marks sent with realtime.send in a transaction that committed. */
  committed: string[];
  /** Marks sent with realtime.send in a transaction that rolled back. */
  rolledBack: string[];
  /** Marks that the signed-in member received on the private channel, in arrival order. */
  received: string[];
  /** Rows in realtime.messages for each mark, read after the run. */
  storedRows: Record<string, number>;
  /** What happened when a client with no session tried to join the private channel. */
  outsiderJoin: JoinOutcome;
};

export type SpikeResult = { ok: boolean; lines: string[] };

/** The verdict of one run. Every check prints a line, so a check with no match is visible. */
export function judge(seen: SpikeObservation): SpikeResult {
  if (seen.committed.length === 0 || seen.rolledBack.length === 0) {
    return { ok: false, lines: ['FAIL: the run needs at least one committed and one rolled-back mark.'] };
  }
  const lines: string[] = [];
  let ok = true;
  const check = (pass: boolean, text: string) => {
    if (!pass) ok = false;
    lines.push(`${pass ? 'ok' : 'FAIL'}: ${text}`);
  };
  const arrivals = (mark: string) => seen.received.filter((m) => m === mark).length;
  for (const mark of seen.committed) {
    const n = arrivals(mark);
    check(n === 1, `committed mark ${mark} arrived ${n} time(s) on the channel; expected 1.`);
  }
  for (const mark of seen.rolledBack) {
    const n = arrivals(mark);
    check(n === 0, `rolled-back mark ${mark} arrived ${n} time(s) on the channel; expected 0.`);
  }
  for (const mark of seen.committed) {
    const n = seen.storedRows[mark] ?? 0;
    check(n === 1, `committed mark ${mark} has ${n} row(s) in realtime.messages; expected 1.`);
  }
  for (const mark of seen.rolledBack) {
    const n = seen.storedRows[mark] ?? 0;
    check(n === 0, `rolled-back mark ${mark} has ${n} row(s) in realtime.messages; expected 0.`);
  }
  if (seen.outsiderJoin === 'refused') check(true, 'a client with no session could not join the private channel.');
  else if (seen.outsiderJoin === 'joined') check(false, 'a client with no session joined the private channel; expected a refusal.');
  else check(false, 'the join of a client with no session got no answer in time; expected a refusal.');
  return { ok, lines };
}

type Local = { url: string; anonKey: string; serviceKey: string; dbUrl: string };

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** The local stack's URLs and keys. It refuses a remote host, so the spike never touches a cloud project. */
function localStack(): Local {
  let env: Record<string, string> = {};
  if (!process.env.SUPABASE_URL) {
    const text = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8' });
    env = Object.fromEntries(
      text
        .split('\n')
        .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim()))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1], m[2]]),
    );
  }
  const local: Local = {
    url: process.env.SUPABASE_URL ?? env.API_URL ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? env.ANON_KEY ?? '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY ?? '',
    dbUrl: process.env.DATABASE_URL ?? env.DB_URL ?? '',
  };
  for (const [name, value] of Object.entries(local)) {
    if (!value) throw new Error(`The local stack gave no ${name}. Run "supabase start" first.`);
  }
  for (const value of [local.url, local.dbUrl]) {
    const host = new URL(value).hostname;
    if (!LOCAL_HOSTS.has(host)) throw new Error(`Refused: ${host} is not the local stack.`);
  }
  return local;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Joins a private channel and waits for the answer of the server. */
function join(channel: RealtimeChannel, ms: number): Promise<JoinOutcome> {
  return new Promise((done) => {
    const timer = setTimeout(() => done('timeout'), ms);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        done('joined');
      } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        clearTimeout(timer);
        done('refused');
      }
    });
  });
}

/** One realtime.send in its own transaction, then a commit, a rollback, or an error that forces the rollback. */
async function sendIn(db: pg.Client, topic: string, mark: string, end: 'commit' | 'rollback' | 'error'): Promise<void> {
  await db.query('begin');
  try {
    await db.query(`select realtime.send(jsonb_build_object('mark', $1::text), 'changed', $2::text, true)`, [mark, topic]);
    if (end === 'error') await db.query('select 1 / 0');
    await db.query(end === 'commit' ? 'commit' : 'rollback');
  } catch (error) {
    await db.query('rollback');
    if (end !== 'error') throw error;
  }
}

export async function runSpike(log: (line: string) => void = console.log): Promise<SpikeResult> {
  const local = localStack();
  const run = randomUUID().slice(0, 8);
  const topic = `n1-spike-${run}`;
  const policy = `n1 spike ${run}`;
  const email = `n1-spike-${run}@madar.test`;
  const password = randomUUID();
  const db = new pg.Client({ connectionString: local.dbUrl });
  const admin = createClient(local.url, local.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const member = createClient(local.url, local.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const outsider = createClient(local.url, local.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const clients: SupabaseClient[] = [member, outsider];
  let userId = '';
  await db.connect();
  db.on('notice', (notice) => log(`notice from Postgres: ${notice.message}`));
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
    userId = created.data.user.id;
    // The policy reads like the one of section 5.3: only this topic, only broadcast, only this person. No insert policy.
    await db.query(
      `create policy "${policy}" on realtime.messages for select to authenticated
       using ((select realtime.topic()) = '${topic}' and realtime.messages.extension = 'broadcast' and (select auth.uid()) = '${userId}'::uuid)`,
    );
    const signedIn = await member.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw new Error(`signIn: ${signedIn.error?.message}`);
    await member.realtime.setAuth(signedIn.data.session.access_token);

    const received: string[] = [];
    const memberChannel = member
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, ({ payload }) => received.push(String(payload.mark)));
    const memberJoin = await join(memberChannel, 15000);
    log(`member join on the private channel ${topic}: ${memberJoin}`);
    if (memberJoin !== 'joined') throw new Error('The signed-in member could not join, so the spike cannot listen.');

    const outsiderJoin = await join(outsider.channel(topic, { config: { private: true } }), 15000);
    log(`join with no session on the same private channel: ${outsiderJoin}`);

    const committed = [`${run}-commit-1`, `${run}-commit-2`];
    const rolledBack = [`${run}-rollback`, `${run}-error`];
    // Commit, rollback, rollback by an error, commit: the second commit proves the listener was still alive after the rollbacks.
    await sendIn(db, topic, committed[0], 'commit');
    await sendIn(db, topic, rolledBack[0], 'rollback');
    await sendIn(db, topic, rolledBack[1], 'error');
    await sendIn(db, topic, committed[1], 'commit');
    await sleep(4000);
    log(`received in order: ${received.join(', ') || '(nothing)'}`);

    const rows = await db.query<{ mark: string; n: string }>(
      `select payload->>'mark' as mark, count(*) as n from realtime.messages where topic = $1 group by 1`,
      [topic],
    );
    const storedRows = Object.fromEntries(rows.rows.map((row) => [row.mark, Number(row.n)]));
    return judge({ committed, rolledBack, received, storedRows, outsiderJoin });
  } finally {
    for (const client of clients) await client.removeAllChannels();
    await db.query(`drop policy if exists "${policy}" on realtime.messages`).catch(() => undefined);
    if (userId) await admin.auth.admin.deleteUser(userId);
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSpike()
    .then((result) => {
      for (const line of result.lines) console.log(line);
      console.log(result.ok ? 'PASS' : 'FAIL');
      process.exit(result.ok ? 0 : 1);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
