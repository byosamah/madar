import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The Cloudflare parts of the deploy scripts (owner, 2026-10-16): scripts/deploy/secrets.ts (the Worker secrets and the Hyperdrive
 * password) and scripts/deploy/cloudflare-setup.ts (the CA, the Hyperdrive config, the R2 bucket, the Pages binding).
 * Every function prints names and ids only, never a secret. Error texts name the step, never a value.
 */

/** The Madar Cloudflare account (accounts.md). Not a secret. */
export const ACCOUNT_ID = 'd76d34779c63849f5acdf3d6af3751cd';
export const POOLER_HOST = 'aws-1-eu-central-1.pooler.supabase.com';
/** The session pooler: the origin of every Hyperdrive config (proof.md, Hyperdrive probe: the transaction pooler hangs). */
export const SESSION_POOLER_PORT = 5432;
export const CA_NAME = 'supabase-root-2021-ca';

/**
 * The bearer of the Cloudflare API: CLOUDFLARE_API_TOKEN when the shell has one, else the OAuth token of the wrangler sign-in
 * (`npx wrangler whoami` refreshes it). It stays in memory.
 */
export function cloudflareToken(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  if (env.CLOUDFLARE_API_TOKEN) return env.CLOUDFLARE_API_TOKEN;
  let text = '';
  try {
    text = readFileSync(join(home, 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  } catch {
    // No wrangler sign-in on this Mac.
  }
  const token = /^oauth_token\s*=\s*"([^"]+)"/m.exec(text)?.[1];
  if (!token) throw new Error('No Cloudflare token: run npx wrangler login (or npx wrangler whoami to refresh it), or set CLOUDFLARE_API_TOKEN.');
  return token;
}

export type CloudflareAnswer<T> = { status: number; success: boolean; errors: { code: number; message: string }[]; result: T };
export type CloudflareInit = { method?: string; body?: unknown; headers?: Record<string, string> };
export type CloudflareApi = <T>(path: string, init?: CloudflareInit) => Promise<CloudflareAnswer<T>>;

/** The account API: path is under /accounts/<id>. A body that is not JSON gives success false with the HTTP status. */
export function cloudflareApi(token: string, fetcher: typeof fetch = fetch): CloudflareApi {
  return async <T>(path: string, init: CloudflareInit = {}) => {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    let body: Partial<CloudflareAnswer<T>> = {};
    try {
      body = (await response.json()) as Partial<CloudflareAnswer<T>>;
    } catch {
      // Not JSON: the status says what happened.
    }
    return { status: response.status, success: body.success === true && response.ok, errors: body.errors ?? [], result: body.result as T };
  };
}

/** The error codes of a refused call, for an error text. Cloudflare error messages name no secret value. */
export function codesOf(answer: CloudflareAnswer<unknown>): string {
  return answer.errors.length > 0 ? answer.errors.map((e) => `${e.code} ${e.message}`).join('; ') : `HTTP ${answer.status}`;
}

/** The origin of a Hyperdrive config for madar_server of one project, on the session pooler. */
export type HyperdriveOrigin = { scheme: 'postgres'; host: string; port: number; database: string; user: string; password: string };

export function hyperdriveOrigin(ref: string, password: string): HyperdriveOrigin {
  if (password === '') throw new Error('The Hyperdrive origin needs the madar_server password (DATABASE_URL).');
  return { scheme: 'postgres', host: POOLER_HOST, port: SESSION_POOLER_PORT, database: 'postgres', user: `madar_server.${ref}`, password };
}

/** The text with each secret value, and its URL-encoded form, replaced, so an output line can be shown. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets.filter((s) => s.length >= 4)) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) out = out.split(form).join('[redacted]');
  }
  return out;
}

/**
 * Runs a command with the given text on its stdin, never in its arguments or in a file. It gives the exit code and the output
 * (stdout and stderr together). The caller decides what to show, after redact().
 */
export function runWithStdin(command: string, args: string[], input: string, o: { cwd?: string; env?: Record<string, string | undefined> } = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv | undefined, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
    child.stdin.end(input);
  });
}
