import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SCREEN_NAMES, screenCache, type PageReload } from './screens';

const One: ComponentType = () => null;
const Two: ComponentType = () => null;

/** A page whose reload and session mark the test can see. */
function page(o: { online?: boolean; href?: string; storage?: boolean } = {}): PageReload & { reloads: number; marked: string | null } {
  const state = { reloads: 0, marked: null as string | null };
  return {
    get reloads() { return state.reloads; },
    get marked() { return state.marked; },
    online: () => o.online ?? true,
    href: () => o.href ?? 'https://madar.test/projects',
    markedHref: () => state.marked,
    mark: (href) => {
      if (o.storage === false) return false;
      state.marked = href;
      return true;
    },
    unmark: () => { state.marked = null; },
    reload: () => { state.reloads += 1; },
  };
}

/** A promise that has not settled after the tasks that wait now. */
async function pending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  return !settled;
}

describe('the screen loaders (performance audit BND-1)', () => {
  it('holds one loader for each screen that loads on demand, and none for the frame, the gate, Home and the error pages', () => {
    expect(SCREEN_NAMES).toEqual(expect.arrayContaining(['projects', 'project', 'projectByCode', 'work', 'dashboard', 'meeting', 'space', 'inbox', 'notifications', 'search', 'tasks', 'settings', 'admin', 'signIn', 'welcome', 'forgot', 'reset', 'consent']));
    expect(SCREEN_NAMES).toHaveLength(19);
  });

  it('keeps a loaded screen, so a second load imports nothing', async () => {
    const importOne = vi.fn(async () => One);
    const cache = screenCache({ one: importOne, two: async () => Two });
    expect(cache.screenFor('one')).toBeUndefined();
    await Promise.all([cache.loadScreen('one'), cache.loadScreen('one')]);
    expect(await cache.loadScreen('one')).toBe(One);
    expect(cache.screenFor('one')).toBe(One);
    expect(cache.screenFor('two')).toBeUndefined();
    expect(importOne).toHaveBeenCalledTimes(1);
    await cache.preloadScreens();
    expect(cache.screenFor('two')).toBe(Two);
  });

  it('imports a screen again after a failed import', async () => {
    const importOne = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module')).mockResolvedValue(One);
    const cache = screenCache({ one: importOne });
    await expect(cache.loadScreen('one')).rejects.toThrow('Failed to fetch');
    expect(await cache.loadScreen('one')).toBe(One);
  });

  it('reloads the page once when the import of a screen fails at a screen change, and shows the error the second time', async () => {
    const failed = new Error('Failed to fetch dynamically imported module');
    const cache = screenCache({ one: async () => { throw failed; } });
    const first = page();
    expect(await pending(cache.loadForNavigation('one', first))).toBe(true);
    expect(first.reloads).toBe(1);
    expect(first.marked).toBe('https://madar.test/projects');
    // After the reload the mark is still in the session storage of the tab, so the same failure shows the error page.
    await expect(cache.loadForNavigation('one', first)).rejects.toBe(failed);
    expect(first.reloads).toBe(1);
  });

  it('shows the error with no reload when the device is offline or the session storage takes no mark', async () => {
    const failed = new Error('Failed to fetch dynamically imported module');
    const cache = screenCache({ one: async () => { throw failed; } });
    const offline = page({ online: false });
    await expect(cache.loadForNavigation('one', offline)).rejects.toBe(failed);
    expect(offline.reloads).toBe(0);
    const blocked = page({ storage: false });
    await expect(cache.loadForNavigation('one', blocked)).rejects.toBe(failed);
    expect(blocked.reloads).toBe(0);
  });

  it('removes the mark after a screen change that loads, so a later release can reload the page again', async () => {
    const cache = screenCache({ one: async () => One });
    const tab = page();
    tab.mark('https://madar.test/projects');
    expect(await cache.loadForNavigation('one', tab)).toBe(One);
    expect(tab.marked).toBeNull();
    expect(tab.reloads).toBe(0);
  });

  it('prefetches the screens one at a time at idle, skips the loaded ones, and lets a failed one load again later', async () => {
    const order: string[] = [];
    const idle: (() => void)[] = [];
    const cache = screenCache({
      one: async () => { order.push('one'); return One; },
      two: async () => { order.push('two'); throw new Error('Failed to fetch dynamically imported module'); },
      three: async () => { order.push('three'); return Two; },
    });
    await cache.loadScreen('one');
    order.length = 0;
    cache.prefetchScreens(undefined, (run) => idle.push(run));
    expect(idle).toHaveLength(1);
    expect(order).toEqual([]);
    idle.shift()?.();
    await vi.waitFor(() => expect(idle).toHaveLength(1));
    expect(order).toEqual(['two']);
    idle.shift()?.();
    await vi.waitFor(() => expect(cache.screenFor('three')).toBe(Two));
    expect(order).toEqual(['two', 'three']);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(idle).toHaveLength(0);
    expect(cache.screenFor('two')).toBeUndefined();
  });
});
