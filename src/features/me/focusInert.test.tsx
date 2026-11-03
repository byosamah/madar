import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

const asMember = (state: State) => {
  state.session.currentUserId = 'usr_005';
};

// This test pins the contract line "PhoneTabBar keeps data-pill": Focus mode (features/focus/FocusMode.tsx) finds the bar by the
// selector nav[data-pill]. On a phone the shell also takes the bar off the page while Focus mode is open (usePhoneBarHide), so the
// bar is either gone or inert, and never a live control behind the focus page. If the first check fails, the phone bar lost
// data-pill: report it to the lead and do not edit FocusMode.tsx.
describe('Focus mode on a phone', () => {
  it('keeps the data-pill mark on the phone bar, and leaves no live bar or page behind Focus mode', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/projects/prj_001?tab=tasks', asMember);
    await screen.findByRole('tab', { name: 'To-dos' });
    const bar = document.querySelector<HTMLElement>('nav[data-pill]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAccessibleName('Main navigation');
    // The phone bar has four tabs with words.
    expect(bar!.querySelectorAll('a')).toHaveLength(4);

    await act(async () => { await router.navigate('/projects/prj_001?tab=tasks&focus=tsk_012'); });
    await screen.findByRole('dialog', { name: 'Focus' });
    const behind = document.querySelector<HTMLElement>('nav[data-pill]');
    expect(behind === null || behind.inert).toBe(true);
    expect(document.querySelector('.app-page')).toHaveProperty('inert', true);

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Focus' })).toBeNull());
    await waitFor(() => expect(document.querySelector('.app-page')).toHaveProperty('inert', false));
    // jsdom has no inert property: Focus mode sets it by hand on the bar it found, and React writes the inert attribute. After the close the
    // bar is often a new element (it left the page while Focus mode showed), whose property reads undefined. A browser reads the attribute,
    // so the bar is live when neither the attribute nor the hand-set value says inert (2026-11-03: the old check failed under load).
    await waitFor(() => {
      const back = document.querySelector<HTMLElement>('nav[data-pill]');
      expect(back).not.toBeNull();
      expect(back!.inert === true || back!.hasAttribute('inert')).toBe(false);
    });
  });
});
