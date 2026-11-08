import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { renderHeldRemoteApp } from '../../test/heldRemoteApp';
import { phoneMedia } from '../../test/phoneMedia';
import { PROJECT_VIEW_KEY } from '../projects/projectView';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const isBox = (link: HTMLElement) => link.hasAttribute('data-project-box');

// fbk_080 (owner, 2026-11-05): Your projects on a desk Home shows rows or boxes. The choice is the one of the Projects page.
describe('Your projects on Home: rows or boxes', () => {
  it('shows rows at first, with a quiet round toggle beside the count', async () => {
    await renderApp('/', as('usr_002'));
    const region = await screen.findByRole('region', { name: 'Your projects' });
    const list = within(region).getByRole('list', { name: 'Your projects' });
    expect(within(list).getAllByRole('link').some(isBox)).toBe(false);
    const toggle = within(region).getByRole('button', { name: 'Show as boxes' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // fbk_082: the desk Home shows a quiet 32 px disc with a 44 px press area (an after: strip), and a title for the mouse.
    expect(toggle).toHaveClass('size-8', 'rounded-full', 'text-ink-2', 'after:-inset-1.5');
    expect(toggle).not.toHaveClass('size-11');
    expect(toggle).toHaveAttribute('title', 'Show as boxes');
    expect(toggle.className).not.toContain('-my-2');
  });

  it('switches to boxes with one press, keeps the choice, and presses back to rows', async () => {
    await renderApp('/', as('usr_002'));
    const region = await screen.findByRole('region', { name: 'Your projects' });
    await userEvent.click(within(region).getByRole('button', { name: 'Show as boxes' }));
    const toggle = within(region).getByRole('button', { name: 'Show as boxes' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const list = within(region).getByRole('list', { name: 'Your projects' });
    expect(list.className).toContain('grid');
    expect(within(list).getAllByRole('link').every(isBox)).toBe(true);
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe('boxes');
    await userEvent.click(toggle);
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe('rows');
    expect(within(within(region).getByRole('list', { name: 'Your projects' })).getAllByRole('link').some(isBox)).toBe(false);
  });

  it('shows boxes at once when the Projects page chose them', async () => {
    window.localStorage.setItem(PROJECT_VIEW_KEY, 'boxes');
    await renderApp('/', as('usr_002'));
    const region = await screen.findByRole('region', { name: 'Your projects' });
    expect(within(within(region).getByRole('list', { name: 'Your projects' })).getAllByRole('link').every(isBox)).toBe(true);
    expect(within(region).getByRole('button', { name: 'Show as boxes' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows no toggle and sends no projects.list read on a phone', async () => {
    phoneMedia(true);
    window.localStorage.setItem(PROJECT_VIEW_KEY, 'boxes');
    const app = await renderHeldRemoteApp('/', as('usr_003'), { hold: true });
    app.release();
    await screen.findByRole('region', { name: 'Next for you' });
    expect(screen.queryByRole('button', { name: 'Show as boxes' })).toBeNull();
    expect(app.asked.map((call) => call.name)).not.toContain('projects.list');
  });
});
