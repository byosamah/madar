import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePublicEnv } from '../build-remote.ts';

/**
 * dist/_headers of the real screens from config/headers.template (plan 5.9). scripts/deploy/pages.sh runs it after the remote build:
 *   node scripts/deploy/headers.ts <test|production> <out file>
 * The Supabase host comes from config/remote.<env>.env. The file store comes from MADAR_FILE_STORE (the environment first, then
 * secrets/<env>.env, else supabase), so the headers follow the same one setting as the server (plan 2b, point 1).
 */

export type FileStore = 'supabase' | 'r2';
export type HeaderHosts = { supabaseUrl: string; store: FileStore; r2AccountId?: string };

/** The origin of a hosted Supabase project. A local or other host never goes into the headers of a deployment. */
export function supabaseOrigin(url: string): string {
  const origin = url.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(origin)) throw new Error(`VITE_SUPABASE_URL must be https://<ref>.supabase.co, not "${origin}".`);
  return origin;
}

/** The host of the signed file links: Supabase Storage (proof Z0a, item 6) or the R2 EU endpoint. */
export function filesOrigin(hosts: HeaderHosts): string {
  if (hosts.store === 'supabase') return supabaseOrigin(hosts.supabaseUrl);
  if (hosts.store === 'r2') {
    if (!/^[0-9a-f]{32}$/.test(hosts.r2AccountId ?? '')) throw new Error('R2_ACCOUNT_ID must be the 32 hex characters of the Cloudflare account while MADAR_FILE_STORE is r2.');
    return `https://${hosts.r2AccountId}.eu.r2.cloudflarestorage.com`;
  }
  throw new Error(`MADAR_FILE_STORE must be supabase or r2, not "${String(hosts.store)}".`);
}

/** The template with its comments dropped and its placeholders filled. A source that comes twice in one CSP directive stays once. */
export function renderHeaders(template: string, hosts: HeaderHosts): string {
  const supabase = supabaseOrigin(hosts.supabaseUrl);
  const values: Record<string, string> = {
    SUPABASE: supabase,
    SUPABASE_WSS: supabase.replace(/^https:/, 'wss:'),
    FILES: filesOrigin(hosts),
  };
  const lines = template
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .map((line) =>
      line.replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => {
        if (!(name in values)) throw new Error(`config/headers.template has the unknown placeholder {{${name}}}.`);
        return values[name];
      }),
    )
    .map((line) => {
      const csp = /^(\s*Content-Security-Policy: )(.*)$/.exec(line);
      if (!csp) return line;
      const directives = csp[2].split(';').map((part) => [...new Set(part.trim().split(/\s+/))].join(' '));
      return csp[1] + directives.join('; ');
    });
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  const text = `${lines.join('\n').trimEnd()}\n`;
  for (const line of text.split('\n')) if (line.length > 2000) throw new Error('A line of _headers is longer than the 2,000 characters that Pages takes.');
  return text;
}

/** One value of a KEY=VALUE file, without reading or keeping the other values. */
function valueIn(file: string, name: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2') || undefined;
  }
  return undefined;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const [target, out] = process.argv.slice(2);
  if ((target !== 'test' && target !== 'production') || !out) {
    console.error('Usage: node scripts/deploy/headers.ts <test|production> <out file>');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const publicEnv = parsePublicEnv(readFileSync(`${root}config/remote.${target}.env`, 'utf8'));
  const secrets = `${root}secrets/${target}.env`;
  const pick = (name: string) => process.env[name] || valueIn(secrets, name);
  const hosts: HeaderHosts = {
    supabaseUrl: publicEnv.VITE_SUPABASE_URL ?? '',
    store: (pick('MADAR_FILE_STORE') ?? 'supabase') as FileStore,
    r2AccountId: pick('R2_ACCOUNT_ID'),
  };
  writeFileSync(out, renderHeaders(readFileSync(`${root}config/headers.template`, 'utf8'), hosts));
  console.log(`Wrote ${out} for ${target}: files on ${hosts.store}, files host ${filesOrigin(hosts)}.`);
}
