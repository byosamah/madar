import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { State } from '../../api/store';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('the More tab of a project on a phone (phone D, P2)', () => {
  it('lists Activity, Schedule and Team as three links on the More tab', async () => {
    phoneMedia(true);
    await renderApp('/projects/prj_001?tab=more', as('usr_002'));
    const rows = await screen.findAllByRole('link', { name: /^(Activity|Schedule|Team)/ });
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '#/projects/prj_001?tab=activity',
      '#/projects/prj_001?tab=schedule',
      '#/projects/prj_001?tab=team',
    ]);
    expect(screen.getByText('Stage dates and deadlines.')).toBeInTheDocument();
  });

  it('opens a sub-page with a 44 px back row, and Back returns to the list', async () => {
    phoneMedia(true);
    const { router } = await renderApp('/projects/prj_001?tab=more', as('usr_002'));
    await userEvent.click(await screen.findByRole('link', { name: /^Schedule/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Schedule' })).toBeInTheDocument();
    const back = screen.getByRole('link', { name: 'More' });
    expect(back).toHaveAttribute('href', '#/projects/prj_001?tab=more');
    expect(back).toHaveClass('min-h-11');
    await act(async () => { await router.navigate(-1); });
    expect(await screen.findAllByRole('link', { name: /^Team/ })).not.toHaveLength(0);
  });

  it.each([['en', 'Activity', 'ltr'], ['ar', 'النشاط', 'rtl']])('slides a sub-page in by no more than the 16 px gutter, so the page never scrolls sideways (%s)', async (lang, title) => {
    phoneMedia(true);
    await renderApp('/projects/prj_001?tab=activity', (state) => {
      as('usr_002')(state);
      state.users.usr_002.preferences.language = lang as 'en' | 'ar';
    });
    const heading = await screen.findByRole('heading', { level: 2, name: title });
    const slider = heading.parentElement!.parentElement as HTMLElement;
    // The page has a 16 px gutter on each side. A start offset of 24 px put 8 px of the page outside the screen for a few frames.
    const offset = /translateX\((-?[\d.]+)px\)/.exec(slider.style.transform);
    expect(offset, 'the slide has its offset in the style').not.toBeNull();
    expect(Math.abs(Number(offset![1]))).toBeLessThanOrEqual(16);
  });

  it('opens the page named in the link, also after a reload', async () => {
    phoneMedia(true);
    await renderApp('/projects/prj_001?tab=team', as('usr_002'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Team' })).toBeInTheDocument();
  });

  it('keeps the desk as it is: ?tab=more opens Overview', async () => {
    await renderApp('/projects/prj_001?tab=more');
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('writes the rows in Arabic', async () => {
    phoneMedia(true);
    await renderApp('/projects/prj_001?tab=more', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    expect(await screen.findByRole('link', { name: /^النشاط/ })).toBeInTheDocument();
    expect(screen.getByText('من يعمل في هذا المشروع.')).toBeInTheDocument();
  });
});
