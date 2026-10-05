import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';
import { TODAY } from '../test/factories';

// The owner (2026-10-05, item 11): a new person starts light, and a person who exists keeps their choice. The people of the
// sample office stand for people who exist, and the browser suites show them dark through the device setting, so they keep
// the System theme.
describe('the theme of the sample office (owner, 2026-10-05, item 11)', () => {
  it('keeps the System theme for every sample person', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    const themes = new Set(Object.values(state.users).map((user) => user.preferences.theme));
    expect([...themes]).toEqual(['system']);
  });
});
