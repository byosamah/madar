import { describe, expect, it } from 'vitest';
import { base64urlDecode, makeVapidKeys } from '../../server/push/vapid.ts';
import { addPublicValue, addSecretLines, makeVapid, subjectOf } from './make-vapid.ts';

/** scripts/push/make-vapid.ts (owner, 2026-10-08): a P-256 key pair for browser push, written to the env files, public key shown only. */

const PRIVATE_LINES = /^VAPID_PRIVATE_KEY=[\w-]{43}$/m;

describe('makeVapid', () => {
  it('appends the three function secrets to the secrets file and sets the public key in the public file', async () => {
    const files = { secrets: 'DATABASE_URL=postgres://made-up\nJOBS_SECRET=jobs-made-up\n', publicEnv: '# public\nVITE_API_URL=https://x.supabase.co/functions/v1/api\n' };
    const out = await makeVapid('test', files);
    expect(out.secrets.startsWith(files.secrets)).toBe(true);
    expect(out.secrets).toMatch(PRIVATE_LINES);
    expect(out.secrets).toMatch(/^VAPID_PUBLIC_KEY=[\w-]{87}$/m);
    expect(out.secrets).toMatch(/^VAPID_SUBJECT=mailto:madar@vado\.sa$/m);
    expect(out.secrets.endsWith('\n')).toBe(true);
    expect(out.publicEnv).toContain(`VITE_VAPID_PUBLIC_KEY=${out.publicKey}`);
    expect(out.publicEnv.startsWith(files.publicEnv)).toBe(true);
    // The public key in both files is the same one, a real P-256 point.
    expect(out.secrets).toContain(`VAPID_PUBLIC_KEY=${out.publicKey}`);
    const point = base64urlDecode(out.publicKey);
    expect([point.length, point[0]]).toEqual([65, 4]);
  });

  it('prints the public key only: the result holds no private value in its report lines', async () => {
    const out = await makeVapid('production', { secrets: 'JOBS_SECRET=jobs-made-up\n', publicEnv: '' });
    const privateKey = PRIVATE_LINES.exec(out.secrets)![0].split('=')[1];
    expect(out.report.join('\n')).toContain(out.publicKey);
    expect(out.report.join('\n')).not.toContain(privateKey);
    expect(out.report.join('\n')).not.toContain('jobs-made-up');
  });

  it('makes a different pair every time, so test and production never share a key', async () => {
    const a = await makeVapid('test', { secrets: '', publicEnv: '' });
    const b = await makeVapid('production', { secrets: '', publicEnv: '' });
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(PRIVATE_LINES.exec(a.secrets)![0]).not.toBe(PRIVATE_LINES.exec(b.secrets)![0]);
  });

  it('refuses to replace a key that the secrets file already has, and names the variable, never a value', async () => {
    const files = { secrets: 'VAPID_PRIVATE_KEY=already-here-secret\n', publicEnv: '' };
    const error = await makeVapid('test', files).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/VAPID_PRIVATE_KEY/);
    expect((error as Error).message).not.toContain('already-here-secret');
  });

  it('refuses a target other than test or production', async () => {
    await expect(makeVapid('staging' as never, { secrets: '', publicEnv: '' })).rejects.toThrow(/test or production/);
  });
});

describe('addSecretLines', () => {
  it('adds a newline first when the file does not end with one, and keeps every old line as it was', () => {
    const keys = { publicKey: 'PUB', privateKey: 'PRIV', subject: 'mailto:madar@vado.sa' };
    expect(addSecretLines('A=1', keys)).toBe('A=1\nVAPID_PRIVATE_KEY=PRIV\nVAPID_PUBLIC_KEY=PUB\nVAPID_SUBJECT=mailto:madar@vado.sa\n');
    expect(addSecretLines('A=1\n', keys)).toBe('A=1\nVAPID_PRIVATE_KEY=PRIV\nVAPID_PUBLIC_KEY=PUB\nVAPID_SUBJECT=mailto:madar@vado.sa\n');
    expect(addSecretLines('', keys).startsWith('VAPID_PRIVATE_KEY=PRIV')).toBe(true);
  });

  it('does not take a commented line for a key', () => {
    expect(() => addSecretLines('# VAPID_PRIVATE_KEY=old\n', { publicKey: 'a', privateKey: 'b', subject: 'mailto:madar@vado.sa' })).not.toThrow();
  });
});

describe('addPublicValue', () => {
  it('replaces the old value of the public key and keeps the other lines', () => {
    const text = '# public\nVITE_VAPID_PUBLIC_KEY=OLD\nVITE_API_URL=https://x.supabase.co/functions/v1/api\n';
    expect(addPublicValue(text, 'NEW')).toBe('# public\nVITE_VAPID_PUBLIC_KEY=NEW\nVITE_API_URL=https://x.supabase.co/functions/v1/api\n');
  });

  it('adds the line at the end when there is none', () => {
    expect(addPublicValue('VITE_API_URL=x\n', 'NEW')).toBe('VITE_API_URL=x\nVITE_VAPID_PUBLIC_KEY=NEW\n');
    expect(addPublicValue('VITE_API_URL=x', 'NEW')).toBe('VITE_API_URL=x\nVITE_VAPID_PUBLIC_KEY=NEW\n');
  });
});

describe('subjectOf', () => {
  it('is the sender address of the mail of Madar', () => {
    expect(subjectOf()).toBe('mailto:madar@vado.sa');
  });

  it('is a valid pair partner: a key pair from makeVapidKeys has the sizes that the lines need', async () => {
    const keys = await makeVapidKeys();
    expect(keys.privateKey).toHaveLength(43);
    expect(keys.publicKey).toHaveLength(87);
  });
});
