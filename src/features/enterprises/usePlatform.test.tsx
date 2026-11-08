import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformApi } from '../../api/contract/platform';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../app/runtime';
import { PlatformProvider, usePlatform } from './usePlatform';

const api = {} as unknown as MadarApiStub;
type MadarApiStub = Runtime['api'];
const client = () => createQueryClient();
const wrap = (runtime: Runtime, given?: PlatformApi) =>
  function Wrap({ children }: { children: ReactNode }) {
    const inner = given ? <PlatformProvider api={given}>{children}</PlatformProvider> : children;
    return <RuntimeProvider runtime={runtime} queryClient={client()}>{inner}</RuntimeProvider>;
  };

describe('usePlatform (the prototype build keeps the real client out of its script)', () => {
  const platform = { 'platform.me': vi.fn() } as unknown as PlatformApi;

  it('gives the api of a PlatformProvider first', () => {
    const given = {} as unknown as PlatformApi;
    const { result } = renderHook(() => usePlatform(), { wrapper: wrap({ api, platform }, given) });
    expect(result.current).toBe(given);
  });

  it('gives the fake of the prototype runtime, also when the runtime names a config', () => {
    // A test and the prototype run with VITE_MADAR_API fake: the code of the real client is not part of this build, so the config is not used.
    const config = { url: 'https://example.test/api', build: '1', token: async () => 'token' };
    const { result } = renderHook(() => usePlatform(), { wrapper: wrap({ api, platform, platformConfig: config }) });
    expect(result.current).toBe(platform);
  });

  it('answers not_found for every platform call when the runtime has none', async () => {
    const { result } = renderHook(() => usePlatform(), { wrapper: wrap({ api }) });
    await expect(result.current['platform.me']({})).rejects.toMatchObject({ code: 'not_found' });
  });
});
