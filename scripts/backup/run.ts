import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

export type RunOptions = {
  input?: string | Buffer;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  redact?: string[];
  /** Stops the program and every child it started (its process group) after this time, and fails the step. */
  timeoutMs?: number;
  /** The part of the error output that the failure may show (default: the last 6 lines). */
  errorText?: (stderr: string) => string;
  /** Writes the output to this file (mode 600) instead of keeping it in memory; stdout is then empty. */
  stdoutFile?: string;
};

/** How long a stopped program has after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 5000;

/**
 * Runs one program and gives its output. A failure names the step by its label and shows the end of the error output, but never
 * the arguments: an argument can hold the database address with its password. Each text in redact (a password, an address)
 * becomes *** in the error, in case the program printed it.
 */
export function run(label: string, command: string, args: string[], o: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const outFd = o.stdoutFile === undefined ? undefined : openSync(o.stdoutFile, 'w', 0o600);
    const child = spawn(command, args, {
      cwd: o.cwd,
      env: o.env ?? process.env,
      stdio: ['pipe', outFd ?? 'pipe', 'pipe'],
      // Its own process group, so a time limit stops the children too (a pg_dump behind a shell pipe).
      detached: o.timeoutMs !== undefined,
    });
    if (outFd !== undefined) closeSync(outFd);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const signal = (name: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, name);
      } catch {
        // The group has ended already.
      }
    };
    const timer =
      o.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            signal('SIGTERM');
            setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS).unref();
          }, o.timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`${label}: cannot start ${command} (${error.message}).`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (timedOut) reject(new Error(`${label} took longer than ${o.timeoutMs! / 1000} s and was stopped.`));
      else if (code === 0) resolve({ stdout, stderr });
      else {
        let tail = o.errorText ? o.errorText(stderr) : stderr.trim().split('\n').slice(-6).join('\n');
        for (const text of o.redact ?? []) if (text !== '') tail = tail.split(text).join('***');
        reject(new Error(`${label} failed (exit ${code}): ${tail}`));
      }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input);
  });
}
