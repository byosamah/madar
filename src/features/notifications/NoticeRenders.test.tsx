import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import type { State } from '../../api/store';
import { setNow } from '../../lib/dates';
import { renderApp } from '../../test/render';

// The notice list with 100 notices (performance audit 2026-10-21, RN-7). Marking one notice read reloaded the list and rendered every row
// again, and each row holds three mutation observers. A row with an actor draws one Avatar, so the Avatar count is the count of row bodies.
const counts = vi.hoisted(() => ({ faces: 0 }));
vi.mock('../../components/Avatar', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/Avatar')>();
  return { ...real, Avatar: (props: Parameters<typeof real.Avatar>[0]) => { counts.faces += 1; return createElement(real.Avatar, props); } };
});

const COUNT = 100;
function hundred(state: State) {
  state.session.currentUserId = 'usr_005';
  for (const [id, n] of Object.entries(state.notifications)) if (n.userId === 'usr_005') delete state.notifications[id];
  for (let n = 0; n < COUNT; n += 1) {
    const id = `ntf_9${String(n).padStart(3, '0')}`;
    state.notifications[id] = {
      id, userId: 'usr_005', trigger: 'task_assigned', actorId: 'usr_002', targetType: 'task', targetId: 'tsk_012', read: false,
      createdAt: '2026-09-30T08:00:00.000+03:00', dedupeKey: null,
    };
  }
}

async function settled(): Promise<number> {
  let last = -1;
  while (last !== counts.faces) {
    last = counts.faces;
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 80); }));
  }
  return counts.faces;
}

describe('the notice list with 100 notices (RN-7)', () => {
  it('renders one row when one notice changes, and the other rows still show the new age', async () => {
    const { store, queryClient } = await renderApp('/notifications', hundred);
    await screen.findAllByText(/gave you/, undefined, { timeout: 20_000 });
    const before = await settled();
    expect(before).toBeGreaterThanOrEqual(COUNT);
    expect(screen.getAllByText('1h').length).toBe(COUNT);
    // Two hours pass, then one notice turns read. The list loads again, and only that row renders its body again.
    setNow(new Date('2026-09-30T08:00:00Z'));
    store.state.notifications.ntf_9004!.read = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['api', 'notifications.list'] });
    });
    const after = await settled();
    // Before the fix this was every row (100 and more). Two is room for the row and a neighbour.
    expect(after - before).toBeLessThanOrEqual(2);
    // Age reads the clock in the same renders as before the memo (AgeRefresh): the age of a row that did not change moves on.
    expect(screen.getAllByText('3h').length).toBe(COUNT);
  }, 120_000);
});
