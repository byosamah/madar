import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const run = (args: string[], wait = '2', extra: Record<string, string> = {}) =>
    spawnSync('bash', [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, MADAR_DOCKER_LOCK: lock, MADAR_DOCKER_LOCK_WAIT_SECONDS: wait, MADAR_DOCKER_LOCK_POLL_SECONDS: '1', ...extra },
    });
  /** A lock left by another holder, written by hand. */
  const leave = (lines: string[]) => {
    mkdirSync(lock);
    writeFileSync(join(lock, 'holder'), lines.join('\n') + '\n');
  };
  return { dir, lock, run, leave };
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

  it('takes a lock whose run holder is dead, and names the old holder', () => {
    const { lock, run, leave } = setup();
    leave(['holder=E1', 'mode=run', 'since=2026-10-03T08:00:00Z', 'since_epoch=1', 'pid=999999']);
    const result = run(['run', 'F1', '--', 'bash', '-c', `cat "${lock}/holder"`], '5');
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/stale/);
    expect(result.stderr).toMatch(/E1/);
    expect(result.stdout).toMatch(/holder=F1/);
    expect(existsSync(lock)).toBe(false);
  });

  it('waits for a run holder that is still alive', () => {
    const { lock, run, leave } = setup();
    leave(['holder=E1', 'mode=run', `since_epoch=${Math.floor(Date.now() / 1000)}`, `pid=${process.pid}`]);
    const result = run(['acquire', 'F1'], '1');
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(lock, 'holder'), 'utf8')).toMatch(/holder=E1/);
  });

  it('takes an acquire lock that is older than the longest hold, and keeps a younger one', () => {
    const { lock, run, leave } = setup();
    const old = Math.floor(Date.now() / 1000) - 100;
    leave(['holder=C1', 'mode=acquire', `since_epoch=${old}`, 'max_hold=50']);
    expect(run(['acquire', 'F1'], '5').status).toBe(0);
    expect(readFileSync(join(lock, 'holder'), 'utf8')).toMatch(/holder=F1/);
    expect(readFileSync(join(lock, 'holder'), 'utf8')).toMatch(/mode=acquire/);
    rmSync(lock, { recursive: true });
    leave(['holder=C1', 'mode=acquire', `since_epoch=${old}`, 'max_hold=3600']);
    expect(run(['acquire', 'F1'], '1').status).not.toBe(0);
    expect(readFileSync(join(lock, 'holder'), 'utf8')).toMatch(/holder=C1/);
  });

  it('writes the mode, the pid of the run and the longest hold of an acquire', () => {
    const { lock, run } = setup();
    expect(run(['run', 'B1', '--', 'bash', '-c', `cat "${lock}/holder"`]).stdout).toMatch(/mode=run[\s\S]*pid=\d+/);
    run(['acquire', 'C1'], '2', { MADAR_DOCKER_LOCK_MAX_HOLD_SECONDS: '600' });
    const holder = readFileSync(join(lock, 'holder'), 'utf8');
    expect(holder).toMatch(/mode=acquire/);
    expect(holder).toMatch(/max_hold=600/);
  });

  it('leaves the lock of another holder in place when a run ends', () => {
    const { lock, run } = setup();
    // While E1 runs, its lock is released by force and F1 takes the lock.
    const takeOver = `rm -rf "${lock}" && mkdir "${lock}" && printf 'holder=F1\\nmode=acquire\\nsince_epoch=%s\\nmax_hold=3600\\n' "$(date +%s)" > "${lock}/holder"`;
    const result = run(['run', 'E1', '--', 'bash', '-c', takeOver]);
    expect(result.status).toBe(0);
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(join(lock, 'holder'), 'utf8')).toMatch(/holder=F1/);
  });

  it('stops at once when it cannot make the lock folder at all', () => {
    const { dir } = setup();
    const started = Date.now();
    const result = spawnSync('bash', [script, 'acquire', 'B1'], {
      encoding: 'utf8',
      env: { ...process.env, MADAR_DOCKER_LOCK: join(dir, 'no-such-folder', 'lock'), MADAR_DOCKER_LOCK_WAIT_SECONDS: '30', MADAR_DOCKER_LOCK_POLL_SECONDS: '1' },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/cannot make/);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
