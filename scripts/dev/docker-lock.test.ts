import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./docker-lock.sh', import.meta.url));
const dirs: string[] = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'madar-lock-'));
  dirs.push(dir);
  const lock = join(dir, 'madar-docker.lock');
  const run = (args: string[], wait = '2') =>
    spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, MADAR_DOCKER_LOCK: lock, MADAR_DOCKER_LOCK_WAIT_SECONDS: wait, MADAR_DOCKER_LOCK_POLL_SECONDS: '1' },
    });
  return { lock, run };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('docker-lock.sh', () => {
  it('runs a command under the lock and releases it on exit', () => {
    const { lock, run } = setup();
    const result = run(['run', 'B1', '--', 'bash', '-c', `cat "${lock}/holder"`]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/holder=B1/);
    expect(result.stdout).toMatch(/since=\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(lock)).toBe(false);
  });

  it('releases the lock when the command fails, and passes its exit code on', () => {
    const { lock, run } = setup();
    const result = run(['run', 'B1', '--', 'bash', '-c', 'exit 3']);
    expect(result.status).toBe(3);
    expect(existsSync(lock)).toBe(false);
  });

  it('keeps a lock taken with acquire until the same holder releases it', () => {
    const { lock, run } = setup();
    expect(run(['acquire', 'C1']).status).toBe(0);
    expect(readFileSync(join(lock, 'holder'), 'utf8')).toMatch(/holder=C1/);
    const other = run(['release', 'D1']);
    expect(other.status).not.toBe(0);
    expect(existsSync(lock)).toBe(true);
    expect(run(['release', 'C1']).status).toBe(0);
    expect(existsSync(lock)).toBe(false);
  });

  it('waits, then gives up after the limit and names the holder', () => {
    const { run } = setup();
    expect(run(['acquire', 'C1']).status).toBe(0);
    const started = Date.now();
    const result = run(['acquire', 'F1'], '1');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/C1/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('tells who holds the lock', () => {
    const { run } = setup();
    expect(run(['status']).stdout).toMatch(/free/);
    run(['acquire', 'N1']);
    expect(run(['status']).stdout).toMatch(/holder=N1/);
  });
});
