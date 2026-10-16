// The control of the Hyperdrive probe (proof.md, "Hyperdrive probe on madar-test (2026-10-16)"): the same statements through the
// transaction pooler straight from the Mac, with no Hyperdrive, as the server on Supabase Edge Functions connects today.
//   node --import tsx scripts/proof/hyperdrive/control.ts        (the sandbox must be off for a direct Postgres connection)
// It reads DATABASE_URL of secrets/test.env in memory, refuses any project but madar-test, and prints no secret.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { envValue, originOf } from './lib.ts';

const SEND = `select realtime.send(s.item->'payload', $2::text, s.item->>'topic', true)
  from jsonb_array_elements($1::jsonb) with ordinality as s(item, n)
  order by s.n`;

const url = envValue(readFileSync(new URL('../../../secrets/test.env', import.meta.url), 'utf8'), 'DATABASE_URL');
if (!url) throw new Error('DATABASE_URL is missing in secrets/test.env.');
const origin = originOf(url, 6543);
const ca = readFileSync(new URL('../../../config/supabase-root-2021-ca.crt', import.meta.url), 'utf8');
const client = new pg.Client({ ...origin, ssl: { ca, rejectUnauthorized: true, servername: origin.host }, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
const notices: { severity?: string; message?: string }[] = [];
client.on('notice', (n) => notices.push({ severity: n.severity, message: n.message }));
await client.connect();
const t0 = performance.now();
const n = (await client.query('select $1::int + 1 as n', [41])).rows[0].n as number;
const paramMs = Math.round(performance.now() - t0);
const partitions = (await client.query("select tablename from pg_tables where schemaname = 'realtime' and tablename like 'messages%' order by tablename")).rows.map((r) => r.tablename as string);
const today = (await client.query("select (now() at time zone 'utc')::date::text as d")).rows[0].d as string;
const send = async (topic: string) => {
  await client.query("begin; set local lock_timeout = '5s'; set local statement_timeout = '10s'");
  await client.query(SEND, [JSON.stringify([{ topic, payload: { channel: topic, seq: 0, probe: 'control' } }]), 'changed']);
  await client.query('rollback');
  return notices.splice(0);
};
const good = await send('person:probe-hyperdrive');
const refused = await send('probe:hyperdrive');
await client.end();
console.log(JSON.stringify({ path: 'transaction pooler straight from the Mac', param: { n, paramMs }, today, partitions, good, refused }, null, 1));
