import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from './motion';

afterEach(() => vi.unstubAllGlobals());

describe('prefersReducedMotion', () => {
  it('asks the reduce query at each call', () => {
    const queries: string[] = [];
    let reduce = false;
    vi.stubGlobal('matchMedia', (query: string) => {
      queries.push(query);
      return { matches: reduce } as MediaQueryList;
    });
    expect(prefersReducedMotion()).toBe(false);
    reduce = true;
    expect(prefersReducedMotion()).toBe(true);
    expect(queries).toEqual(['(prefers-reduced-motion: reduce)', '(prefers-reduced-motion: reduce)']);
  });

  it('is false where the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
