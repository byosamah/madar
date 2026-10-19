import { describe, expect, it } from 'vitest';
import { GOOGLE_NAMES, SealBroken, googleConfigOf, googleKeysOf, openToken, sealToken } from './keys';

/** The sealed refresh token of Google Calendar (fbk_022, owner 2026-10-19). Every key and token here is made up. */

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const TOKEN = '1//0gRefreshTokenSECRET-abc_123';

describe('googleConfigOf', () => {
  it('names the three values', () => {
    expect([...GOOGLE_NAMES]).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MADAR_GOOGLE_KEY']);
  });

  it('gives no config when none of the three is set: Google is off', () => {
    expect(googleConfigOf(() => undefined)).toBeUndefined();
  });

  it('reads the three values when all are set', () => {
    const values: Record<string, string> = { GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'cs-made-up', MADAR_GOOGLE_KEY: KEY };
    expect(googleConfigOf((name) => values[name])).toEqual({ clientId: 'id.apps.googleusercontent.com', clientSecret: 'cs-made-up', key: KEY });
  });

  it('names each absent value when only some are set, and never a value', () => {
    const values: Record<string, string> = { GOOGLE_CLIENT_SECRET: 'cs-made-up' };
    try {
      googleConfigOf((name) => values[name]);
      throw new Error('It must refuse.');
    } catch (error) {
      expect((error as Error).message).toContain('GOOGLE_CLIENT_ID');
      expect((error as Error).message).toContain('MADAR_GOOGLE_KEY');
      expect((error as Error).message).not.toContain('cs-made-up');
    }
  });
});

describe('sealToken and openToken', () => {
  it('opens the token that it sealed, for the same person and the same key', async () => {
    const keys = await googleKeysOf(KEY);
    const sealed = await sealToken(keys, 'usr_003', TOKEN);
    expect(await openToken(keys, 'usr_003', sealed)).toBe(TOKEN);
  });

  it('makes a text of the form v1.<iv>.<cipher> that holds no part of the token', async () => {
    const keys = await googleKeysOf(KEY);
    const sealed = await sealToken(keys, 'usr_003', TOKEN);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    for (const part of ['RefreshToken', 'SECRET', 'abc_123', '1//0g']) expect(sealed).not.toContain(part);
  });

  it('makes a different text each time for one token', async () => {
    const keys = await googleKeysOf(KEY);
    expect(await sealToken(keys, 'usr_003', TOKEN)).not.toBe(await sealToken(keys, 'usr_003', TOKEN));
  });

  it('throws SealBroken for another person, another key or a changed character, and the message holds no part of the token', async () => {
    const keys = await googleKeysOf(KEY);
    const sealed = await sealToken(keys, 'usr_003', TOKEN);
    const changed = `${sealed.slice(0, -2)}${sealed.endsWith('A') ? 'B' : 'A'}${sealed.slice(-1)}`;
    const otherKeys = await googleKeysOf(OTHER_KEY);
    const attempts = [
      () => openToken(keys, 'usr_004', sealed),
      () => openToken(otherKeys, 'usr_003', sealed),
      () => openToken(keys, 'usr_003', changed),
      () => openToken(keys, 'usr_003', 'not a sealed text'),
      () => openToken(keys, 'usr_003', 'v2.AAAAAAAAAAAAAAAA.AAAA'),
    ];
    for (const attempt of attempts) {
      const error = await attempt().then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(SealBroken);
      expect((error as Error).message).not.toMatch(/RefreshToken|SECRET|usr_00/);
    }
  });

  it('keeps one cached key set for one key text', async () => {
    expect(await googleKeysOf(KEY)).toBe(await googleKeysOf(KEY));
  });

  it('refuses a key that is not 32 bytes in base64, and the error names the variable and not the value', async () => {
    const error = await googleKeysOf('too-short-key-value').then(() => undefined, (e: unknown) => e);
    expect((error as Error).message).toContain('MADAR_GOOGLE_KEY');
    expect((error as Error).message).not.toContain('too-short-key-value');
  });
});
