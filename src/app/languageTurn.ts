import { useReducedMotion } from 'motion/react';
import { useCallback } from 'react';
import type { Lang } from '../lib/dates';
import { useAction } from './runtime';

const PERSPECTIVE = 'perspective(1400px)';

/** Waits until the page shows the new language, at most 800 ms. */
function whenLanguage(lang: Lang): Promise<void> {
  const start = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (document.documentElement.lang === lang || performance.now() - start > 800) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * Motion moment 7: the page turns to 70 degrees and fades, the language and direction switch, and the page turns back.
 * Without motion (or without the animation API) the language simply switches.
 */
export function useSwitchLanguage(): (lang: Lang) => void {
  const preferences = useAction('me.updatePreferences');
  const reduce = useReducedMotion();
  const { mutate, mutateAsync } = preferences;
  return useCallback((lang: Lang) => {
    const page = document.querySelector<HTMLElement>('.app-page');
    if (!page || reduce || typeof page.animate !== 'function') {
      mutate({ language: lang });
      return;
    }
    const out = page.animate(
      [{ transform: `${PERSPECTIVE} rotateY(0deg)`, opacity: 1 }, { transform: `${PERSPECTIVE} rotateY(70deg)`, opacity: 0 }],
      { duration: 240, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
    );
    // The turn back hangs on the promise of the call, not on a callback of the screen. A person who leaves Settings during the
    // turn unmounts that screen, and its callback never ran, so the whole page stayed hidden (found 2026-10-03).
    // A refused change keeps the old language, and the page still turns back.
    void out.finished
      .then(() => mutateAsync({ language: lang }))
      .catch(() => undefined)
      .then(() => whenLanguage(lang))
      .then(() => {
        out.cancel();
        page.animate(
          [{ transform: `${PERSPECTIVE} rotateY(-70deg)`, opacity: 0 }, { transform: `${PERSPECTIVE} rotateY(0deg)`, opacity: 1 }],
          { duration: 420, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' },
        );
      });
  }, [mutate, mutateAsync, reduce]);
}
