// Network helpers for the Z0a probes. Every connection goes to madar-test only (lib.ts refuses any other ref).
// Secrets come from the environment (set -a; . ~/dev/madar/.env.local; set +a) and never reach the output: report() redacts them.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { TEST_REF, poolerConfig, randomToken, redact } from './lib.ts';

export const REF = TEST_REF;
export const SUPABASE_URL = `https://${REF}.supabase.co`;
export const PROBE_FUNCTION = 'z0a-probe';
/** The public Supabase Root 2021 CA (Database settings, SSL certificate). It signs the pooler certificate. */
export const ROOT_CA = readFileSync(new URL('./supabase-root-2021-ca.crt', import.meta.url), 'utf8');

export function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing: load ~/dev/madar/.env.local first`);
  return value;
}

/** Run state that must outlive one step (the probe token, the madar_server password). Kept outside the repo, mode 600. */
const STATE_DIR = process.env.Z0A_STATE_DIR ?? join(tmpdir(), 'madar-z0a');

export function stateValue(name: string, make = true): string {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const file = join(STATE_DIR, name);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  if (!make) throw new Error(`no ${name} in ${STATE_DIR}`);
  const value = randomToken();
  writeFileSync(file, value, { mode: 0o600 });
  return value;
}

export function stateDir(): string {
  return STATE_DIR;
}

function secrets(): string[] {
  const out = [process.env.SUPABASE_ACCESS_TOKEN, process.env.MADAR_TEST_DB_PASSWORD, process.env.MADAR_DB_PASSWORD, process.env.RESEND_API_KEY];
  for (const name of ['probe-token', 'server-password', 'user-password']) {
    try {
      out.push(stateValue(name, false));
    } catch {
      // not made yet
    }
  }
  return out.filter((v): v is string => Boolean(v));
}

export function report(step: string, data: unknown): void {
  console.log(redact(JSON.stringify({ step, ...(data as object) }, null, 2), secrets()));
}

/** The Supabase Management API for madar-test. */
export async function mgmt(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${need('SUPABASE_ACCESS_TOKEN')}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // plain text
  }
  return { status: res.status, body };
}

/** postgres through the session pooler, with the root CA: the only path for admin SQL on madar-test. */
export async function adminClient(): Promise<pg.Client> {
  const client = new pg.Client(poolerConfig({ ref: REF, role: 'postgres', password: need('MADAR_TEST_DB_PASSWORD'), mode: 'session', ca: ROOT_CA }));
  await client.connect();
  return client;
}

/** madar_server through the transaction pooler, as the real server connects (plan 4.5). */
export function serverClient(password: string, ca: string | false = ROOT_CA): pg.Client {
  return new pg.Client({ ...poolerConfig({ ref: REF, role: 'madar_server', password, mode: 'transaction', ca }), connectionTimeoutMillis: 10000 });
}

/** Calls a route of the probe Edge Function. */
export async function probe(route: string, body?: unknown, query = ''): Promise<{ status: number; headers: Headers; body: any }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${PROBE_FUNCTION}/${route}${query}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-probe-token': stateValue('probe-token', false), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // plain text
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
