import { describe, expect, it } from 'vitest';
import { DaftraConfigError, daftraAccountsIn, daftraConfigOf, daftraMissing, isDaftraName } from './config';

const reader = (values: Record<string, string>) => (name: string) => values[name];
const KEY = (letter: string) => letter.repeat(40);

describe('the Daftra accounts of the environment', () => {
  it('finds each account once, from the name of either of its two values', () => {
    expect(daftraAccountsIn(['DAFTRA_MAZJ_KEY', 'DAFTRA_MAZJ_SITE', 'DAFTRA_BUNAH_KEY', 'DATABASE_URL', 'DAFTRA_ZURAA_SITE'])).toEqual(['BUNAH', 'MAZJ', 'ZURAA']);
  });

  it('knows a secret name by the pattern and not by a fixed list', () => {
    for (const name of ['DAFTRA_MAZJ_KEY', 'DAFTRA_VADO_SITE', 'DAFTRA_NEWCO2_KEY']) expect(isDaftraName(name), name).toBe(true);
    for (const name of ['DAFTRA_SITE', 'DAFTRA_mazj_KEY', 'DAFTRA_MAZJ_TOKEN', 'DAFTRA__KEY', 'XDAFTRA_MAZJ_KEY', 'DAFTRA_1A_KEY']) {
      expect(isDaftraName(name), name).toBe(false);
    }
  });

  it('reads every pair into config, by account name', () => {
    const values = { DAFTRA_MAZJ_KEY: KEY('a'), DAFTRA_MAZJ_SITE: 'mazj.daftra.com', DAFTRA_VADO_KEY: KEY('b'), DAFTRA_VADO_SITE: 'vado.daftara.com', DATABASE_URL: 'x' };
    expect(daftraConfigOf(reader(values), Object.keys(values))).toEqual({
      MAZJ: { key: KEY('a'), site: 'mazj.daftra.com' },
      VADO: { key: KEY('b'), site: 'vado.daftara.com' },
    });
  });

  it('leaves Daftra off (undefined) when no pair is set', () => {
    expect(daftraConfigOf(reader({}), [])).toBeUndefined();
    expect(daftraConfigOf(reader({ DATABASE_URL: 'x' }), ['DATABASE_URL'])).toBeUndefined();
  });

  it('names the missing half of each account that has one half only, and never a value', () => {
    const values = { DAFTRA_MAZJ_KEY: KEY('a'), DAFTRA_VADO_SITE: 'vado.daftra.com', DAFTRA_ZURAA_KEY: KEY('c'), DAFTRA_ZURAA_SITE: 'z.daftra.com' };
    expect(daftraMissing(reader(values), Object.keys(values))).toEqual(['DAFTRA_MAZJ_SITE', 'DAFTRA_VADO_KEY']);
    let message = '';
    try {
      daftraConfigOf(reader(values), Object.keys(values));
    } catch (error) {
      expect(error).toBeInstanceOf(DaftraConfigError);
      message = (error as Error).message;
    }
    expect(message).toContain('DAFTRA_MAZJ_SITE');
    expect(message).toContain('DAFTRA_VADO_KEY');
    for (const value of [KEY('a'), 'vado.daftra.com', KEY('c')]) expect(message).not.toContain(value);
  });
});
