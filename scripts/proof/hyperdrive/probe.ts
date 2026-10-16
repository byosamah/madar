// madar-probe: the Hyperdrive probe Worker on madar-test (proof.md, "Hyperdrive probe on madar-test (2026-10-16)").
// It sends the exact statements of the server (server/data/sql.ts, server/signal/realtime.ts) through two real Hyperdrive
// configs: DB_SESSION (the session pooler, port 5432) and DB_TX (the transaction pooler, port 6543).
//   GET /<case>?db=session|tx      cases: whoami param start lock lockpart cache notice realtime timing tx5
// Every request needs the header x-probe-secret equal to the secret PROBE_SECRET. Each request opens its own pg clients
// (never at module level: on Workers a socket belongs to its request) and ends them after the answer. Each case has a
// time limit, so a hang shows as a timeout in the answer. Each answer names request.cf.colo and the cf-placement header.
import pg from 'pg';
import { median, sameSecret } from './lib.ts';

type Hyperdrive = { connectionString: string };
type Env = { DB_SESSION: Hyperdrive; DB_TX: Hyperdrive; PROBE_SECRET?: string };
type Ctx = { waitUntil(promise: Promise<unknown>): void };
type Notice = { severity?: string; code?: string; message?: string };
type Opened = { client: pg.Client; notices: Notice[]; connectMs: number };

// The statements of server/data/sql.ts (START) and server/signal/realtime.ts (SEND), copied as they are.
const LOCK_TIMEOUT = "set local lock_timeout = '5s'";
const STATEMENT_TIMEOUT = "set local statement_timeout = '10s'";
const BEGIN = { read: 'begin isolation level repeatable read, read only', write: 'begin' } as const;
const START = { read: `${BEGIN.read}; ${STATEMENT_TIMEOUT}`, write: `${BEGIN.write}; ${LOCK_TIMEOUT}; ${STATEMENT_TIMEOUT}` } as const;
const SEND = `select realtime.send(s.item->'payload', $2::text, s.item->>'topic', true)
  from jsonb_array_elements($1::jsonb) with ordinality as s(item, n)
  order by s.n`;
const SEND_WARNING = 'WarnSendingBroadcastMessage:';
/** The first key of the two-key lock space of the health check (proof.md, E4). The second key is random for each run. */
const LOCK_CLASS = 7310999;
const LOCK = 'select pg_advisory_xact_lock($1, $2)';

const CASE_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 8_000;
const QUERY_TIMEOUT_MS = 8_000;

let isolate: string | undefined;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const randomKey = () => 1 + Math.floor(Math.random() * 2_000_000_000);

function errorOf(error: unknown) {
  const e = error as { message?: string; code?: string };
  return { message: e?.message ?? String(error), code: e?.code };
}

type Pending = { client: number; n: number; text: string; at: number };

/** One request: its pg clients, ended after the answer. It keeps the statements still open, so a hang names its statement. */
class Session {
  /** ?wait=long gives each query 25 s and the case 28 s, so an error that Hyperdrive gives after its own limits can show. */
  queryTimeoutMs = QUERY_TIMEOUT_MS;
  private clients: pg.Client[] = [];
  private open_ = new Set<Pending>();
  private hung: (Pending & { waitedMs: number })[] = [];
  constructor(private readonly hyperdrive: Hyperdrive) {}

  /** The statements that timed out, and the ones that have no answer yet: these are the ones that hung. */
  pending() {
    const now = Date.now();
    const open = [...this.open_].map((p) => ({ client: p.client, n: p.n, text: p.text, waitedMs: now - p.at, state: 'open' }));
    return [...this.hung.map((p) => ({ client: p.client, n: p.n, text: p.text, waitedMs: p.waitedMs, state: 'timed out' })), ...open];
  }

  private track(client: pg.Client, index: number): void {
    const target = client as unknown as { query: (...args: unknown[]) => unknown };
    const query = target.query.bind(client);
    let n = 0;
    target.query = (...args: unknown[]) => {
      const first = args[0] as string | { text?: string };
      const entry: Pending = { client: index, n: (n += 1), text: String(typeof first === 'string' ? first : first?.text).slice(0, 90), at: Date.now() };
      this.open_.add(entry);
      const result = query(...args);
      if (result instanceof Promise) {
        result.then(
          () => this.open_.delete(entry),
          (error: unknown) => {
            this.open_.delete(entry);
            if (/timeout/i.test(errorOf(error).message)) this.hung.push({ ...entry, waitedMs: Date.now() - entry.at });
          },
        );
      }
      return result;
    };
  }

  async open(): Promise<Opened> {
    const client = new pg.Client({
      connectionString: this.hyperdrive.connectionString,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      query_timeout: this.queryTimeoutMs,
    });
    const notices: Notice[] = [];
    client.on('notice', (n: Notice) => notices.push({ severity: n.severity, code: n.code, message: n.message }));
    client.on('error', () => undefined);
    this.clients.push(client);
    this.track(client, this.clients.length);
    const t0 = Date.now();
    await client.connect();
    return { client, notices, connectMs: Date.now() - t0 };
  }

  /** Ends every client. A client that hangs gets 1 s, so the end never holds the request. */
  end(): Promise<unknown> {
    return Promise.all(this.clients.map((c) => Promise.race([c.end().catch(() => undefined), sleep(1000)])));
  }
}

async function one<T = Record<string, unknown>>(c: pg.Client, text: string, values?: unknown[]): Promise<T> {
  return (await c.query(text, values)).rows[0] as T;
}

async function show(c: pg.Client, name: string): Promise<string> {
  return (await one<Record<string, string>>(c, `show ${name}`))[name];
}

async function settings(c: pg.Client) {
  return {
    statement_timeout: await show(c, 'statement_timeout'),
    lock_timeout: await show(c, 'lock_timeout'),
    transaction_isolation: await show(c, 'transaction_isolation'),
    transaction_read_only: await show(c, 'transaction_read_only'),
  };
}

const pid = async (c: pg.Client) => (await one<{ pid: number }>(c, 'select pg_backend_pid() as pid')).pid;

// a. One parameter query (the extended protocol, an unnamed statement).
async function caseParam(s: Session) {
  const { client, connectMs } = await s.open();
  const t0 = Date.now();
  const row = await one<{ n: number }>(client, 'select $1::int + 1 as n', [41]);
  return { connectMs, n: row.n, ok: row.n === 42, queryMs: Date.now() - t0 };
}

// b. The joined start of a read and of a write, as one simple query, and the settings inside and after.
async function caseStart(s: Session) {
  const { client: c, notices } = await s.open();
  const before = await settings(c);

  await c.query(START.read);
  const readPids = [await pid(c)];
  const insideRead = await settings(c);
  readPids.push(await pid(c));
  await c.query('commit');
  const afterRead = await settings(c);

  await c.query(START.write);
  const writePids = [await pid(c)];
  const insideWrite = await settings(c);
  writePids.push(await pid(c));
  await c.query('commit');
  const afterWrite = await settings(c);

  // A joined start with a bad value fails; the rollback after it succeeds, and nothing stays set.
  let badStart: unknown;
  try {
    await c.query("begin; set local lock_timeout = 'not a time'");
    badStart = { failed: false };
  } catch (error) {
    badStart = { failed: true, ...errorOf(error) };
  }
  await c.query('rollback');
  const afterBad = await settings(c);
  const outsidePids = [await pid(c), await pid(c), await pid(c)];

  const outsideIsOutside = (x: typeof before) =>
    x.statement_timeout === before.statement_timeout && x.lock_timeout === before.lock_timeout &&
    x.transaction_isolation === before.transaction_isolation && x.transaction_read_only === before.transaction_read_only;
  const pass =
    insideRead.statement_timeout === '10s' && insideRead.transaction_isolation === 'repeatable read' && insideRead.transaction_read_only === 'on' &&
    insideWrite.lock_timeout === '5s' && insideWrite.statement_timeout === '10s' && insideWrite.transaction_read_only === 'off' &&
    before.statement_timeout !== '10s' && before.lock_timeout !== '5s' &&
    outsideIsOutside(afterRead) && outsideIsOutside(afterWrite) && outsideIsOutside(afterBad) &&
    readPids[0] === readPids[1] && writePids[0] === writePids[1];
  return { pass, before, insideRead, afterRead, readPids, insideWrite, afterWrite, writePids, badStart, afterBad, outsidePids, notices };
}

// c. The office lock with three clients in one request: A holds it 1.5 s, B waits (lock_timeout 5s), C gives up (300ms, 55P03),
// then D takes it at once. The rules: two transactions never hold the lock at the same time; B gets it only after A commits;
// C fails with 55P03 whenever it reaches the lock while A holds it; D waits for nothing. Hyperdrive may hold a BEGIN until an
// origin connection is free: that wait is recorded as a queue (bQueuedMs, cQueuedMs), and it is not a lock wait.
async function caseLock(s: Session) {
  const key = randomKey();
  const [a, b, c] = await Promise.all([s.open(), s.open(), s.open()]);
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  await a.client.query('begin');
  await a.client.query(LOCK, [LOCK_CLASS, key]);
  const aLocked = at();
  const aPinLocked = await pinOf(a.client, key);
  const runA = (async () => {
    await a.client.query('select pg_sleep(1.5)');
    const aPinLast = await pinOf(a.client, key);
    await a.client.query('commit');
    const aOneTransaction = aPinLocked.pid === aPinLast.pid && aPinLocked.t === aPinLast.t && aPinLocked.mine === 1 && aPinLast.mine === 1;
    return { aCommit: at(), aOneTransaction };
  })();
  await sleep(300);
  const runB = (async () => {
    const begin = at();
    await b.client.query("begin; set local lock_timeout = '5s'");
    const bQueuedMs = at() - begin;
    const bPid = (await pinOf(b.client, key)).pid;
    const bLockStart = at();
    await b.client.query(LOCK, [LOCK_CLASS, key]);
    const bGot = at();
    await b.client.query('commit');
    return { bQueuedMs, bPid, bLockStart, bGot, bWaitMs: bGot - bLockStart, bCommit: at() };
  })();
  const runC = (async () => {
    const begin = at();
    await c.client.query("begin; set local lock_timeout = '300ms'");
    const cQueuedMs = at() - begin;
    const cPid = (await pinOf(c.client, key)).pid;
    const cLockStart = at();
    try {
      await c.client.query(LOCK, [LOCK_CLASS, key]);
      const cGot = at();
      await c.client.query('commit');
      return { cQueuedMs, cPid, cLockStart, cGotLock: true, cGot, cMs: cGot - cLockStart, cCommit: at() };
    } catch (error) {
      const cFailed = at();
      await c.client.query('rollback');
      return { cQueuedMs, cPid, cLockStart, cGotLock: false, cMs: cFailed - cLockStart, cError: errorOf(error) };
    }
  })();
  const [ra, rb, rc] = await Promise.all([runA, runB, runC]);
  const d = await s.open();
  await d.client.query("begin; set local lock_timeout = '5s'");
  const dStart = Date.now();
  await d.client.query(LOCK, [LOCK_CLASS, key]);
  const dWaitMs = Date.now() - dStart;
  await d.client.query('commit');

  // The times come from one isolate clock, read when each answer arrives, so the checks allow 50 ms.
  const slack = 50;
  const bAfterA = rb.bGot >= ra.aCommit - slack;
  const cReachedWhileAHeld = rc.cLockStart < ra.aCommit - 300 - slack;
  const cRule = cReachedWhileAHeld
    ? !rc.cGotLock && rc.cError?.code === '55P03' && rc.cMs >= 250 && rc.cMs <= 1000
    : !rc.cGotLock || ((rc.cGot ?? 0) >= ra.aCommit - slack && ((rc.cGot ?? 0) >= rb.bCommit - slack || rb.bGot >= (rc.cCommit ?? 0) - slack));
  const bWaitedOnLock = rb.bLockStart < ra.aCommit - slack;
  const pass = ra.aOneTransaction && bAfterA && cRule && dWaitMs < 500;
  return {
    pass,
    lockTimeoutTested: cReachedWhileAHeld,
    lockWaitTested: bWaitedOnLock,
    key,
    aLocked,
    aPid: aPinLocked.pid,
    ...ra,
    ...rb,
    ...rc,
    dWaitMs,
    connectMs: [a.connectMs, b.connectMs, c.connectMs, d.connectMs],
  };
}

/**
 * The backend, the transaction start time and the own lock of a client inside a transaction. The same pid and the same now()
 * on every statement prove that the statements ran in one transaction on one backend.
 */
async function pinOf(c: pg.Client, key: number) {
  return one<{ pid: number; t: string; mine: number }>(c,
    "select pg_backend_pid() as pid, now()::text as t, (select count(*)::int from pg_locks where locktype = 'advisory' and classid = $1::int::oid and objid = $2::int::oid and objsubid = 2 and granted and pid = pg_backend_pid()) as mine",
    [LOCK_CLASS, key]);
}

// c (second part). One side of the lock across two HTTP requests: role A holds the lock 1.5 s; role B waits until A's lock
// shows in pg_locks, waits 300 ms more, then takes the lock with lock_timeout 5s.
async function caseLockPart(s: Session, url: URL) {
  const key = Number(url.searchParams.get('key'));
  const role = url.searchParams.get('role');
  if (!Number.isInteger(key) || key <= 0 || (role !== 'A' && role !== 'B')) return { error: 'needs role=A|B and key=<positive int>' };
  const { client: c, connectMs } = await s.open();
  if (role === 'A') {
    await c.query('begin');
    const first = await pinOf(c, key);
    await c.query(LOCK, [LOCK_CLASS, key]);
    const lockedAt = Date.now();
    const locked = await pinOf(c, key);
    await c.query('select pg_sleep(1.5)');
    const last = await pinOf(c, key);
    await c.query('commit');
    const oneTransaction = first.pid === locked.pid && locked.pid === last.pid && first.t === locked.t && locked.t === last.t;
    return { role, connectMs, lockedAt, commitAt: Date.now(), oneTransaction, holdsOwnLock: locked.mine === 1 && last.mine === 1, pins: [first, locked, last] };
  }
  const seen = Date.now();
  let polls = 0;
  for (;;) {
    polls += 1;
    const row = await one<{ n: number }>(c,
      "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1::int::oid and objid = $2::int::oid and objsubid = 2 and granted",
      [LOCK_CLASS, key]);
    if (row.n > 0) break;
    if (Date.now() - seen > 6000) {
      const held = (await c.query("select pid, objid::text as objid, granted from pg_locks where locktype = 'advisory' and classid = $1::int::oid", [LOCK_CLASS])).rows;
      return { role, connectMs, error: 'A never held the lock', polls, advisoryLocksOfTheClassNow: held };
    }
    await sleep(100);
  }
  const sawAt = Date.now();
  await sleep(300);
  await c.query("begin; set local lock_timeout = '5s'");
  const start = Date.now();
  await c.query(LOCK, [LOCK_CLASS, key]);
  const gotAt = Date.now();
  await c.query('commit');
  return { role, connectMs, polls, sawAt, startAt: start, gotAt, waitMs: gotAt - start };
}

// c (third part). Stale answers: client P asks pg_locks the same question before, while and after client A holds the lock,
// with the same text, with other text, inside a transaction, and as a simple query. Caching is off on both configs, so every
// answer must follow the lock.
async function caseCache(s: Session) {
  const key = randomKey();
  const [p, a] = await Promise.all([s.open(), s.open()]);
  const Q = "select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = $1::int::oid and objid = $2::int::oid and objsubid = 2 and granted";
  const count = async (text: string) => (await one<{ n: number }>(p.client, text, [LOCK_CLASS, key])).n;
  const simple = async () => (await one<{ n: number }>(p.client, Q.replace('$1', String(LOCK_CLASS)).replace('$2', String(key)))).n;
  const inTx = async () => {
    await p.client.query(START.read);
    const n = await count(Q);
    await p.client.query('commit');
    return n;
  };
  const before = { same: await count(Q), simple: await simple(), inTx: await inTx() };
  await a.client.query('begin');
  await a.client.query(LOCK, [LOCK_CLASS, key]);
  const aMine = (await pinOf(a.client, key)).mine;
  const held = { same: await count(Q), sameAgain: await count(Q), otherText: await count(`${Q} and true`), simple: await simple(), inTx: await inTx() };
  await a.client.query('commit');
  const after = { same: await count(Q), otherText: await count(`${Q} and 1 = 1`), simple: await simple(), inTx: await inTx() };
  const pass = aMine === 1 && Object.values(before).every((n) => n === 0) && Object.values(held).every((n) => n === 1) && Object.values(after).every((n) => n === 0);
  return { pass, key, aMine, before, held, after };
}

// d. A RAISE WARNING outside and inside a transaction: does the pg notice event fire, with which severity?
async function caseNotice(s: Session) {
  const { client: c, notices } = await s.open();
  await c.query("do $$ begin raise warning 'madar-probe'; end $$");
  const outside = notices.splice(0);
  await c.query(START.write);
  await c.query("do $$ begin raise warning 'madar-probe-in-tx'; end $$");
  const inside = notices.splice(0);
  await c.query('rollback');
  const pass = outside.some((n) => n.severity === 'WARNING' && n.message === 'madar-probe') &&
    inside.some((n) => n.severity === 'WARNING' && n.message === 'madar-probe-in-tx');
  return { pass, outside, inside };
}

// e. realtime.send as the save sends it, inside a write transaction that rolls back. A person topic passes the insert policy;
// the topic "probe:hyperdrive" fails it, so realtime.send gives the WARNING that the server counts as a failed signal.
async function caseRealtime(s: Session) {
  const { client: c, notices } = await s.open();
  const signals = (topic: string) => JSON.stringify([{ topic, payload: { channel: topic, seq: 0, probe: 'hyperdrive' } }]);
  const send = async (topic: string) => {
    await c.query(START.write);
    let error: unknown;
    let rows = 0;
    try {
      rows = (await c.query(SEND, [signals(topic), 'changed'])).rowCount ?? 0;
    } catch (e) {
      error = errorOf(e);
    }
    await c.query('rollback');
    const heard = notices.splice(0);
    return { topic, rows, error, notices: heard, failedSignals: heard.filter((n) => (n.message ?? '').startsWith(SEND_WARNING)).length };
  };
  const good = await send('person:probe-hyperdrive');
  const refused = await send('probe:hyperdrive');
  const pass = good.error === undefined && good.failedSignals === 0 && refused.error === undefined && refused.failedSignals === 1;
  return { pass, good, refused };
}

/** One 5-statement transaction, as a save: the joined start, the lock, two reads, the commit. */
async function fiveStatements(c: pg.Client) {
  const steps: number[] = [];
  const step = async (text: string, values?: unknown[]) => {
    const t = Date.now();
    await c.query(text, values);
    steps.push(Date.now() - t);
  };
  const t0 = Date.now();
  await step(START.write);
  await step(LOCK, [LOCK_CLASS, randomKey()]);
  await step('select $1::int + 1 as n', [1]);
  await step('select now() as t');
  await step('commit');
  return { txMs: Date.now() - t0, stepMs: steps };
}

// f. A new connect, 20 sequential "select 1" on one client, and one 5-statement transaction.
async function caseTiming(s: Session) {
  const { client: c, connectMs } = await s.open();
  const selects: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const t = Date.now();
    await c.query('select 1');
    selects.push(Date.now() - t);
  }
  return { connectMs, select1: { medianMs: median(selects), maxMs: Math.max(...selects), all: selects }, tx5: await fiveStatements(c) };
}

// h. The request of the end-to-end time: a connect and one 5-statement transaction.
async function caseTx5(s: Session) {
  const { client: c, connectMs } = await s.open();
  return { connectMs, ...(await fiveStatements(c)) };
}

const CASES: Record<string, (s: Session, url: URL) => Promise<unknown>> = {
  param: caseParam,
  start: caseStart,
  lock: caseLock,
  lockpart: caseLockPart,
  cache: caseCache,
  notice: caseNotice,
  realtime: caseRealtime,
  timing: caseTiming,
  tx5: caseTx5,
};

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (!env.PROBE_SECRET) return answer({ error: 'PROBE_SECRET is not set' }, 503);
    if (!sameSecret(request.headers.get('x-probe-secret'), env.PROBE_SECRET)) return answer({ error: 'forbidden' }, 403);
    isolate ??= crypto.randomUUID();
    const url = new URL(request.url);
    const name = url.pathname.replace(/^\/+/, '');
    const where = {
      colo: (request as Request & { cf?: { colo?: string } }).cf?.colo,
      cfPlacement: request.headers.get('cf-placement'),
      isolate,
    };
    if (name === 'whoami') {
      // request.cf.colo names the data center where the request came in, also for a placed Worker. A subrequest leaves from
      // the data center where the code runs, so the colo of /cdn-cgi/trace names the run location.
      let runColo: string | undefined;
      try {
        const trace = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text();
        runColo = trace.match(/^colo=(\w+)$/m)?.[1];
      } catch (e) {
        runColo = `error: ${errorOf(e).message}`;
      }
      return answer({ case: name, ...where, runColo });
    }
    const work = CASES[name];
    if (!work) return answer({ error: `no case ${name}` }, 404);
    const db = url.searchParams.get('db');
    if (db !== 'session' && db !== 'tx') return answer({ error: 'needs db=session|tx' }, 400);
    const session = new Session(db === 'session' ? env.DB_SESSION : env.DB_TX);
    const long = url.searchParams.get('wait') === 'long';
    if (long) session.queryTimeoutMs = 25_000;
    const caseTimeoutMs = long ? 28_000 : CASE_TIMEOUT_MS;
    const t0 = Date.now();
    let result: unknown;
    let error: unknown;
    let timedOut = false;
    try {
      result = await Promise.race([
        work(session, url),
        sleep(caseTimeoutMs).then(() => {
          timedOut = true;
          throw new Error(`timeout after ${caseTimeoutMs} ms`);
        }),
      ]);
    } catch (e) {
      error = errorOf(e);
    }
    const pending = error === undefined ? undefined : session.pending();
    ctx.waitUntil(session.end());
    return answer({ case: name, db, ...where, ms: Date.now() - t0, timedOut, result, error, pending });
  },
};
