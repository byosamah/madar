// Pooler probes of the performance audit (2026-10-07, SRV-3 and SRV-9). Runs on madar-test only, never production.
//   set -a; . <path>/.env.local; set +a        (MADAR_TEST_DB_PASSWORD; the sandbox must be off for a direct Postgres connection)
//   npx tsx scripts/proof/pooler.ts <step>      steps: idle start
// idle:  a transaction-pooler connection (port 6543) with the root CA and TCP keepalive stays usable after 60 s and 120 s idle.
//        A pg.Pool with the settings of server/data/sql.ts (max 1, idleTimeoutMillis 120000, keepAlive) keeps one connection.
// start: the joined start query ("begin ...; set local ...") gives the right settings inside the transaction and none after it.
// Each step prints a JSON report with every secret redacted. docs/superpowers/real-build/proof.md records the results.
import pg from 'pg';
import { REF, ROOT_CA, need, report, sleep } from './cloud.ts';
import { poolerConfig } from './lib.ts';

const LOCK_TIMEOUT = "set local lock_timeout = '5s'";
const STATEMENT_TIMEOUT = "set local statement_timeout = '10s'";
const BEGIN = { read: 'begin isolation level repeatable read, read only', write: 'begin' } as const;
const SETTINGS =
  "select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock, current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as read_only";

/** The transaction pooler as the server connects to it: the root CA and the host name, as postgres (the madar-test password). */
function config(): pg.ClientConfig {
  return { ...poolerConfig({ ref: REF, role: 'postgres', password: need('MADAR_TEST_DB_PASSWORD'), mode: 'transaction', ca: ROOT_CA }), connectionTimeoutMillis: 10000 };
}

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const start = performance.now();
  try {
    const value = await work();
    return { ms: Math.round(performance.now() - start), value };
  } catch (error) {
    return { ms: Math.round(performance.now() - start), error: error instanceof Error ? error.message : String(error) };
  }
}

/** One plain client with keepalive, idle 60 s and then 120 s; and one pool with the server settings, idle 60 s and then 125 s. */
async function idle() {
  const client = new pg.Client({ ...config(), keepAlive: true });
  let clientErrors = 0;
  client.on('error', () => void (clientErrors += 1));
  await client.connect();
  const pool = new pg.Pool({ ...config(), max: 1, idleTimeoutMillis: 120_000, keepAlive: true });
  let connects = 0;
  let removes = 0;
  pool.on('connect', () => void (connects += 1));
  pool.on('remove', () => void (removes += 1));
  pool.on('error', () => undefined);
  const select = (c: { query(text: string): Promise<pg.QueryResult> }) => c.query('select 1 as one').then((r) => r.rows[0].one as number);

  const clientRun = (async () => {
    const first = await timed(() => select(client));
    await sleep(60_000);
    const after60 = await timed(() => select(client));
    await sleep(120_000);
    const after180 = await timed(() => select(client));
    await client.end().catch(() => undefined);
    return { first, afterIdle60s: after60, afterIdle120sMore: after180, clientErrors };
  })();
  const poolRun = (async () => {
    const first = await timed(() => select(pool));
    await sleep(60_000);
    const after60 = await timed(() => select(pool));
    const connectsAfter60 = connects;
    await sleep(125_000);
    const removesAfter125 = removes;
    const after125 = await timed(() => select(pool));
    const result = { first, afterIdle60s: after60, connectsAfterIdle60s: connectsAfter60, removesAfterIdle125s: removesAfter125, afterIdle125s: after125, connects };
    await pool.end().catch(() => undefined);
    return result;
  })();
  const [plain, pooled] = await Promise.all([clientRun, poolRun]);
  report('idle', {
    plainClientKeepAlive: plain,
    poolMax1Idle120sKeepAlive: pooled,
    expect: 'every select gives 1 within 1 s; the pool keeps 1 connection after 60 s idle and replaces it after 125 s idle',
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The joined start against the separate statements: the settings inside, the settings after, and the time of each form. */
async function start() {
  const client = new pg.Client(config());
  await client.connect();
  try {
    const outside = (await client.query(SETTINGS)).rows[0];
    await client.query(`${BEGIN.read}; ${STATEMENT_TIMEOUT}`);
    const insideRead = (await client.query(SETTINGS)).rows[0];
    await client.query('commit');
    const afterReadCommit = (await client.query(SETTINGS)).rows[0];
    await client.query(`${BEGIN.write}; ${LOCK_TIMEOUT}; ${STATEMENT_TIMEOUT}`);
    const insideWrite = (await client.query(SETTINGS)).rows[0];
    await client.query('rollback');
    const afterWriteRollback = (await client.query(SETTINGS)).rows[0];
    await client.query(`${BEGIN.write}; ${LOCK_TIMEOUT}; ${STATEMENT_TIMEOUT}`);
    await client.query('commit');
    const afterWriteCommit = (await client.query(SETTINGS)).rows[0];
    // A failed joined start rolls back as today: a bad statement in the joined text leaves no open transaction.
    const badStart = await timed(() => client.query(`${BEGIN.write}; set local lock_timeout = 'not a time'; ${STATEMENT_TIMEOUT}`));
    const rolledBack = await timed(() => client.query('rollback'));
    const afterBadStart = (await client.query(SETTINGS)).rows[0];

    const joined: number[] = [];
    const separate: number[] = [];
    for (let i = 0; i < 20; i++) {
      let t = performance.now();
      await client.query(`${BEGIN.write}; ${LOCK_TIMEOUT}; ${STATEMENT_TIMEOUT}`);
      joined.push(performance.now() - t);
      await client.query('commit');
      t = performance.now();
      await client.query(BEGIN.write);
      await client.query(LOCK_TIMEOUT);
      await client.query(STATEMENT_TIMEOUT);
      separate.push(performance.now() - t);
      await client.query('commit');
    }
    report('start', {
      outside, insideRead, afterReadCommit, insideWrite, afterWriteRollback, afterWriteCommit,
      badStart: { error: badStart.error ?? 'none' }, rollbackAfterBadStart: { error: rolledBack.error ?? 'none' }, afterBadStart,
      writeStartMs: { joinedMedian: Math.round(median(joined) * 10) / 10, separateMedian: Math.round(median(separate) * 10) / 10, samples: 20 },
      expect: 'inside: statement 10s (and lock 5s in a write), repeatable read and read only on in a read; after: the outside values',
    });
  } finally {
    await client.end().catch(() => undefined);
  }
}

const steps: Record<string, () => Promise<void>> = { idle, start };
const step = process.argv[2] ?? '';
if (!steps[step]) {
  console.error(`Usage: npx tsx scripts/proof/pooler.ts <${Object.keys(steps).join('|')}>`);
  process.exit(2);
}
await steps[step]();
