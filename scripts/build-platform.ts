import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildId } from './build-remote.ts';

/**
 * The site Madar enterprises (design 12, D7): npm run build:platform. One build serves the test copy and production, because the site holds
 * no public value: it talks to its own /api, and the Pages Function of the project madar-platform picks the Worker of the copy.
 * The steps: the direction check, both type checks, the Vite build into dist-platform/ (with _headers), and the bundle check.
 */
export function platformSteps(): string[][] {
  return [
    ['node', 'scripts/check-rtl.ts'],
    ['npx', 'tsc', '-p', 'tsconfig.json'],
    ['npx', 'tsc', '-p', 'tsconfig.server.json'],
    ['npx', 'vite', 'build', '-c', 'vite.platform.config.ts'],
    ['node', 'scripts/check-bundles.ts', 'platform'],
  ];
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const env = { ...process.env };
  env.VITE_MADAR_BUILD ??= buildId(new Date());
  for (const [command, ...rest] of platformSteps()) {
    console.log(`> ${command} ${rest.join(' ')}`);
    const run = spawnSync(command, rest, { cwd: root, env, stdio: 'inherit' });
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
