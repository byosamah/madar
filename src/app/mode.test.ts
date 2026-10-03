import { describe, expect, it } from 'vitest';
import { PROTOTYPE, REMOTE } from './mode';

describe('the build flag', () => {
  it('is the fake API in the tests and the prototype build', () => {
    expect(import.meta.env.VITE_MADAR_API).toBe('fake');
    expect(REMOTE).toBe(false);
    expect(PROTOTYPE).toBe(true);
  });
});
