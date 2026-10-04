import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The restore check when the owner stops it (plan 5.7; task O2). A stopped run must not leave the decrypted dump (it holds live
 * sessions and refresh tokens) or the container behind. No Docker: a stand-in age program waits, so the check is stopped during
 * the decrypt step, with its private folder already made.
 */

const root = new URL('../', import.meta.url);
let dir: string;
let tmp: string;
let mark: string;
let fakeAge: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'madar-o2-signal-'));
  tmp = join(dir, 'tmp');
  mkdirSync(tmp);
  mark = join(dir, 'age-started');
  fakeAge = join(dir, 'age');
  writeFileSync(fakeAge, '#!/bin/sh\necho $$ > "$O2_MARK"\nexec sleep 30\n');
  chmodSync(fakeAge, 0o755);
});

afterAll(() => {
  if (existsSync(mark)) spawnSync('kill', [readFileSync(mark, 'utf8').trim()]);
  rmSync(dir, { recursive: true, force: true });
});

async function until(test: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) throw new Error('The wait ran out.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('the restore check, stopped with Ctrl-C', () => {
  it('removes its private folder and the leftovers of an earlier stopped run, and exits 130', async () => {
    // The folder of an earlier run whose process is gone.
    const gone = spawnSync('sh', ['-c', 'echo $$']).stdout.toString().trim();
    const leftover = join(tmp, `madar-restore-${gone}-AbC123`);
    mkdirSync(leftover);
    writeFileSync(join(leftover, 'data.sql'), 'COPY ...');

    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/restore-check.ts', '--file', join(dir, 'b.age'), '--key', join(dir, 'k.txt'), '--skip-files'],
      { cwd: root, env: { ...process.env, TMPDIR: tmp, MADAR_AGE: fakeAge, O2_MARK: mark }, stdio: 'ignore' },
    );
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    await until(() => existsSync(mark), 30_000);
    const own = readdirSync(tmp).filter((name) => name.startsWith(`madar-restore-${child.pid}-`));
    expect(own).toHaveLength(1);
    expect(existsSync(leftover)).toBe(false);

    child.kill('SIGINT');
    expect(await exited).toBe(130);
    expect(readdirSync(tmp).filter((name) => name.startsWith('madar-restore-'))).toEqual([]);
  }, 60_000);
});
