import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_HOST_SETTING, screensApiUrl, type ServerHostSetting } from '../server/core/serverHost.ts';

/**
 * The real screens: npm run build:remote -- <test|production>, or npm run dev:remote -- <test|production>.
 * The public values come from config/remote.<env>.env (only VITE_ names). Vite never reads a secret.
 * VITE_API_URL comes from config/server-host.json (owner, 2026-10-16): the page's own /api when the copy runs on the Worker,
 * the Supabase api function otherwise. The public file must not set it.
 */
export type RemoteEnv = 'test' | 'production';

export function parsePublicEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const name = (at === -1 ? line : line.slice(0, at)).trim();
    if (!name.startsWith('VITE_')) throw new Error(`${name} is not a public VITE_ value. Secrets go in secrets/<env>.env.`);
    env[name] = line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  if (env.VITE_MADAR_API !== undefined && env.VITE_MADAR_API !== 'remote') throw new Error('VITE_MADAR_API must be remote in a remote file.');
  env.VITE_MADAR_API = 'remote';
  return env;
}

/**
 * The public values of one copy, with VITE_API_URL from the setting. The dev server (dev: true) always gets the api function:
 * Vite runs no Pages Function, so the page api does not exist there.
 */
export function remotePublicEnv(target: RemoteEnv, text: string, o: { dev?: boolean; setting?: ServerHostSetting } = {}): Record<string, string> {
  const env = parsePublicEnv(text);
  if (env.VITE_API_URL !== undefined) {
    throw new Error(`config/remote.${target}.env must not set VITE_API_URL: config/server-host.json decides it (scripts/build-remote.ts).`);
  }
  env.VITE_API_URL = screensApiUrl(target, o.dev ? 'supabase' : (o.setting ?? SERVER_HOST_SETTING)[target]);
  return env;
}

/** The build ID: the UTC day of the build. The screens send it as X-Madar-Build, and the server refuses one older than MIN_CLIENT_BUILD. */
export function buildId(d: Date): string {
  return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
}

export function remoteSteps(target: RemoteEnv): string[][] {
  return [
    ['node', 'scripts/check-rtl.ts'],
    ['npx', 'tsc', '-p', 'tsconfig.json'],
    ['npx', 'tsc', '-p', 'tsconfig.server.json'],
    ['npx', 'vite', 'build', '--mode', `remote-${target}`],
    ['node', 'scripts/check-bundles.ts', 'remote'],
  ];
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const args = process.argv.slice(2);
  const dev = args.includes('--dev');
  const target = args.find((arg) => !arg.startsWith('--')) ?? (dev ? 'test' : undefined);
  if (target !== 'test' && target !== 'production') {
    console.error('Usage: npm run build:remote -- <test|production>');
    process.exit(2);
  }
  const file = join(root, 'config', `remote.${target}.env`);
  if (!existsSync(file)) {
    console.error(`${file} is missing. Track O writes it with the public values of the ${target} deployment.`);
    process.exit(1);
  }
  const env = { ...process.env, ...remotePublicEnv(target, readFileSync(file, 'utf8'), { dev }) };
  console.log(`> VITE_API_URL=${env.VITE_API_URL} (config/server-host.json)`);
  env.VITE_MADAR_BUILD ??= buildId(new Date());
  const steps = dev ? [['npx', 'vite', '--host', '127.0.0.1', '--mode', `remote-${target}`]] : remoteSteps(target);
  for (const [command, ...rest] of steps) {
    console.log(`> ${command} ${rest.join(' ')}`);
    const run = spawnSync(command, rest, { cwd: root, env, stdio: 'inherit' });
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
