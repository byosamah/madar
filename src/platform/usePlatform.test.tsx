import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { PlatformApi } from '../api/contract/platform';
import { PlatformProvider, usePlatform } from './usePlatform';

describe('usePlatform', () => {
  it('gives the api of a PlatformProvider', () => {
    const given = {} as unknown as PlatformApi;
    const { result } = renderHook(() => usePlatform(), { wrapper: ({ children }: { children: ReactNode }) => <PlatformProvider api={given}>{children}</PlatformProvider> });
    expect(result.current).toBe(given);
  });

  it('answers not_found for every platform call when there is no provider', async () => {
    const { result } = renderHook(() => usePlatform());
    await expect(result.current['platform.me']({})).rejects.toMatchObject({ code: 'not_found' });
  });
});
