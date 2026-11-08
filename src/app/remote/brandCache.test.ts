import { describe, expect, it, vi } from 'vitest';
import { BRAND_CACHE, BRAND_KEY, saveBrand } from './brandCache';

describe('saveBrand', () => {
  it('writes the two names as JSON into the cache madar-brand', async () => {
    const put = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({ put }));
    await saveBrand({ name: 'Acme', nameAr: 'أكمي' }, { open } as unknown as CacheStorage);
    expect(open).toHaveBeenCalledWith(BRAND_CACHE);
    const [key, response] = put.mock.calls[0] as unknown as [string, Response];
    expect(key).toBe(BRAND_KEY);
    expect(await response.json()).toEqual({ name: 'Acme', nameAr: 'أكمي' });
  });

  it('swallows a failing cache and a missing cache storage', async () => {
    await expect(saveBrand({ name: 'A', nameAr: 'ب' }, { open: async () => { throw new Error('No room.'); } } as unknown as CacheStorage)).resolves.toBeUndefined();
    await expect(saveBrand({ name: 'A', nameAr: 'ب' }, undefined)).resolves.toBeUndefined();
  });
});
