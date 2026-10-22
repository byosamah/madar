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

function measure(log: HTMLElement) {
  let top = 0;
  let height = 1000;
  Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(log, 'clientHeight', { configurable: true, get: () => 500 });
  Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });
  return { at: (value: number) => { top = value; }, top: () => top };
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

/** The log itself tells that its size changed, as the browser does when the keyboard opens and the page gets shorter. */
function logResized(log: HTMLElement) {
  const own = watches.filter((watch) => watch.target === log);
  expect(own.length).toBeGreaterThan(0);
  for (const watch of own) watch.callback();
}

describe('the message log when the keyboard shrinks it (Direction D)', () => {
  it('keeps the bottom in view when the log shrinks for the keyboard', async () => {
    const log = await openTower();
    const view = measure(log);
    view.at(500);
    fireEvent.scroll(log);
    logResized(log);
    expect(view.top()).toBe(1000);
  });

  it('does not move a reader of old messages', async () => {
    const log = await openTower();
    const view = measure(log);
    view.at(100);
    fireEvent.scroll(log);
    logResized(log);
    expect(view.top()).toBe(100);
  });
});
