import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A reader of wrangler.server.toml (owner, 2026-10-16): the top level for local runs, and [env.test] and [env.production], the
 * Workers of the two copies. Enough for that file: one value on each line, strings, booleans and one-line arrays.
 *   node scripts/deploy/wranglerServer.ts hyperdrive <test|production>
 * prints the Hyperdrive id of that env, or nothing while the id is the placeholder (scripts/deploy/worker.sh reads it).
 * Plain node runs this file, so it imports only node modules.
 */

export type WorkerEnvName = 'test' | 'production';
export type WorkerConfig = {
  name?: string;
  main?: string;
  workersDev?: boolean;
  previewUrls?: boolean;
  placementRegion?: string;
  hyperdrive: { binding: string; id: string }[];
  vars: Record<string, string>;
  observability?: boolean;
};

/** The id of a Hyperdrive config that does not exist yet: scripts/deploy/cloudflare-setup.ts prints the real one. */
export const PLACEHOLDER_ID = '0'.repeat(32);

function valueOf(text: string): string | boolean {
  const value = text.replace(/\s+#.*$/, '').trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  const quoted = /^"([^"]*)"$/.exec(value);
  return quoted ? quoted[1] : value;
}

/** The values of one env ('' is the top level). A key of the top level does not count for an env: Wrangler names the env Worker. */
export function workerConfigOf(toml: string, env: WorkerEnvName | ''): WorkerConfig {
  const prefix = env === '' ? '' : `env.${env}`;
  const out: WorkerConfig = { hyperdrive: [], vars: {} };
  let section = '';
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const array = /^\[\[([^\]]+)\]\]$/.exec(line);
    const table = /^\[([^\]]+)\]$/.exec(line);
    if (array || table) {
      section = (array ?? table)![1].trim();
      if (array && section === (prefix === '' ? 'hyperdrive' : `${prefix}.hyperdrive`)) out.hyperdrive.push({ binding: '', id: '' });
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) continue;
    const [, key, text] = pair;
    const value = valueOf(text);
    const own = (name: string) => section === (prefix === '' ? name : name === '' ? prefix : `${prefix}.${name}`);
    if (own('')) {
      if (key === 'name' && typeof value === 'string') out.name = value;
      if (key === 'main' && typeof value === 'string') out.main = value;
      if (key === 'workers_dev' && typeof value === 'boolean') out.workersDev = value;
      if (key === 'preview_urls' && typeof value === 'boolean') out.previewUrls = value;
    } else if (own('placement') && key === 'region' && typeof value === 'string') {
      out.placementRegion = value;
    } else if (own('hyperdrive') && out.hyperdrive.length > 0) {
      const last = out.hyperdrive[out.hyperdrive.length - 1];
      if (key === 'binding' && typeof value === 'string') last.binding = value;
      if (key === 'id' && typeof value === 'string') last.id = value;
    } else if (own('vars') && typeof value === 'string') {
      out.vars[key] = value;
    } else if (own('observability') && key === 'enabled' && typeof value === 'boolean') {
      out.observability = value;
    }
  }
  return out;
}

/** The id of the binding DB of an env, or undefined while it is the placeholder or missing. */
export function hyperdriveIdOf(toml: string, env: WorkerEnvName): string | undefined {
  const id = workerConfigOf(toml, env).hyperdrive.find((binding) => binding.binding === 'DB')?.id;
  return id && /^[0-9a-f]{32}$/.test(id) && id !== PLACEHOLDER_ID ? id : undefined;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const [what, env] = process.argv.slice(2);
  if (what !== 'hyperdrive' || (env !== 'test' && env !== 'production')) {
    console.error('Usage: node scripts/deploy/wranglerServer.ts hyperdrive <test|production>');
    process.exit(2);
  }
  const toml = readFileSync(fileURLToPath(new URL('../../wrangler.server.toml', import.meta.url)), 'utf8');
  process.stdout.write(hyperdriveIdOf(toml, env) ?? '');
}
