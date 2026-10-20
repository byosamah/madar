import { describe, expect, it } from 'vitest';
import { addGoogleLines, googleLinesOf, makeGoogleSecrets } from './setup-secrets.ts';

/** scripts/google/setup-secrets.ts (fbk_022): the two client values from .env.local and a new key go to secrets/<env>.env. All values here are made up. */

const ID = '123456789012-madeupmadeupmadeup.apps.googleusercontent.com';
const SECRET = 'GOCSPX-made-up-secret-value';
const LOCAL = `# local\nSOME_OTHER=1\nGOOGLE_CLIENT_ID=${ID}\nGOOGLE_CLIENT_SECRET="${SECRET}"\n`;

describe('googleLinesOf', () => {
  it('reads the two client values, also in quotes, and checks their shape', () => {
    expect(googleLinesOf(LOCAL)).toEqual({ clientId: ID, clientSecret: SECRET });
  });

  it('names the variable that is missing or wrong, and never a value', () => {
    expect(() => googleLinesOf(`GOOGLE_CLIENT_SECRET=${SECRET}`)).toThrow(/GOOGLE_CLIENT_ID/);
    expect(() => googleLinesOf(`GOOGLE_CLIENT_ID=${ID}`)).toThrow(/GOOGLE_CLIENT_SECRET/);
    const message = (() => {
      try {
        googleLinesOf(`GOOGLE_CLIENT_ID=plain-id-value\nGOOGLE_CLIENT_SECRET=${SECRET}`);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    })();
    expect(message).toMatch(/GOOGLE_CLIENT_ID/);
    expect(message).not.toContain('plain-id-value');
    expect(() => googleLinesOf(`GOOGLE_CLIENT_ID=${ID}\nGOOGLE_CLIENT_SECRET=two words`)).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('ignores a commented line', () => {
    expect(() => googleLinesOf(`# GOOGLE_CLIENT_ID=${ID}\nGOOGLE_CLIENT_SECRET=${SECRET}`)).toThrow(/GOOGLE_CLIENT_ID/);
  });
});

describe('addGoogleLines', () => {
  const KEY = Buffer.alloc(32, 5);

  it('appends the three lines, keeps every old line, and ends with a newline', () => {
    const out = addGoogleLines('DATABASE_URL=x\nJOBS_SECRET=y', { clientId: ID, clientSecret: SECRET }, KEY);
    expect(out.startsWith('DATABASE_URL=x\nJOBS_SECRET=y\n')).toBe(true);
    expect(out).toContain(`GOOGLE_CLIENT_ID=${ID}\n`);
    expect(out).toContain(`GOOGLE_CLIENT_SECRET=${SECRET}\n`);
    expect(out).toContain(`MADAR_GOOGLE_KEY=${KEY.toString('base64')}\n`);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('refuses when one of the three lines is there already, and names the variable and not the value', () => {
    const error = (() => {
      try {
        addGoogleLines('MADAR_GOOGLE_KEY=already-here-secret\n', { clientId: ID, clientSecret: SECRET }, KEY);
      } catch (e) {
        return e as Error;
      }
      return undefined;
    })();
    expect(error?.message).toMatch(/MADAR_GOOGLE_KEY/);
    expect(error?.message).not.toContain('already-here-secret');
  });

  it('does not take a commented name for a line', () => {
    expect(() => addGoogleLines('# MADAR_GOOGLE_KEY=old\n', { clientId: ID, clientSecret: SECRET }, KEY)).not.toThrow();
  });
});

describe('makeGoogleSecrets', () => {
  it('makes a new 32 byte key for each run, so test and production never share one', async () => {
    const a = await makeGoogleSecrets('test', { secrets: '', local: LOCAL });
    const b = await makeGoogleSecrets('production', { secrets: '', local: LOCAL });
    const keyOf = (text: string) => /^MADAR_GOOGLE_KEY=(.*)$/m.exec(text)![1];
    expect(keyOf(a.secrets)).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(keyOf(a.secrets)).not.toBe(keyOf(b.secrets));
  });

  it('prints names only: the report holds no value', async () => {
    const made = await makeGoogleSecrets('test', { secrets: 'JOBS_SECRET=jobs-made-up\n', local: LOCAL });
    const report = made.report.join('\n');
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MADAR_GOOGLE_KEY']) expect(report).toContain(name);
    for (const value of [ID, SECRET, 'jobs-made-up', /^MADAR_GOOGLE_KEY=(.*)$/m.exec(made.secrets)![1]]) expect(report).not.toContain(value);
  });

  it('refuses a target other than test or production, and a second run', async () => {
    await expect(makeGoogleSecrets('staging' as never, { secrets: '', local: LOCAL })).rejects.toThrow(/test or production/);
    const first = await makeGoogleSecrets('test', { secrets: '', local: LOCAL });
    await expect(makeGoogleSecrets('test', { secrets: first.secrets, local: LOCAL })).rejects.toThrow(/already/);
  });
});
