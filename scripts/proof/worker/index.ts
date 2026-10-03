// Z0a portability probe: a Hono app on the Workers runtime (workerd, through "wrangler dev") that connects with pg
// to the madar-test transaction pooler as madar_server and holds pg_advisory_xact_lock. One result for each TLS setting.
import { Hono } from 'hono';
import pg from 'pg';
import { connect } from 'cloudflare:sockets';
import ca from '../supabase-root-2021-ca.crt';

type Env = { PG_PASSWORD: string; PG_USER: string; PG_HOST: string; DB?: { connectionString: string } };

const app = new Hono<{ Bindings: Env }>();

async function tryMode(env: Env, ssl: pg.ClientConfig['ssl']) {
  const client = new pg.Client({ host: env.PG_HOST, port: 6543, user: env.PG_USER, password: env.PG_PASSWORD, database: 'postgres', ssl, connectionTimeoutMillis: 10000 });
  const t0 = Date.now();
  try {
    await client.connect();
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock($1)', [7310001]);
    const row = (await client.query('select current_user')).rows[0];
    await client.query('commit');
    return { ok: true, user: row.current_user, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e), ms: Date.now() - t0 };
  } finally {
    await client.end().catch(() => undefined);
  }
}

app.get('/probe', async (c) => {
  const env = c.env;
  return c.json({
    runtime: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    caIn_ssl: await tryMode(env, { ca, rejectUnauthorized: true, servername: env.PG_HOST }),
    sslTrue: await tryMode(env, true),
    noVerify: await tryMode(env, { rejectUnauthorized: false }),
    noTls: await tryMode(env, false),
  });
});

/** The raw TLS step without pg: the Postgres SSLRequest, then startTls. A public site is the control. */
async function rawTls(hostname: string, port: number, postgres: boolean, tlsOptions?: Record<string, unknown>, user = '') {
  try {
    if (!postgres) {
      const socket = connect({ hostname, port }, { secureTransport: 'on' });
      await socket.opened;
      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(`HEAD / HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`));
      const { value } = await socket.readable.getReader().read();
      await socket.close();
      return { ok: true, firstLine: new TextDecoder().decode(value).split('\r\n')[0] };
    }
    const socket = connect({ hostname, port }, { secureTransport: 'starttls' });
    await socket.opened;
    const writer = socket.writable.getWriter();
    await writer.write(new Uint8Array([0, 0, 0, 8, 4, 210, 22, 47]));
    const reader = socket.readable.getReader();
    const { value } = await reader.read();
    const answer = String.fromCharCode(value?.[0] ?? 0);
    writer.releaseLock();
    reader.releaseLock();
    const tls = socket.startTls((tlsOptions ?? { expectedServerHostname: hostname }) as { expectedServerHostname?: string });
    await tls.opened;
    // A StartupMessage over TLS: the first real bytes show whether the handshake passed.
    const params = new TextEncoder().encode(`user\0${user}\0database\0postgres\0\0`);
    const startup = new Uint8Array(8 + params.length);
    new DataView(startup.buffer).setInt32(0, startup.length);
    new DataView(startup.buffer).setInt32(4, 196608);
    startup.set(params, 8);
    const tlsWriter = tls.writable.getWriter();
    await tlsWriter.write(startup);
    const reply = await tls.readable.getReader().read();
    await tls.close();
    return { ok: true, sslRequestAnswer: answer, firstMessageOverTls: String.fromCharCode(reply.value?.[0] ?? 0) };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

app.get('/hyperdrive', async (c) => {
  if (!c.env.DB) return c.json({ ok: false, error: 'no DB binding' });
  const client = new pg.Client({ connectionString: c.env.DB.connectionString, connectionTimeoutMillis: 10000 });
  const t0 = Date.now();
  try {
    await client.connect();
    await client.query('begin');
    await client.query(`set local lock_timeout = '2s'`);
    await client.query('select pg_advisory_xact_lock($1)', [7310001]);
    const row = (await client.query(`select current_user, current_setting('lock_timeout') lt`)).rows[0];
    await client.query('commit');
    return c.json({ ok: true, user: row.current_user, lockTimeoutInTx: row.lt, ms: Date.now() - t0 });
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message ?? e), ms: Date.now() - t0 });
  } finally {
    await client.end().catch(() => undefined);
  }
});

app.get('/tls', async (c) => c.json({
  pooler: await rawTls(c.env.PG_HOST, 6543, true, undefined, c.env.PG_USER),
  poolerWithPgOptions: await rawTls(c.env.PG_HOST, 6543, true, { host: c.env.PG_HOST, servername: c.env.PG_HOST, ca, rejectUnauthorized: true }, c.env.PG_USER),
  publicSiteControl: await rawTls('www.cloudflare.com', 443, false),
}));

export default app;
