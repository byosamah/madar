import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { State } from '../../api/store';
import { renderHeldRemoteApp } from '../../test/heldRemoteApp';

const warm = vi.hoisted(() => vi.fn());
vi.mock('./HomeTaskSheet', async (importOriginal) => ({ ...(await importOriginal<typeof import('./HomeTaskSheet')>()), warmTaskSheet: warm }));

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

/**
 * The task panel chunk (21 files, about 115 KB gz) loads 1 s after Home shows its data, not 1 s after Home mounts (speed follow-up,
 * 2026-10-22). On a phone on 4G the old start sent it on the same line as the first answers, before the first rows.
 */
describe('the warm start of the Home task panel', () => {
  it('starts nothing while the first answers are on their way, and starts about 1 s after they came', async () => {
    warm.mockClear();
    const app = await renderHeldRemoteApp('/', as('usr_003'), { hold: true });
    await wait(1_400);
    expect(warm).not.toHaveBeenCalled();
    await act(async () => { app.release(); });
    await screen.findByRole('list', { name: 'Your projects' }, { timeout: 10_000 });
    await wait(300);
    expect(warm).not.toHaveBeenCalled();
    await wait(1_200);
    expect(warm).toHaveBeenCalledTimes(1);
  });
});
