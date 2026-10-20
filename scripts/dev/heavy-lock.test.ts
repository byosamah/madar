import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// One heavy test run at a time on this Mac (owner, 2026-10-20): two or three full runs of other sessions at once filled the 16 GB of
// memory, the load reached 190 on 10 cores, and tests failed on their time limits. heavy-lock.sh is docker-lock.sh with its own lock.
const script = fileURLToPath(new URL('./heavy-lock.sh', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const dirs: string[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'madar-heavy-'));
  dirs.push(dir);
  const env = { ...process.env, MADAR_HEAVY_LOCK: join(dir, 'heavy.lock'), MADAR_DOCKER_LOCK: join(dir, 'docker.lock'), MADAR_HEAVY_LOCK_WAIT_SECONDS: '2', MADAR_DOCKER_LOCK_POLL_SECONDS: '1' };
  const run = (args: string[]) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env });
  return { dir, env, run, lock: env.MADAR_HEAVY_LOCK };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('heavy-lock.sh', () => {
  it('runs a command under its own lock, not the Docker lock, and releases it on exit', () => {
    const { dir, lock, run } = setup();
    const result = run(['run', 'T1', '--', 'bash', '-c', `cat "${lock}/holder"; test ! -e "${join(dir, 'docker.lock')}"`]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/holder=T1/);
    expect(existsSync(lock)).toBe(false);
  });

  it('makes a second run wait, and gives up after its wait with the name of the holder, in its own words', async () => {
    const { env, run, lock } = setup();
    const first = spawn('bash', [script, 'run', 'FIRST', '--', 'sleep', '5'], { env });
    try {
      for (let i = 0; i < 50 && !existsSync(join(lock, 'holder')); i += 1) await new Promise((r) => setTimeout(r, 100));
      const second = run(['run', 'SECOND', '--', 'true']);
      expect(second.status).toBe(1);
      expect(second.stderr).toMatch(/^heavy-lock: waiting for holder=FIRST/m);
      expect(second.stderr).toMatch(/^heavy-lock: gave up after 2s\. The lock is held by: holder=FIRST/m);
      expect(second.stderr).not.toMatch(/docker-lock:/);
    } finally {
      first.kill();
    }
  });

  it('keeps the Docker lock free: a Docker task and a heavy run never block each other', () => {
    const { dir, env } = setup();
    const docker = fileURLToPath(new URL('./docker-lock.sh', import.meta.url));
    const result = spawnSync('bash', [docker, 'run', 'D1', '--', 'bash', script, 'run', 'T1', '--', 'bash', '-c', `test -d "${join(dir, 'docker.lock')}" && test -d "${join(dir, 'heavy.lock')}"`], { encoding: 'utf8', env });
    expect(result.status).toBe(0);
  });
});

describe('the heavy npm scripts', () => {
  const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;

  it('take the heavy lock by themselves, so every session and helper waits its turn', () => {
    for (const name of ['test', 'test:server', 'test:db', 'test:lite', 'test:office', 'test:it', 'test:mcp', 'smoke']) {
      expect(scripts[name], name).toMatch(/(^|\s)bash scripts\/dev\/heavy-lock\.sh run \S+ -- /);
    }
  });

  it('keep the watch mode out of the lock: it never ends', () => {
    expect(scripts['test:watch']).not.toMatch(/heavy-lock/);
  });

  it('run vitest with at most 5 workers', () => {
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toMatch(/^\s+maxWorkers: 5,/m);
  });
});
