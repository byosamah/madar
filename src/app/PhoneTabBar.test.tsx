import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { phoneMedia } from '../test/phoneMedia';
import { renderApp } from '../test/render';
import { rememberWorkView } from './lastList';
import { inboxName } from './PhoneTabBar';

/**
 * The phone bar (Direction D, 2026-10-22): four links, Today, Inbox, Work and Me. Each link shows only its icon, and its word
 * stays for screen readers (owner, 2026-10-22). These tests run at phone width through phoneMedia. A desk keeps the five-tab pill.
 */
afterEach(() => {
  rememberWorkView('/work');
  vi.restoreAllMocks();
});

const bar = () => document.querySelector('nav[data-pill]') as HTMLElement;
const wordOf = (link: HTMLElement) => link.querySelector('[data-tab-word]');

describe('the phone tab bar', () => {
  it('shows four icon links in the order Today, Inbox, Work, Me, with the word only for screen readers', async () => {
    phoneMedia(true);
    await renderApp('/');
    const links = within(bar()).getAllByRole('link');
    expect(links.map((l) => wordOf(l)?.textContent)).toEqual(['Today', 'Inbox', 'Work', 'Me']);
    for (const l of links) {
      // One 48 px cell for each tab, with the icon in its middle: no column for a word under the icon.
      expect(l).toHaveClass('h-12', 'flex-1', 'min-w-0', 'items-center', 'justify-center');
      expect(l).not.toHaveClass('flex-col');
      expect(wordOf(l)).toHaveClass('sr-only');
      const icon = l.querySelector('[data-tab-icon]') as HTMLElement;
      expect(icon).toHaveClass('[&_svg]:block');
      expect(icon.querySelector('svg')).toHaveAttribute('width', '24');
    }
    expect(within(bar()).getByRole('link', { name: 'Today' })).toBe(links[0]);
    expect(within(bar()).getByRole('link', { name: 'Me' })).toBe(links[3]);
    expect(bar()).toHaveClass('w-[calc(100vw-32px)]', 'bottom-[max(16px,env(safe-area-inset-bottom))]', 'p-1.5');
    expect(within(bar()).queryByRole('link', { name: /Search|Notifications|Dashboard/ })).toBeNull();
  });

  it.each([['/', 'Today'], ['/notifications', 'Inbox'], ['/projects/prj_001', 'Work'], ['/dashboard', 'Me']])('marks the open tab at %s', async (path, word) => {
    phoneMedia(true);
    await renderApp(path);
    const current = within(bar()).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(wordOf(current[0])?.textContent).toBe(word);
    const marks = bar().querySelectorAll('.signature');
    expect(marks).toHaveLength(1);
    expect(current[0]).toContainElement(marks[0] as HTMLElement);
    expect(marks[0]).toHaveClass('rounded-full');
  });

  it('has no open tab at /search', async () => {
    phoneMedia(true);
    await renderApp('/search');
    expect(within(bar()).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(0);
    expect(bar().querySelectorAll('.signature')).toHaveLength(0);
  });

  it('names the Inbox link with the counts, and shows one badge with their sum', async () => {
    phoneMedia(true);
    await renderApp('/');
    const inbox = await within(bar()).findByRole('link', { name: 'Inbox, Unread messages: 3, 1 item needs action' });
    await waitFor(() => expect(within(inbox).getByText('4')).toBeInTheDocument());
    expect(inbox.querySelectorAll('[data-tab-icon] .bg-badge')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /^Inbox/ })).toHaveLength(1);
  });

  it('inboxName covers the five cases in English and Arabic', () => {
    const i18n = initI18n('en');
    const en = i18n.getFixedT('en');
    expect(inboxName(en, 0, 0)).toBe('Inbox');
    expect(inboxName(en, 3, 0)).toBe('Inbox, Unread messages: 3');
    expect(inboxName(en, 0, 2)).toBe('Inbox, 2 items need action');
    expect(inboxName(en, 3, 1)).toBe('Inbox, Unread messages: 3, 1 item needs action');
    const ar = i18n.getFixedT('ar');
    expect(inboxName(ar, 1, 1)).toBe('الوارد، رسالة غير مقروءة، 1 عنصر يحتاج منك خطوة');
    expect(inboxName(ar, 0, 1)).toBe('الوارد، 1 عنصر يحتاج منك خطوة');
  });

  it('a press on the open tab scrolls to the top and does not navigate', async () => {
    phoneMedia(true);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    await renderApp('/');
    scrollTo.mockClear();
    const today = () => within(bar()).getByRole('link', { name: 'Today' });
    await userEvent.click(today());
    await userEvent.click(today());
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    expect(window.location.hash).toBe('#/');
  });

  it('uses a jump scroll with reduced motion', async () => {
    const media = window.matchMedia;
    phoneMedia(true);
    const phoneOnly = window.matchMedia;
    window.matchMedia = ((query: string) => (query.includes('prefers-reduced-motion') ? ({ ...phoneOnly(query), matches: true } as MediaQueryList) : phoneOnly(query))) as typeof window.matchMedia;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    await renderApp('/');
    scrollTo.mockClear();
    await userEvent.click(within(bar()).getByRole('link', { name: 'Today' }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    window.matchMedia = media;
  });

  it('the Work link follows the last Work view, and a press at that address scrolls', async () => {
    phoneMedia(true);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    rememberWorkView('/meetings');
    await renderApp('/meetings');
    const work = within(bar()).getByRole('link', { name: 'Work' });
    expect(work).toHaveAttribute('href', '#/meetings');
    expect(work).toHaveAttribute('aria-current', 'page');
    await userEvent.click(work);
    expect(scrollTo).toHaveBeenCalled();
    expect(window.location.hash).toBe('#/meetings');
  });

  it('a press on a lit tab whose link points elsewhere navigates', async () => {
    phoneMedia(true);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    await renderApp('/projects/prj_001');
    const work = within(bar()).getByRole('link', { name: 'Work' });
    expect(work).toHaveAttribute('aria-current', 'page');
    await userEvent.click(work);
    await waitFor(() => expect(window.location.hash).toBe('#/work'));
  });

  it('keeps data-pill, so Focus mode can make the bar inert', async () => {
    phoneMedia(true);
    await renderApp('/');
    expect(bar()).toHaveAttribute('data-pill');
    expect(bar()).toHaveAttribute('aria-label', 'Main navigation');
  });

  it('leaves the desk pill unchanged at desk width', async () => {
    phoneMedia(false);
    await renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    for (const name of ['Home', 'Projects', 'Tasks', 'Dashboard', 'Inbox', 'Search', 'Notifications']) {
      expect(await within(nav).findByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(nav.querySelector('[data-tab-word]')).toBeNull();
  });
});
