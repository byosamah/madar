import { onTestFinished } from 'vitest';

/**
 * Makes `(prefers-reduced-motion: reduce)` answer true for the rest of the test. Call it after `phoneMedia`: it wraps the
 * `matchMedia` that is in place and gives every other query to it. The wrap lets go when the test ends.
 */
export function reduceMotion(): void {
  const before = window.matchMedia;
  let live = true;
  window.matchMedia = ((query: string): MediaQueryList => {
    const inner = before(query);
    if (!live || !query.includes('prefers-reduced-motion')) return inner;
    return {
      get matches() { return query.includes('reduce'); },
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  onTestFinished(() => { live = false; window.matchMedia = before; });
}
