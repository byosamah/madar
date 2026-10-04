import { spawn } from 'node:child_process';

/**
 * Runs one program and gives its output. A failure names the step by its label and shows the end of the error output, but never
 * the arguments: an argument can hold the database address with its password. Each text in redact (a password, an address)
 * becomes *** in the error, in case the program printed it.
 */
export function run(
  label: string,
  command: string,
  args: string[],
  o: { input?: string | Buffer; env?: NodeJS.ProcessEnv; cwd?: string; redact?: string[] } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => reject(new Error(`${label}: cannot start ${command} (${error.message}).`)));
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code === 0) resolve({ stdout, stderr });
      else {
        let tail = stderr.trim().split('\n').slice(-6).join('\n');
        for (const text of o.redact ?? []) if (text !== '') tail = tail.split(text).join('***');
        reject(new Error(`${label} failed (exit ${code}): ${tail}`));
      }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input);
  });
}
