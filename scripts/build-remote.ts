import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The real screens: npm run build:remote -- <test|production>, or npm run dev:remote -- <test|production>.
 * The public values come from config/remote.<env>.env (only VITE_ names). Vite never reads a secret.
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
  const env = { ...process.env, ...parsePublicEnv(readFileSync(file, 'utf8')) };
  const steps = dev ? [['npx', 'vite', '--host', '127.0.0.1', '--mode', `remote-${target}`]] : remoteSteps(target);
  for (const [command, ...rest] of steps) {
    console.log(`> ${command} ${rest.join(' ')}`);
    const run = spawnSync(command, rest, { cwd: root, env, stdio: 'inherit' });
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
