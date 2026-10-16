import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { COPY_HOSTS, PROJECT_REFS } from '../../server/core/serverHost.ts';
import { CA_NAME, POOLER_HOST, SESSION_POOLER_PORT, codesOf, hyperdriveOrigin, type CloudflareAnswer, type CloudflareApi } from './cloudflare.ts';
import { checkSecrets, parseSecretsFile, type Target } from './secrets.ts';
import { hyperdriveIdOf } from './wranglerServer.ts';

/**
 * The Cloudflare parts of one copy, made once (owner, 2026-10-16):
 *   npx tsx scripts/deploy/cloudflare-setup.ts --env test|production      (the sandbox must be off: it calls the Cloudflare API)
 * Each step looks first and makes only what is missing, so a second run changes nothing:
 *   1. the CA supabase-root-2021-ca (config/supabase-root-2021-ca.crt), for Hyperdrive verify-full;
 *   2. the Hyperdrive config madar-db-<env>: madar_server of the copy on the session pooler (port 5432; the transaction pooler
 *      hangs behind Hyperdrive, proof.md), caching off, verify-full with that CA, origin connection limit 10. The password comes
 *      from DATABASE_URL of secrets/<env>.env and stays in memory. A config that exists but differs gets a warning line;
 *   3. the R2 bucket of the copy in the EU jurisdiction (madar-files-test, madar-files) and its CORS rule from
 *      config/r2-cors.<env>.json. While R2 is not on for the account (error 10042), it skips this part with a clear line;
 *   4. the service binding of the Pages environment of the copy (preview: MADAR_SERVER_TEST to madar-server-test; production:
 *      MADAR_SERVER_PRODUCTION to madar-server-production), with every other Pages setting kept. It waits for the Worker.
 * At the end it prints the Hyperdrive id to put into [env.<env>] of wrangler.server.toml. It prints names and ids only.
 * Production asks for the typed word first, and never runs in CI.
 */

/** The R2 bucket of each copy (the files track checks the same names in secrets.ts). Both are in the EU jurisdiction. */
export const R2_BUCKET_OF: Record<Target, string> = { test: 'madar-files-test', production: 'madar-files' };
/** The Pages environment of each copy: the branch preview is the test copy, main is production. */
export const PAGES_ENV_OF: Record<Target, 'preview' | 'production'> = { test: 'preview', production: 'production' };
export const PAGES_PROJECT = 'madar';
/** At 5 a second transaction often waited in its BEGIN; at 10 the probe had no hang (proof.md, Hyperdrive probe, fact 2). */
export const ORIGIN_CONNECTION_LIMIT = 10;
const JURISDICTION = { 'cf-r2-jurisdiction': 'eu' };
const R2_OFF = 10042;

export type SetupRun = {
  target: Target;
  api: CloudflareApi;
  /** The text of secrets/<env>.env: only DATABASE_URL is used, for the Hyperdrive password. */
  secretsText: string;
  caPem: string;
  /** The text of config/r2-cors.<env>.json, when the file exists. */
  corsText?: string;
  /** The text of wrangler.server.toml, to say whether its Hyperdrive id is the right one. */
  toml: string;
  env: Record<string, string | undefined>;
  ask: (question: string) => Promise<string>;
  log: (line: string) => void;
};

type Ca = { id: string; name: string; ca?: boolean };
type HyperdriveConfig = {
  id: string;
  name: string;
  origin?: { host?: string; port?: number; user?: string; database?: string };
  caching?: { disabled?: boolean };
  mtls?: { ca_certificate_id?: string; sslmode?: string };
  origin_connection_limit?: number;
};
type Services = Record<string, { service: string; environment?: string; entrypoint?: string }>;
type PagesProject = { deployment_configs?: Record<string, { services?: Services } | undefined> };

function refused(step: string, answer: CloudflareAnswer<unknown>): Error {
  return new Error(`The Cloudflare API refused ${step}: ${codesOf(answer)}.`);
}

async function confirmProduction(run: SetupRun): Promise<void> {
  if (run.target !== 'production') return;
  if (run.env.CI || run.env.GITHUB_ACTIONS) throw new Error('The production setup runs from the Mac only (plan, section 10, decision 9).');
  const word = await run.ask('This changes the Cloudflare parts of production. Type production to go on: ');
  if (word.trim() !== 'production') throw new Error('Stopped: the typed word was not production. Nothing changed.');
}

async function ensureCa(run: SetupRun): Promise<string> {
  const list = await run.api<Ca[]>('/mtls_certificates');
  if (!list.success) throw refused('the list of the certificates', list);
  const found = list.result.find((c) => c.name === CA_NAME && c.ca === true);
  if (found) {
    run.log(`CA ${CA_NAME}: exists (${found.id}).`);
    return found.id;
  }
  const made = await run.api<Ca>('/mtls_certificates', { method: 'POST', body: { name: CA_NAME, ca: true, certificates: run.caPem } });
  if (!made.success) throw refused(`the upload of the CA ${CA_NAME}`, made);
  run.log(`CA ${CA_NAME}: uploaded (${made.result.id}).`);
  return made.result.id;
}

/** The differences of a config from the wanted one: the session pooler of the copy, caching off, verify-full with the CA. */
export function hyperdriveProblems(config: HyperdriveConfig, ref: string, caId: string): string[] {
  const problems: string[] = [];
  if (config.origin?.host !== POOLER_HOST || config.origin?.port !== SESSION_POOLER_PORT) problems.push(`the origin is not the session pooler ${POOLER_HOST}:${SESSION_POOLER_PORT}`);
  if (config.origin?.user !== `madar_server.${ref}`) problems.push(`the user is not madar_server.${ref}`);
  if (config.caching?.disabled !== true) problems.push('caching is on');
  if (config.mtls?.sslmode !== 'verify-full' || config.mtls?.ca_certificate_id !== caId) problems.push(`it does not use verify-full with the CA ${CA_NAME}`);
  if ((config.origin_connection_limit ?? 0) < ORIGIN_CONNECTION_LIMIT) problems.push(`the origin connection limit is under ${ORIGIN_CONNECTION_LIMIT}`);
  return problems;
}

async function ensureHyperdrive(run: SetupRun, caId: string): Promise<string> {
  const ref = PROJECT_REFS[run.target];
  const name = COPY_HOSTS[run.target].workers.hyperdrive;
  const list = await run.api<HyperdriveConfig[]>('/hyperdrive/configs');
  if (!list.success) throw refused('the list of the Hyperdrive configs', list);
  const found = list.result.find((c) => c.name === name);
  if (found) {
    const full = await run.api<HyperdriveConfig>(`/hyperdrive/configs/${found.id}`);
    const problems = full.success ? hyperdriveProblems(full.result, ref, caId) : ['its settings could not be read'];
    run.log(`Hyperdrive ${name}: exists (${found.id}).`);
    if (problems.length > 0) run.log(`Warning: Hyperdrive ${name} differs from the setup: ${problems.join('; ')}. Fix it in the dashboard or with npx wrangler hyperdrive update.`);
    return found.id;
  }
  // The password of madar_server, checked as secrets.ts checks it. It never reaches the output.
  const { serverPassword } = checkSecrets(parseSecretsFile(run.secretsText), ref);
  const body = {
    name,
    origin: hyperdriveOrigin(ref, serverPassword),
    caching: { disabled: true },
    mtls: { ca_certificate_id: caId, sslmode: 'verify-full' },
    origin_connection_limit: ORIGIN_CONNECTION_LIMIT,
  };
  const made = await run.api<HyperdriveConfig>('/hyperdrive/configs', { method: 'POST', body });
  if (!made.success) throw refused(`the Hyperdrive config ${name} (the create connects to the database, so a wrong CA or password fails here)`, made);
  run.log(`Hyperdrive ${name}: made (${made.result.id}), the session pooler, caching off, verify-full with ${CA_NAME}, limit ${ORIGIN_CONNECTION_LIMIT}.`);
  return made.result.id;
}

/** The CORS file of the files track, in the R2 form ({ rules: [{ allowed: { origins, methods, headers }, maxAgeSeconds }] }). */
export function corsRulesOf(text: string): { rules: unknown[] } {
  const parsed = JSON.parse(text) as { rules?: unknown };
  if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) throw new Error('The R2 CORS file needs a rules array (the R2 form, not the S3 CORSRules form).');
  for (const rule of parsed.rules as { allowed?: { origins?: unknown; methods?: unknown } }[]) {
    if (!Array.isArray(rule.allowed?.origins) || !Array.isArray(rule.allowed?.methods)) throw new Error('Each R2 CORS rule needs allowed.origins and allowed.methods.');
  }
  return { rules: parsed.rules };
}

async function ensureR2(run: SetupRun): Promise<void> {
  const bucket = R2_BUCKET_OF[run.target];
  const got = await run.api(`/r2/buckets/${bucket}`, { headers: JURISDICTION });
  if (got.errors.some((e) => e.code === R2_OFF)) {
    run.log(`Skip R2: R2 is not on for the account (error ${R2_OFF}). The owner turns it on in the dashboard; then run this again.`);
    return;
  }
  if (got.success) {
    run.log(`R2 bucket ${bucket} (EU): exists.`);
  } else if (got.status === 404) {
    const made = await run.api('/r2/buckets', { method: 'POST', body: { name: bucket }, headers: JURISDICTION });
    if (!made.success) throw refused(`the R2 bucket ${bucket}`, made);
    run.log(`R2 bucket ${bucket} (EU): made.`);
  } else {
    throw refused(`the check of the R2 bucket ${bucket}`, got);
  }
  if (run.corsText === undefined) {
    run.log(`Skip the R2 CORS rule: config/r2-cors.${run.target}.json is not in this checkout (the files track writes it).`);
    return;
  }
  const cors = await run.api(`/r2/buckets/${bucket}/cors`, { method: 'PUT', body: corsRulesOf(run.corsText), headers: JURISDICTION });
  if (!cors.success) throw refused(`the CORS rule of ${bucket}`, cors);
  run.log(`R2 bucket ${bucket}: the CORS rule of config/r2-cors.${run.target}.json is set.`);
}

async function ensurePagesBinding(run: SetupRun): Promise<void> {
  const { name: worker, binding } = COPY_HOSTS[run.target].workers;
  const pagesEnv = PAGES_ENV_OF[run.target];
  const exists = await run.api(`/workers/scripts/${worker}/settings`);
  if (exists.status === 404) {
    run.log(`Skip the Pages binding ${binding}: the Worker ${worker} does not exist yet. Deploy it (scripts/deploy/worker.sh ${run.target}), then run this again.`);
    return;
  }
  if (!exists.success) throw refused(`the check of the Worker ${worker}`, exists);
  const project = await run.api<PagesProject>(`/pages/projects/${PAGES_PROJECT}`);
  if (!project.success) throw refused(`the Pages project ${PAGES_PROJECT}`, project);
  const services: Services = project.result.deployment_configs?.[pagesEnv]?.services ?? {};
  if (services[binding]?.service === worker) {
    run.log(`Pages binding ${binding} (${pagesEnv}) to ${worker}: exists.`);
    return;
  }
  // Only the services of this one environment change, and every other binding there stays.
  const next: Services = { ...services, [binding]: { service: worker, environment: 'production' } };
  const patched = await run.api(`/pages/projects/${PAGES_PROJECT}`, { method: 'PATCH', body: { deployment_configs: { [pagesEnv]: { services: next } } } });
  if (!patched.success) throw refused(`the Pages binding ${binding}`, patched);
  run.log(`Pages binding ${binding} (${pagesEnv}) to ${worker}: set. The next Pages deploy (pages.sh ${run.target}) uses it.`);
}

export async function runSetup(run: SetupRun): Promise<{ hyperdriveId: string }> {
  await confirmProduction(run);
  run.log(`Cloudflare setup of ${run.target} (${PROJECT_REFS[run.target]}).`);
  const caId = await ensureCa(run);
  const hyperdriveId = await ensureHyperdrive(run, caId);
  await ensureR2(run);
  await ensurePagesBinding(run);
  const inToml = hyperdriveIdOf(run.toml, run.target);
  run.log(inToml === hyperdriveId
    ? `wrangler.server.toml already binds [env.${run.target}] DB to ${hyperdriveId}.`
    : `Next: put id = "${hyperdriveId}" into [[env.${run.target}.hyperdrive]] of wrangler.server.toml, and the row into accounts.md, then commit.`);
  return { hyperdriveId };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const target = args[args.indexOf('--env') + 1];
  if (!args.includes('--env') || (target !== 'test' && target !== 'production')) {
    console.error('Usage: npx tsx scripts/deploy/cloudflare-setup.ts --env test|production');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const secretsFile = `${root}secrets/${target}.env`;
  if (!existsSync(secretsFile)) {
    console.error(`${secretsFile} is missing. Its DATABASE_URL gives the Hyperdrive password.`);
    process.exit(1);
  }
  const cloudflare = await import('./cloudflare.ts');
  const corsFile = `${root}config/r2-cors.${target}.json`;
  const wranglerEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? cloudflare.ACCOUNT_ID };
  // wrangler whoami refreshes the OAuth token of the sign-in. Its output names the account, so it stays out of the log.
  if (!process.env.CLOUDFLARE_API_TOKEN) await cloudflare.runWithStdin(`${root}node_modules/.bin/wrangler`, ['whoami'], '', { cwd: root, env: wranglerEnv });
  runSetup({
    target,
    api: cloudflare.cloudflareApi(cloudflare.cloudflareToken()),
    secretsText: readFileSync(secretsFile, 'utf8'),
    caPem: readFileSync(`${root}config/supabase-root-2021-ca.crt`, 'utf8'),
    ...(existsSync(corsFile) ? { corsText: readFileSync(corsFile, 'utf8') } : {}),
    toml: readFileSync(`${root}wrangler.server.toml`, 'utf8'),
    env: process.env,
    ask: async (question) => {
      const reader = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await reader.question(question);
      } catch {
        return '';
      } finally {
        reader.close();
      }
    },
    log: (line) => console.log(line),
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
