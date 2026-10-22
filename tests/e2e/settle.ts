import type { Page } from '@playwright/test';

/**
 * Waits until every finite CSS or Web animation on the page has ended. A full-page screenshot sets the window to 1 px and back. Below
 * 640 px the phone layout mounts, so on return the desk layout mounts again and its entrance (rise and fade) plays again. A contrast
 * check right after the screenshot then reads half-faded text. The loop-forever animations (the glow) are left out.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    // A new layout can start new animations while the first ones end, so the loop runs again until none is left.
    for (let round = 0; round < 4; round += 1) {
      await frame();
      await frame();
      const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity && animation.playState === 'running');
      if (finite.length === 0) return;
      await Promise.allSettled(finite.map((animation) => animation.finished));
    }
  });
}
