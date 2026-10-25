import { onTestFinished } from 'vitest';

const PHONE = '(max-width: 639px)';
const COARSE = '(pointer: coarse)';

type Listener = (event: MediaQueryListEvent) => void;

/**
 * Makes jsdom answer as a phone or as a desk, as a touch screen or a mouse, and as a wide window (1024 px or more, Focus mode
 * chat). It answers (max-width: 639px), (pointer: coarse) and (min-width: 1024px). Every other query answers false, and the wide
 * query answers false until a test asks for it. The helper restores matchMedia when the test ends.
 */
export function phoneMedia(initial: boolean | { phone: boolean; coarse?: boolean; wide?: boolean }): { set(phone: boolean): void; setCoarse(coarse: boolean): void; setWide(wide: boolean): void } {
  const state = typeof initial === 'boolean' ? { phone: initial, coarse: false, wide: false } : { phone: initial.phone, coarse: initial.coarse ?? false, wide: initial.wide ?? false };
  const original = window.matchMedia;
  const listeners = new Map<string, Set<Listener>>();
  const valueOf = (query: string): boolean => {
    if (query.includes('max-width: 639px')) return state.phone;
    if (query.includes('pointer: coarse')) return state.coarse;
    if (query.includes('min-width: 1024px')) return state.wide;
    return false;
  };
  window.matchMedia = ((query: string): MediaQueryList => {
    const bucket = listeners.get(query) ?? new Set<Listener>();
    listeners.set(query, bucket);
    return {
      get matches() { return valueOf(query); },
      media: query,
      onchange: null,
      addListener: (listener: Listener) => { bucket.add(listener); },
      removeListener: (listener: Listener) => { bucket.delete(listener); },
      addEventListener: (_type: string, listener: Listener) => { bucket.add(listener); },
      removeEventListener: (_type: string, listener: Listener) => { bucket.delete(listener); },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  const tell = (needle: string) => {
    for (const [query, bucket] of listeners) {
      if (!query.includes(needle)) continue;
      for (const listener of [...bucket]) listener({ matches: valueOf(query), media: query } as MediaQueryListEvent);
    }
  };
  onTestFinished(() => { window.matchMedia = original; });
  return {
    set(phone: boolean) { state.phone = phone; tell('max-width: 639px'); },
    setCoarse(coarse: boolean) { state.coarse = coarse; tell('pointer: coarse'); },
    setWide(wide: boolean) { state.wide = wide; tell('min-width: 1024px'); },
  };
}

type ViewportInit = { height: number; offsetTop?: number; scale?: number };

/**
 * Installs a fake window.visualViewport. `set` changes the numbers, `fire` tells the listeners. `listeners()` counts them,
 * so a test can check that a hook lets go on unmount. The helper removes the fake when the test ends.
 */
export function fakeVisualViewport(init: ViewportInit): {
  set(next: Partial<ViewportInit>): void;
  fire(type: 'resize' | 'scroll'): void;
  listeners(): number;
} {
  const had = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const values = { height: init.height, offsetTop: init.offsetTop ?? 0, scale: init.scale ?? 1 };
  const bucket = new Map<string, Set<() => void>>();
  const fake = {
    get height() { return values.height; },
    get offsetTop() { return values.offsetTop; },
    get scale() { return values.scale; },
    get width() { return 390; },
    addEventListener: (type: string, listener: () => void) => {
      const set = bucket.get(type) ?? new Set<() => void>();
      set.add(listener);
      bucket.set(type, set);
    },
    removeEventListener: (type: string, listener: () => void) => { bucket.get(type)?.delete(listener); },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
  onTestFinished(() => {
    if (had) Object.defineProperty(window, 'visualViewport', had);
    else delete (window as unknown as { visualViewport?: unknown }).visualViewport;
  });
  return {
    set(next) { Object.assign(values, next); },
    fire(type) { for (const listener of [...(bucket.get(type) ?? [])]) listener(); },
    listeners() { let n = 0; for (const set of bucket.values()) n += set.size; return n; },
  };
}
