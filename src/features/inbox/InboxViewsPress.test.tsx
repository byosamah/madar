import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { stubPhone } from './phoneHarness';

const starts = vi.hoisted(() => ({ spy: vi.fn() }));
vi.mock('../../app/pressReads', () => ({ PRESS_READS: {}, usePressReads: () => starts.spy }));

describe('InboxViews starts the reads on pointer down', () => {
  it('starts the Notifications reads at pointer down, before the click ends', async () => {
    stubPhone();
    await renderApp('/inbox');
    const group = await screen.findByRole('radiogroup', { name: 'Inbox view' });
    starts.spy.mockClear();
    fireEvent.pointerDown(within(group).getByRole('radio', { name: /^Notifications/ }));
    expect(starts.spy).toHaveBeenCalledWith('/notifications');
    fireEvent.pointerDown(within(group).getByRole('radio', { name: /^Chats/ }));
    expect(starts.spy).toHaveBeenCalledWith('/inbox');
  });
});
