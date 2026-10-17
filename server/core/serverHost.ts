import setting from '../../config/server-host.json' with { type: 'json' };

/**
 * The host of the server of each copy (owner, 2026-10-16): the Supabase Edge Functions or one Cloudflare Worker for each copy.
 * The database, Supabase Auth and Supabase Realtime stay on Supabase either way, and the Supabase functions stay deployed as
 * the way back.
 *
 * config/server-host.json holds one word for each copy: "supabase", "workers", or "office" (the office object of the copy, Supabase
 * exit; the test copy only until wave 6, OFFICE_COPIES_OPEN). It is in git, so a switch goes through the
 * release flow (scripts/deploy/CLAUDE.md). The word only picks one of the two fixed targets below, so no step ever takes a
 * free address. Every place that must follow the switch reads it here:
 *   - scripts/build-remote.ts: the API address of the screens (VITE_API_URL),
 *   - server/http/pagesApiProxy.ts and server/http/pagesMcpProxy.ts: where the Pages Functions send /api and /mcp,
 *   - server/core/deps.ts: the calls limit of the Usage page (server/usage/meters.ts),
 *   - scripts/deploy/checks.sh (through scripts/deploy/serverHost.ts): which host must answer after a deploy.
 *
 * This file imports only the setting, so the Pages Functions, the server bundles and the scripts can all import it. Never import
 * it from src/api (the contract knows no host).
 */

export const COPIES = ['test', 'production'] as const;
export type Copy = (typeof COPIES)[number];
export const SERVER_HOSTS = ['supabase', 'workers', 'office'] as const;
export type ServerHost = (typeof SERVER_HOSTS)[number];
export type ServerHostSetting = Readonly<Record<Copy, ServerHost>>;

/**
 * The copies that may take the word office now (exit wave 4). Production takes it at the switch (wave 6 of the exit plan), in the
 * same commit that adds its office binding and its Cron; until then the setting refuses it.
 */
export const OFFICE_COPIES_OPEN: readonly Copy[] = ['test'];

/** True when the Worker of the copy serves its /api and /mcp: the Postgres path (workers) or the office object (office). */
export function onWorker(host: ServerHost): boolean {
  return host !== 'supabase';
}

export const PROJECT_REFS: Readonly<Record<Copy, string>> = { test: 'qdgwpnesxppnqsaabqzd', production: 'oprkvdjudjxxhvodkzgs' };

/** The page hosts of the Pages project madar, each with its copy. Any other host (a deployment hash, a stranger) is no copy. */
export const PAGE_HOSTS: Readonly<Record<string, Copy>> = {
  'madar.vado.sa': 'production',
  'www.madar.vado.sa': 'production',
  'madar-46r.pages.dev': 'production',
  'preview.madar-46r.pages.dev': 'test',
};

export type CopyHosts = {
  /** The Supabase project: the database, Auth, Realtime and (today) Storage. */
  supabaseUrl: string;
  /** The Supabase functions: the host until the switch, and the way back after it. The jobs stay there in both cases. */
  supabase: { api: string; mcp: string };
  /** The Worker of the copy (wrangler.server.toml, [env.<copy>]), the Pages service binding that reaches it, its Hyperdrive config. */
  workers: { name: string; binding: string; hyperdrive: string };
  /** The main page address of the copy. */
  page: string;
};

function copyHosts(copy: Copy, binding: string, page: string): CopyHosts {
  const supabaseUrl = `https://${PROJECT_REFS[copy]}.supabase.co`;
  return {
    supabaseUrl,
    supabase: { api: `${supabaseUrl}/functions/v1/api`, mcp: `${supabaseUrl}/functions/v1/mcp` },
    workers: { name: `madar-server-${copy}`, binding, hyperdrive: `madar-db-${copy}` },
    page,
  };
}

export const COPY_HOSTS: Readonly<Record<Copy, CopyHosts>> = {
  test: copyHosts('test', 'MADAR_SERVER_TEST', 'https://preview.madar-46r.pages.dev'),
  production: copyHosts('production', 'MADAR_SERVER_PRODUCTION', 'https://madar.vado.sa'),
};

/**
 * The setting, checked: exactly the two copies, each with one of the three words, and office only for a copy of OFFICE_COPIES_OPEN.
 * The error names the key, never a free value.
 */
export function parseServerHostSetting(value: unknown): ServerHostSetting {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('config/server-host.json must hold one JSON object.');
  const given = value as Record<string, unknown>;
  for (const key of Object.keys(given)) {
    if (!(COPIES as readonly string[]).includes(key)) throw new Error(`config/server-host.json holds ${key}: only test and production are copies.`);
  }
  const out = {} as Record<Copy, ServerHost>;
  for (const copy of COPIES) {
    const word = given[copy];
    if (!(SERVER_HOSTS as readonly unknown[]).includes(word)) throw new Error(`config/server-host.json: ${copy} must be supabase, workers or office.`);
    out[copy] = word as ServerHost;
    if (word === 'office' && !OFFICE_COPIES_OPEN.includes(copy)) {
      throw new Error(`config/server-host.json: ${copy} takes office only at the switch (wave 6 of the exit plan). Keep supabase or workers until then.`);
    }
  }
  return out;
}

export const SERVER_HOST_SETTING: ServerHostSetting = parseServerHostSetting(setting);

export function serverHostOf(copy: Copy, s: ServerHostSetting = SERVER_HOST_SETTING): ServerHost {
  return s[copy];
}

/** The copy of a page host, or undefined for any other host. */
export function copyOfPageHost(hostname: string): Copy | undefined {
  return Object.hasOwn(PAGE_HOSTS, hostname) ? PAGE_HOSTS[hostname] : undefined;
}

/** The copy of a Supabase project URL (SUPABASE_URL of the server), or undefined for a local or other URL. */
export function copyOfSupabaseUrl(url: string): Copy | undefined {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return undefined;
  }
  return COPIES.find((copy) => COPY_HOSTS[copy].supabaseUrl === origin);
}

/**
 * The API address of the screens of a copy (VITE_API_URL). On the Worker (workers or office) it is the page's own /api: a Pages Function hands each
 * call to the Worker through a service binding (server/http/pagesApiProxy.ts), so the browser makes no cross-site call and never
 * sees a workers.dev address. On Supabase it is the api function.
 */
export function screensApiUrl(copy: Copy, host: ServerHost = serverHostOf(copy)): string {
  return onWorker(host) ? '/api' : COPY_HOSTS[copy].supabase.api;
}
