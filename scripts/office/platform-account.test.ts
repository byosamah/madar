import { describe, expect, it } from 'vitest';
import { httpOf, nodeWorld } from '../../server/office/test/nodeWorld';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { checkedPassword, platformAccountArgs, platformTargetOf, runPlatformAccount, type PlatformAccountIo } from './platform-account';
import type { OfficeOps } from './ops';

const GOOD = 'a long platform password';

describe('the arguments', () => {
  it('make an account with --name, and read the page address and the email', () => {
    expect(platformAccountArgs(['--to', 'https://preview.madar-platform.pages.dev', '--email', ' me@x.test ', '--name', 'Osama'])).toEqual({
      to: 'https://preview.madar-platform.pages.dev', email: 'me@x.test', name: 'Osama', action: 'create', production: false,
    });
  });

  it('read --password, --off and --on as the action', () => {
    const base = ['--to', 'https://preview.madar-platform.pages.dev', '--email', 'me@x.test'];
    expect(platformAccountArgs([...base, '--password']).action).toBe('password');
    expect(platformAccountArgs([...base, '--off']).action).toBe('off');
    expect(platformAccountArgs([...base, '--on', '--production']).production).toBe(true);
  });

  it('refuse a missing address, a missing email, no action, two actions, and --name with another action', () => {
    expect(() => platformAccountArgs(['--email', 'me@x.test', '--name', 'A'])).toThrow('Use:');
    expect(() => platformAccountArgs(['--to', 'https://x.test'])).toThrow('Use:');
    expect(() => platformAccountArgs(['--to', 'https://x.test', '--email', 'me@x.test'])).toThrow('give --name');
    expect(() => platformAccountArgs(['--to', 'https://x.test', '--email', 'me@x.test', '--off', '--on'])).toThrow('only one');
    expect(() => platformAccountArgs(['--to', 'https://x.test', '--email', 'me@x.test', '--off', '--name', 'A'])).toThrow('--name is only');
  });

  it('refuse an argument it does not know, and never take the password as an argument', () => {
    expect(() => platformAccountArgs(['--to', 'https://x.test', '--email', 'me@x.test', '--name', 'A', '--secret'])).toThrow('not known');
    expect(() => platformAccountArgs(['--to', 'https://x.test', '--email', 'me@x.test', '--password', GOOD])).toThrow('not known');
  });
});

describe('the password', () => {
  it('accepts 12 characters that match', () => {
    expect(checkedPassword('a'.repeat(12), 'a'.repeat(12))).toBe('a'.repeat(12));
  });

  it('refuses under 12 characters and two different entries, with an error that does not hold the password', () => {
    const short = 'short-secret';
    let message = '';
    try {
      checkedPassword(short.slice(0, 11), short.slice(0, 11));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('at least 12');
    expect(message).not.toContain(short.slice(0, 11));
    expect(() => checkedPassword(GOOD, `${GOOD}!`)).toThrow('not the same');
    try {
      checkedPassword(GOOD, `${GOOD}!`);
    } catch (error) {
      expect((error as Error).message).not.toContain(GOOD);
    }
  });
});

describe('the target', () => {
  it('maps the platform site to the company address of its copy', () => {
    expect(platformTargetOf('https://preview.madar-platform.pages.dev', false)).toEqual({ copy: 'test', base: 'https://preview.madar-46r.pages.dev' });
    expect(platformTargetOf('https://preview.madar-46r.pages.dev', false)).toEqual({ copy: 'test', base: 'https://preview.madar-46r.pages.dev' });
    expect(platformTargetOf('http://127.0.0.1:8787', false)).toEqual({ copy: 'local', base: 'http://127.0.0.1:8787' });
  });

  it('refuses production without --production, a plain http address, and a host that is no copy', () => {
    expect(() => platformTargetOf('https://platform.madar.vado.sa', false)).toThrow('--production');
    expect(() => platformTargetOf('https://madar-platform.pages.dev', false)).toThrow('--production');
    expect(platformTargetOf('https://platform.madar.vado.sa', true)).toEqual({ copy: 'production', base: 'https://madar.vado.sa' });
    expect(() => platformTargetOf('http://preview.madar-platform.pages.dev', false)).toThrow('https');
    expect(() => platformTargetOf('https://example.com', false)).toThrow('not a Madar copy');
  });
});

describe('the run', () => {
  /** The ops of the script into the real Worker routes of a node world, with the ops secret in the header. */
  async function setup(typed: string[]) {
    const t = await nodeWorld({ env: { MADAR_OPS_SECRET: 'ops-secret' }, sleep: async () => undefined });
    const sent: string[] = [];
    const lines: string[] = [];
    const prompts: string[] = [];
    const ops: OfficeOps = {
      async post<T>(op: string, body: unknown): Promise<T> {
        sent.push(JSON.stringify(body));
        const answer = await t.route(httpOf('POST', `/api/office/${op}`, body, { [OPS_SECRET_HEADER]: 'ops-secret' }));
        if (answer.status !== 200) throw new Error(`The office op ${op} answered ${answer.status}: ${answer.body}`);
        return JSON.parse(answer.body) as T;
      },
    };
    const io: PlatformAccountIo = { prompt: async (label) => (prompts.push(label), typed.shift() ?? ''), ops: () => ops, log: (line) => lines.push(line) };
    return { t, io, sent, lines, prompts };
  }
  const BASE = ['--to', 'https://preview.madar-platform.pages.dev', '--email', 'boss@platform.test'];

  it('makes an account, asks for the password twice, sends it once, and prints no password', async () => {
    const { t, io, sent, lines, prompts } = await setup([GOOD, GOOD]);
    await runPlatformAccount([...BASE, '--name', 'The Boss'], io);
    expect(prompts).toEqual(['Password: ', 'Password again: ']);
    expect(sent).toHaveLength(1);
    expect(lines).toEqual(['Platform account pla_001 (boss@platform.test) is on.']);
    expect(lines.join('\n')).not.toContain(GOOD);
    const signin = await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email: 'boss@platform.test', password: GOOD }));
    expect(signin.status).toBe(200);
    // No log line of the Worker, and no row of the platform object, holds the password.
    expect(t.lines.join('\n')).not.toContain(GOOD);
    expect(JSON.stringify(t.platformRaw.prepare('select * from platform_accounts').all())).not.toContain(GOOD);
  });

  it('stops before any request on a short password or two different passwords', async () => {
    const short = await setup(['short', 'short']);
    await expect(runPlatformAccount([...BASE, '--name', 'A'], short.io)).rejects.toThrow('at least 12');
    expect(short.sent).toEqual([]);
    const other = await setup([GOOD, 'another long password']);
    await expect(runPlatformAccount([...BASE, '--name', 'A'], other.io)).rejects.toThrow('not the same');
    expect(other.sent).toEqual([]);
  });

  it('sets a new password, which ends every session, and the old password stops working', async () => {
    const { t, io } = await setup([GOOD, GOOD, 'another long password', 'another long password']);
    await runPlatformAccount([...BASE, '--name', 'A'], io);
    const first = JSON.parse((await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email: 'boss@platform.test', password: GOOD }))).body);
    await runPlatformAccount([...BASE, '--password'], io);
    expect((await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token }))).status).toBe(401);
    expect((await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email: 'boss@platform.test', password: GOOD }))).status).toBe(401);
    expect((await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email: 'boss@platform.test', password: 'another long password' }))).status).toBe(200);
  });

  it('turns an account off and on with no password prompt', async () => {
    const { t, io, prompts, lines } = await setup([GOOD, GOOD]);
    await runPlatformAccount([...BASE, '--name', 'A'], io);
    prompts.length = 0;
    await runPlatformAccount([...BASE, '--off'], io);
    expect(prompts).toEqual([]);
    expect(lines.at(-1)).toBe('Platform account pla_001 (boss@platform.test) is off.');
    expect((await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email: 'boss@platform.test', password: GOOD }))).status).toBe(401);
    await runPlatformAccount([...BASE, '--on'], io);
    expect((await t.route(httpOf('POST', '/api/platform/auth/token', { grant_type: 'password', email: 'boss@platform.test', password: GOOD }))).status).toBe(200);
  });
});
