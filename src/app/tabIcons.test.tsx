import { expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AnimatedIcon } from '../components/icons/AnimatedIcon';
import { NAV, NOTIFICATIONS_ITEM, PHONE_NAV, SEARCH_ITEM } from './nav';

/**
 * The icon of the active tab plays when the tab becomes active (playWhen), and nothing stops it later. An icon that repeats for
 * ever then moves on every screen of that tab. It also changes the page about 150 times a second, and each change made a
 * waiting screen test query the page again, so a test on the Tasks tab ran out of time under load (track Q, item 4).
 */
it('plays each tab icon once, then rests', async () => {
  const items = [...NAV, ...PHONE_NAV, SEARCH_ITEM, NOTIFICATIONS_ITEM];
  const { container } = render(
    <>{items.map((item) => <span key={item.key} data-tab={item.key}><AnimatedIcon icon={item.animated} size={20} playWhen aria-hidden /></span>)}</>,
  );
  // Each icon counts as moving from the start, so a check before its first frame cannot pass.
  const lastChange = new Map(items.map((item) => [item.key, performance.now()]));
  const observer = new MutationObserver((records) => {
    for (const change of records) {
      const tab = (change.target instanceof Element ? change.target : change.target.parentElement)?.closest('[data-tab]')?.getAttribute('data-tab');
      if (tab) lastChange.set(tab, performance.now());
    }
  });
  observer.observe(container, { attributes: true, childList: true, subtree: true, characterData: true });
  const moving = () => items.map((item) => item.key).filter((key) => performance.now() - (lastChange.get(key) ?? 0) < 400);
  try {
    // The longest tab animation takes about 1.6 s. After it, no icon writes anything again.
    await waitFor(() => expect(moving()).toEqual([]), { timeout: 3500, interval: 100 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(moving()).toEqual([]);
  } finally {
    observer.disconnect();
  }
}, 6000);
