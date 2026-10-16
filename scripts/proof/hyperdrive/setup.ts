// Makes the two Hyperdrive configs of the probe on madar-test, through the Cloudflare API (proof.md, "Hyperdrive probe on
// madar-test (2026-10-16)"). A second run makes no copy: it lists the configs first and keeps the ones that exist.
//   node --import tsx scripts/proof/hyperdrive/setup.ts [require]     (the sandbox must be off: it calls the Cloudflare API)
// The bearer is the wrangler OAuth token (npx wrangler whoami refreshes it). The password comes from DATABASE_URL of
// secrets/test.env, stays in memory, and never reaches the output. "require" is the recorded fallback only: it asks
// sslmode require with no CA, and only when verify-full failed.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ACCOUNT_ID, CA_NAME, CONFIGS, configBody, envValue, originOf, redact, summary, type SslMode } from './lib.ts';

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;

function wranglerToken(): string {
  const text = readFileSync(join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  const token = text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error('oauth_token is missing in the wrangler config: run npx wrangler whoami first.');
  return token;
}

function databaseUrl(): string {
  const value = envValue(readFileSync(new URL('../../../secrets/test.env', import.meta.url), 'utf8'), 'DATABASE_URL');
  if (!value) throw new Error('DATABASE_URL is missing in secrets/test.env.');
  return value;
}

type ApiAnswer<T> = { status: number; success: boolean; errors: { code: number; message: string }[]; result: T };

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<ApiAnswer<T>> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = (await res.json()) as Omit<ApiAnswer<T>, 'status'>;
  return { status: res.status, ...body };
}

async function main() {
  const sslmode: SslMode = process.argv[2] === 'require' ? 'require' : 'verify-full';
  const token = wranglerToken();
  const url = databaseUrl();
  const secrets = [token, url, decodeURIComponent(new URL(url).password)];
  const print = (data: unknown) => console.log(redact(JSON.stringify(data, null, 2), secrets));

  const cas = await api<{ id: string; name: string; ca: boolean }[]>(token, '/mtls_certificates');
  const ca = cas.result?.find((c) => c.name === CA_NAME && c.ca);
  if (!ca) {
    print({ step: 'ca', ok: false, status: cas.status, errors: cas.errors, note: `no CA named ${CA_NAME}: upload it with wrangler cert upload` });
    process.exitCode = 1;
    return;
  }

  const list = await api<{ id: string; name: string }[]>(token, '/hyperdrive/configs');
  if (!list.success) {
    print({ step: 'list', ok: false, status: list.status, errors: list.errors });
    process.exitCode = 1;
    return;
  }
  const out: unknown[] = [];
  for (const config of CONFIGS) {
    const found = list.result.find((c) => c.name === config.name);
    if (found) {
      const got = await api<Parameters<typeof summary>[0]>(token, `/hyperdrive/configs/${found.id}`);
      out.push({ made: false, ...summary(got.result) });
      continue;
    }
    const body = configBody(config.name, originOf(url, config.port), ca.id, sslmode);
    const made = await api<Parameters<typeof summary>[0]>(token, '/hyperdrive/configs', { method: 'POST', body: JSON.stringify(body) });
    out.push(made.success
      ? { made: true, ...summary(made.result) }
      : { name: config.name, made: false, ok: false, status: made.status, errors: made.errors, sslmode });
  }
  print({ step: 'configs', caName: CA_NAME, caId: ca.id, sslmodeAsked: sslmode, configs: out });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
