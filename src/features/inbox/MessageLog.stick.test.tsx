import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

type Watch = { callback: () => void; target: Element };
const watches: Watch[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  watches.length = 0;
});

/** jsdom draws nothing, so the log gets a height that a test can grow, and a scroll position that a test can set. */
function measure(log: HTMLElement) {
  let top = 0;
  let height = 1000;
  Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(log, 'clientHeight', { configurable: true, get: () => 500 });
  Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });
  return { at: (value: number) => { top = value; }, top: () => top, grow: (by: number) => { height += by; } };
}

/** The list of messages tells the log that its height changed, as the browser does when a picture has loaded and its box has its shape. */
function listChanged(log: HTMLElement) {
  for (const watch of watches.filter((w) => w.target.tagName === 'OL' && log.contains(w.target))) watch.callback();
}

async function openTower() {
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe(target: Element) { watches.push({ callback: this.callback, target }); }
    unobserve() {}
    disconnect() {}
  });
  await renderApp('/inbox');
  await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /Corniche Office Tower/ }));
  return screen.findByRole('log', { name: 'Messages' });
}

describe('the message log when a picture changes its height (owner, 2026-10-19)', () => {
  it('keeps the newest message in view while the person reads the bottom', async () => {
    const log = await openTower();
    const view = measure(log);
    view.at(500);
    fireEvent.scroll(log);
    view.grow(300);
    listChanged(log);
    expect(view.top()).toBe(1300);
  });

  it('does not move a person who reads older messages', async () => {
    const log = await openTower();
    const view = measure(log);
    view.at(100);
    fireEvent.scroll(log);
    view.grow(300);
    listChanged(log);
    expect(view.top()).toBe(100);
  });
});
