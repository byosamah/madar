import { describe, expect, it } from 'vitest';
import { insightEnv } from './insightEnv';

describe('insightEnv', () => {
  it('is production only on the production host', () => {
    expect(insightEnv('madar.vado.sa')).toBe('production');
    expect(insightEnv('www.madar.vado.sa')).toBe('production');
  });

  it('is test on every other host', () => {
    expect(insightEnv('preview.madar-46r.pages.dev')).toBe('test');
    expect(insightEnv('madar-46r.pages.dev')).toBe('test');
    expect(insightEnv('localhost')).toBe('test');
    expect(insightEnv('')).toBe('test');
  });
});
