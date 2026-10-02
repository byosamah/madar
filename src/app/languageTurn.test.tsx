import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

type FakeAnimation = { finished: Promise<void>; cancel: ReturnType<typeof vi.fn> };

const original = HTMLElement.prototype.animate;
afterEach(() => {
  HTMLElement.prototype.animate = original;
});

describe('the language turn', () => {
  it('turns the page back even when the person leaves Settings during the turn', async () => {
    const animations: FakeAnimation[] = [];
    // jsdom has no animation API. The first fake (the turn away) ends only when the test says so, the way a real turn
    // takes a moment. Every later fake ends at once.
    let endTurn = () => {};
    const turnAway = new Promise<void>((resolve) => { endTurn = resolve; });
    HTMLElement.prototype.animate = vi.fn(() => {
      const animation = { finished: animations.length === 0 ? turnAway : Promise.resolve(), cancel: vi.fn() };
      animations.push(animation);
      return animation as unknown as Animation;
    });
    const { router } = await renderApp('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'العربية' }));
    // The person leaves Settings while the page still turns away, then the turn ends.
    await router.navigate('/projects');
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    endTurn();
    await waitFor(() => expect(document.documentElement.lang).toBe('ar'));
    // The turn away is cancelled and the page turns back, so the page never stays hidden.
    await waitFor(() => expect(animations[0]?.cancel).toHaveBeenCalled());
    expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(2);
  });
});
