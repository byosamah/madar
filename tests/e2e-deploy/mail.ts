import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { databaseTarget } from './targets';

/**
 * The mail of the test deployment (task X2). There the server runs with MAIL_DRIVER=outbox and writes each mail to the table
 * mail_outbox instead of sending it (server/mail/outboxDriver.ts), so the specs read the invitation and reset links from it.
 *
 * MADAR_E2E_DATABASE_URL is the database to read: the session pooler of madar-test as postgres, for a run on the deployment.
 * Without it, the specs read the local database of the local stack; a run on the deployment without it stops. A hosted database
 * needs TLS with the Supabase root CA. targets.ts refuses every database but madar-test and the local stack.
 */
const CA_FILE = join(import.meta.dirname, '..', '..', 'scripts', 'proof', 'supabase-root-2021-ca.crt');

export type OutboxMail = { id: number; to: string; tag: string; subject: string; text: string; html: string; createdAt: string };

/**
 * The path and query of the link to a screen (/welcome or /reset) in a mail text, for goto on the run's own host. The link must
 * go to `origin`, the app of the run (appOrigin in targets.ts): a token that a mail sends to another origin lets that origin take
 * the account.
 */
export function linkPath(text: string, screen: 'welcome' | 'reset', origin: string): string {
  for (const found of text.match(/https?:\/\/\S+/g) ?? []) {
    const url = new URL(found);
    if (url.pathname !== `/${screen}`) continue;
    if (url.origin !== origin) throw new Error(`The /${screen} link of the mail goes to ${url.origin}, not to ${origin}.`);
    return `${url.pathname}${url.search}`;
  }
  throw new Error(`The mail has no link to /${screen}.`);
}

/** One connection to the database of the run (databaseTarget), for the work given. The walk reads its checks through it too. */
export async function withClient<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
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
