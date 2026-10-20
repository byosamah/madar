import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/render';

describe('the tab pill labels', () => {
  // On a phone the tabs show icons only (owner, 2026-10-08). The word of each tab stays in the page for screen readers,
  // and it shows again from the small breakpoint (640 px) up.
  it('hides the word of each phone tab from view, and keeps its name', async () => {
    await renderApp('/');
    const pill = document.querySelector('[data-pill]') as HTMLElement;
    expect(pill).not.toBeNull();
    const projects = within(pill).getByRole('link', { name: 'Projects' });
    const word = within(projects).getByText('Projects');
    expect(word).toHaveClass('sr-only');
    expect(word).toHaveClass('sm:not-sr-only');
  });
});

describe('the phone tab pill', () => {
  // The owner's screenshot (2026-10-20): each icon sat at the top of a tall box, and the open tab was a square-cornered box
  // inside a round bar. The icons-only bar now centres each icon, and the open tab is a round pill.
  function phoneWidth() {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)', media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }) as MediaQueryList);
  }

  afterEach(() => vi.restoreAllMocks());

  it('centres the icon of each tab in a tab of one height', async () => {
    phoneWidth();
    await renderApp('/');
    const pill = document.querySelector('[data-pill]') as HTMLElement;
    // The bar also holds Search and the bell, hidden on a phone by a class. They sit at the top of the phone screen.
    const tabs = ['Home', 'Projects', 'Tasks', 'Dashboard', /^Inbox/].map((name) => within(pill).getByRole('link', { name }));
    for (const tab of tabs) {
      expect(tab).toHaveClass('h-12', 'items-center', 'justify-center');
      expect(tab.className).not.toMatch(/justify-start|py-1\.5/);
    }
  });

  it('shows the open tab as a round pill, the shape of the bar', async () => {
    phoneWidth();
    await renderApp('/');
    const home = within(document.querySelector('[data-pill]') as HTMLElement).getByRole('link', { name: 'Home' });
    const mark = home.querySelector('.signature') as HTMLElement;
    expect(mark).toHaveClass('rounded-full');
    expect(mark.className).not.toMatch(/rounded-\[/);
  });

  it('lines up the bar with the 16 px edge of the page', async () => {
    phoneWidth();
    await renderApp('/');
    const pill = document.querySelector('[data-pill]') as HTMLElement;
    expect(pill).toHaveClass('w-[calc(100vw-32px)]', 'bottom-[max(16px,env(safe-area-inset-bottom))]');
  });

  it('puts the unread count of the Inbox on the corner of its icon', async () => {
    phoneWidth();
    await renderApp('/');
    const pill = document.querySelector('[data-pill]') as HTMLElement;
    const inbox = within(pill).getByRole('link', { name: /^Inbox/ });
    const count = await within(inbox).findByText('Unread messages: 3');
    expect(count.closest('[data-tab-icon]')).not.toBeNull();
    // On a phone the Inbox is one of the five tabs, never also the round button of the desk.
    expect(screen.getAllByRole('link', { name: /^Inbox/ })).toHaveLength(1);
  });
});
