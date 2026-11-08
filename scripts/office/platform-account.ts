// A platform account of Madar enterprises (design D13): make one, set a new password, turn it off or on.
//
//   npx tsx scripts/office/platform-account.ts --to <page address> --email <email> --name <name>      (make an account; asks for the password)
//   npx tsx scripts/office/platform-account.ts --to <page address> --email <email> --password          (a new password; ends every session)
//   npx tsx scripts/office/platform-account.ts --to <page address> --email <email> --off               (the account cannot sign in or call)
//   npx tsx scripts/office/platform-account.ts --to <page address> --email <email> --on
//
// The password comes from a hidden prompt, twice. It has at least 12 characters. The script never prints it, and it sends it once, over HTTPS,
// with the ops secret in the header. The page address is the platform site (preview.madar-platform-d6c.pages.dev) or a company page of the same
// copy: the ops route sits on the company address of the copy (the platform site passes only /api/platform on). For production the script
// needs --production, and the owner's OK comes first. The ops secret comes from secrets/<copy>.env (or from the environment for the local
// office) and is never printed.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COPY_HOSTS, copyOfPageHost, copyOfPlatformHost, type Copy } from '../../server/core/serverHost';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { PLATFORM_PASSWORD_MIN } from '../../server/enterprise/platform/accounts';
import { copyValuesOf, flagOf } from './import';
import { opsOf, type OfficeOps } from './ops';

export type PlatformAccountAction = 'create' | 'password' | 'off' | 'on';
export type PlatformAccountArgs = { to: string; email: string; name?: string; action: PlatformAccountAction; production: boolean };

const USAGE = 'Use: --to <page address> --email <email> and one of --name <name> (make an account), --password, --off or --on.';
const FLAGS = new Set(['--to', '--email', '--name', '--password', '--off', '--on', '--production']);

/** The checked arguments. One action only: make (with --name), --password, --off or --on. */
export function platformAccountArgs(argv: readonly string[]): PlatformAccountArgs {
  for (const [at, arg] of argv.entries()) {
    const value = ['--to', '--email', '--name'].includes(argv[at - 1] ?? '');
    if (!value && !FLAGS.has(arg)) throw new Error(`The argument ${arg.startsWith('--') ? arg : 'given'} is not known. ${USAGE}`);
  }
  const to = flagOf(argv, '--to');
  const email = flagOf(argv, '--email').trim();
  const name = flagOf(argv, '--name').trim();
  if (to === '' || email === '') throw new Error(USAGE);
  const named = ['--password', '--off', '--on'].filter((flag) => argv.includes(flag));
  if (named.length > 1) throw new Error('Give only one of --password, --off and --on.');
  if (named.length === 1 && name !== '') throw new Error('--name is only for making an account.');
  const action: PlatformAccountAction = named[0] === '--password' ? 'password' : named[0] === '--off' ? 'off' : named[0] === '--on' ? 'on' : 'create';
  if (action === 'create' && name === '') throw new Error(`To make an account give --name. ${USAGE}`);
  return { to, email, ...(action === 'create' ? { name } : {}), action, production: argv.includes('--production') };
}

/** The password that was typed twice. It must match and have at least PLATFORM_PASSWORD_MIN characters. The error never holds the password. */
export function checkedPassword(first: string, second: string): string {
  if (first.length < PLATFORM_PASSWORD_MIN) throw new Error(`The password needs at least ${PLATFORM_PASSWORD_MIN} characters.`);
  if (first !== second) throw new Error('The two passwords are not the same.');
  return first;
}

/** The copy and the base address of the ops: the company address of the copy, also when --to names the platform site. */
export function platformTargetOf(to: string, production: boolean): { copy: Copy | 'local'; base: string } {
  const url = new URL(to);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return { copy: 'local', base: url.origin };
  if (url.protocol !== 'https:') throw new Error('Use an https address: the password travels in the request.');
  const copy = copyOfPlatformHost(url.hostname) ?? copyOfPageHost(url.hostname);
  if (!copy) throw new Error(`${url.host} is not a Madar copy.`);
  if (copy === 'production' && !production) throw new Error('Production needs --production, and the owner says yes first.');
  return { copy, base: COPY_HOSTS[copy].page };
}

export type PlatformAccountIo = {
  /** A hidden prompt: the typed text is not shown. */
  prompt(label: string): Promise<string>;
  /** The ops of the target. Default: the real ops route with the secret of the copy. */
  ops?(target: { copy: Copy | 'local'; base: string }): OfficeOps;
  log(line: string): void;
};

type Answer = { ok: true; account: { id: string; name: string; email: string; state: string } };

export async function runPlatformAccount(argv: readonly string[], io: PlatformAccountIo): Promise<void> {
  const args = platformAccountArgs(argv);
  const target = platformTargetOf(args.to, args.production);
  let ops: OfficeOps;
  if (io.ops) {
    ops = io.ops(target);
  } else {
    const secret = copyValuesOf(target.copy).MADAR_OPS_SECRET;
    if (!secret) throw new Error('MADAR_OPS_SECRET is not set for this copy (scripts/office/new-secret.ts).');
    ops = opsOf({ base: target.base, secret, header: OPS_SECRET_HEADER });
  }
  // The password is asked before any request, so a short or different one stops the script with nothing sent.
  const password = args.action === 'create' || args.action === 'password'
    ? checkedPassword(await io.prompt('Password: '), await io.prompt('Password again: '))
    : undefined;
  const body = { action: args.action, email: args.email, ...(args.name !== undefined ? { name: args.name } : {}), ...(password !== undefined ? { password } : {}) };
  const answer = await ops.post<Answer>('platform-accounts', body);
  io.log(`Platform account ${answer.account.id} (${answer.account.email}) is ${answer.account.state === 'active' ? 'on' : 'off'}.`);
}

/** A prompt that does not show what is typed. It needs a terminal: it never reads a password from a pipe. */
export function hiddenPrompt(label: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.reject(new Error('The password needs a terminal. Run the script in your own Terminal.'));
  process.stderr.write(label);
  return new Promise((resolve, reject) => {
    let text = '';
    const done = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          done();
          resolve(text);
          return;
        }
        if (char === '\u0003') {
          done();
          reject(new Error('Stopped.'));
          return;
        }
        text = char === '\u007f' || char === '\b' ? text.slice(0, -1) : text + char;
      }
    };
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  runPlatformAccount(process.argv.slice(2), { prompt: hiddenPrompt, log: (line) => console.log(line) }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
