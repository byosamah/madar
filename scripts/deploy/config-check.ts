import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The check that scripts/deploy/config.sh runs before `supabase config push` (plan 5.9):
 *   node scripts/deploy/config-check.ts <test|production> <ref>
 * supabase/config.toml holds the values of the local stack. A push sends them to the hosted project unless a [remotes.<env>]
 * block for that project replaces them, so the check wants that block, https sign-in addresses, a token life of 15 minutes or
 * less, a 10-digit email code, the Data API off, and the function of the token hook in a migration (supabase/seed.sql never
 * runs on a hosted project).
 */

type Tables = Map<string, Map<string, string>>;

/** The tables and keys of a TOML file, line by line. Enough for config.toml: one value on each line, no multi-line arrays. */
function tablesOf(toml: string): Tables {
  const tables: Tables = new Map([['', new Map()]]);
  let current = tables.get('')!;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const name = header[1].trim();
      if (!tables.has(name)) tables.set(name, new Map());
      current = tables.get(name)!;
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (pair) current.set(pair[1], pair[2].replace(/\s+#.*$/, '').trim());
  }
  return tables;
}

/** The longest life of an Auth token: 15 minutes (owner, 2026-10-06, Z7). */
export const MAX_TOKEN_SECONDS = 900;

/** The digits of the email code of an Auth link: 10, the most that Auth takes (security finding F2, 2026-10-28). */
export const EMAIL_CODE_DIGITS = 10;

const strings = (value: string | undefined): string[] => [...(value ?? '').matchAll(/"([^"]*)"/g)].map((match) => match[1]);
const goodAddress = (url: string) => /^https:\/\/[^/\s]+/.test(url) && !/^https:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(url);

export function checkRemoteConfig(toml: string, target: string, ref: string, migrations: string[]): string[] {
  const tables = tablesOf(toml);
  const errors: string[] = [];
  const block = `remotes.${target}`;
  const remote = tables.get(block);
  if (!remote) {
    errors.push(`supabase/config.toml has no [${block}] block with project_id = "${ref}", so the push would send the local values (site_url on 127.0.0.1).`);
  } else if (strings(remote.get('project_id'))[0] !== ref) {
    errors.push(`[${block}] must have project_id = "${ref}".`);
  }
  const auth = tables.get(`${block}.auth`);
  const site = strings(auth?.get('site_url'));
  if (site.length !== 1 || !goodAddress(site[0])) errors.push(`[${block}.auth] needs site_url, the https address of the screens of ${target}.`);
  const redirects = strings(auth?.get('additional_redirect_urls'));
  if (redirects.length === 0 || !redirects.every(goodAddress)) errors.push(`[${block}.auth] needs additional_redirect_urls with https addresses only.`);

  // A browser token stays good after its Auth session ends, until it expires (Z7, 2026-10-06). Auth's default is 3600.
  const expiry = Number(auth?.get('jwt_expiry') ?? tables.get('auth')?.get('jwt_expiry') ?? 3600);
  if (!(expiry > 0 && expiry <= MAX_TOKEN_SECONDS)) {
    errors.push(`[auth] needs jwt_expiry = ${MAX_TOKEN_SECONDS} or less: a browser token stays good after a sign-out elsewhere until it expires.`);
  }

  // The token hash of a reset or invitation link comes from the email code, and /auth/v1/verify also takes the code itself.
  // 6 digits (the Auth default) let a guesser with many addresses find a live code in its 1 hour. Auth sets a value below 6
  // or above 10 back to 6, so the check wants 10 exactly.
  const codeDigits = Number(tables.get(`${block}.auth.email`)?.get('otp_length') ?? tables.get('auth.email')?.get('otp_length') ?? 6);
  if (codeDigits !== EMAIL_CODE_DIGITS) {
    errors.push(`[auth.email] needs otp_length = ${EMAIL_CODE_DIGITS}: a shorter email code lets a guesser with many addresses find a live reset link.`);
  }

  for (const table of ['api', `${block}.api`]) {
    if (tables.get(table)?.get('enabled') === 'true') errors.push(`[${table}] turns the Data API on. It stays off in every project (plan, change 14).`);
  }
  // The free plan has no vector buckets: a push of storage.vector.enabled = true stops with 402 (2026-10-05).
  for (const table of ['storage.vector', `${block}.storage.vector`]) {
    if (tables.get(table)?.get('enabled') === 'true') errors.push(`[${table}] turns vector buckets on. The free plan has none, and Madar does not use them.`);
  }

  const hook = tables.get('auth.hook.custom_access_token');
  if (hook?.get('enabled') === 'true') {
    const uri = /^pg-functions:\/\/[^/]+\/([^/]+)\/([^/"]+)$/.exec(strings(hook.get('uri'))[0] ?? '');
    if (!uri) {
      errors.push('[auth.hook.custom_access_token] needs a pg-functions:// uri.');
    } else {
      const [, schema, name] = uri;
      const made = new RegExp(`function\\s+(${schema}\\.)?"?${name}"?\\s*\\(`, 'i');
      if (!migrations.some((text) => made.test(text))) {
        errors.push(`The token hook is on, but no migration makes ${schema}.${name}. Auth would refuse every sign-in. Push the migration first (track G).`);
      }
    }
  }
  return errors;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const [target, ref] = process.argv.slice(2);
  if ((target !== 'test' && target !== 'production') || !ref) {
    console.error('Usage: node scripts/deploy/config-check.ts <test|production> <ref>');
    process.exit(2);
  }
  const supabase = fileURLToPath(new URL('../../supabase/', import.meta.url));
  const migrations = readdirSync(`${supabase}migrations`)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(`${supabase}migrations/${name}`, 'utf8'));
  const errors = checkRemoteConfig(readFileSync(`${supabase}config.toml`, 'utf8'), target, ref, migrations);
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
  console.log(`supabase/config.toml is ready for ${target} (${ref}).`);
}
