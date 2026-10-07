import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { MadarApi } from '../api/calls';
import { usePrefetchCall } from './prefetch';
import { RuntimeProvider, createQueryClient } from './runtime';

function setup(mode: 'remote' | 'prototype') {
  const call = vi.fn(async () => ({ id: 'tsk_001' }));
  const api = { call } as unknown as MadarApi;
  const client = createQueryClient({ remote: mode === 'remote' });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RuntimeProvider runtime={{ api, mode }} queryClient={client}>
      {children}
    </RuntimeProvider>
  );
  const { result } = renderHook(() => usePrefetchCall(), { wrapper });
  return { call, client, prefetch: result.current };
}

describe('usePrefetchCall', () => {
  it('fills the cache under the exact key of useCall in the remote build', async () => {
    const { call, client, prefetch } = setup('remote');
    prefetch('tasks.get', { id: 'tsk_001' });
    await waitFor(() => expect(client.getQueryData(['api', 'tasks.get', { id: 'tsk_001' }])).toEqual({ id: 'tsk_001' }));
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('tasks.get', { id: 'tsk_001' });
  });

  it('does not ask again for an answer that the cache holds', async () => {
    const { call, client, prefetch } = setup('remote');
    prefetch('tasks.get', { id: 'tsk_001' });
    await waitFor(() => expect(client.getQueryData(['api', 'tasks.get', { id: 'tsk_001' }])).toBeDefined());
    prefetch('tasks.get', { id: 'tsk_001' });
    await Promise.resolve();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('asks nothing in the prototype', async () => {
    const { call, prefetch } = setup('prototype');
    prefetch('tasks.get', { id: 'tsk_001' });
    await Promise.resolve();
    expect(call).not.toHaveBeenCalled();
  });
});
