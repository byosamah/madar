import { describe, expect, it } from 'vitest';
import { LOADERS } from './screenLoaders';
import { LOADERS as STATIC_LOADERS } from './screenLoaders.static';

/**
 * The prototype build takes screenLoaders.static.ts in place of screenLoaders.ts (an alias in vite.config.ts), because its one
 * script file wraps each on-demand import in extra start-up code. The two lists must give the same screens.
 */
describe('the two screen loader lists', () => {
  it('name the same screens in the same order', () => {
    expect(Object.keys(STATIC_LOADERS)).toEqual(Object.keys(LOADERS));
  });

  it('give the same screen component for each name', async () => {
    for (const name of Object.keys(LOADERS) as (keyof typeof LOADERS)[]) {
      expect(await STATIC_LOADERS[name](), name).toBe(await LOADERS[name]());
    }
  });
});
