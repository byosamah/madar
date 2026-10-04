import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * The mail of the test deployment (task X2). There the server runs with MAIL_DRIVER=outbox and writes each mail to the table
 * mail_outbox instead of sending it (server/mail/outboxDriver.ts), so the specs read the invitation and reset links from it.
 *
 * MADAR_E2E_DATABASE_URL is the database to read: the session pooler of madar-test as postgres, for a run on the deployment.
 * Without it, the specs read the local database of the local stack. A hosted database needs TLS with the Supabase root CA. The
 * production project is refused, so no run reads real mail.
 */
const LOCAL_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const PRODUCTION_REF = 'oprkvdjudjxxhvodkzgs';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const CA_FILE = join(import.meta.dirname, '..', '..', 'scripts', 'proof', 'supabase-root-2021-ca.crt');

export type DatabaseTarget = { url: string; tls: boolean };

export function databaseTarget(env: Record<string, string | undefined>): DatabaseTarget {
  const url = env.MADAR_E2E_DATABASE_URL ?? LOCAL_DATABASE_URL;
  if (url.includes(PRODUCTION_REF)) throw new Error('The browser checks never read the production database.');
  return { url, tls: !LOCAL_HOSTS.has(new URL(url).hostname) };
}

export type OutboxMail = { id: number; to: string; tag: string; subject: string; text: string; html: string; createdAt: string };

/** The path and query of the link to a screen (/welcome or /reset) in a mail text, for goto on the run's own host. */
export function linkPath(text: string, screen: 'welcome' | 'reset'): string {
  for (const found of text.match(/https?:\/\/\S+/g) ?? []) {
    const url = new URL(found);
    if (url.pathname === `/${screen}`) return `${url.pathname}${url.search}`;
  }
  throw new Error(`The mail has no link to /${screen}.`);
}

async function withClient<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const target = databaseTarget(process.env);
  const client = new pg.Client({
    connectionString: target.url,
    ...(target.tls ? { ssl: { ca: readFileSync(CA_FILE, 'utf8'), rejectUnauthorized: true } } : {}),
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** The id of the newest mail now, so a spec waits only for the mail that its own step makes. */
export async function lastMailId(): Promise<number> {
  return withClient(async (client) => Number((await client.query<{ id: string | null }>('select max(id)::text as id from mail_outbox')).rows[0].id ?? 0));
}

/** Waits for the first mail to `to` with this tag after the mail `after`. */
export async function waitForMail(o: { to: string; tag: string; after: number; timeoutMs?: number }): Promise<OutboxMail> {
  const until = Date.now() + (o.timeoutMs ?? 30_000);
  while (Date.now() < until) {
    const row = await withClient(async (client) => (await client.query<{ id: string; to_email: string; tag: string; mail: { subject: string; text: string; html: string }; created_at: Date }>(
      'select id::text, to_email, tag, mail, created_at from mail_outbox where id > $1 and lower(to_email) = lower($2) and tag = $3 order by id limit 1',
      [o.after, o.to, o.tag],
    )).rows[0]);
    if (row) return { id: Number(row.id), to: row.to_email, tag: row.tag, subject: row.mail.subject, text: row.mail.text, html: row.mail.html, createdAt: row.created_at.toISOString() };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No ${o.tag} mail to ${o.to} reached mail_outbox in time.`);
}
