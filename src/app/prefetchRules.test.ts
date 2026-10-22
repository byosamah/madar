import { describe, expect, it } from 'vitest';
import type { Actor } from '../api/permissions';
import { prefetchSkip, SIGN_IN_SCREENS } from './prefetchRules';

const actor = (patch: Partial<Actor> = {}) => ({ systemRole: 'member', officeRights: [], ...patch }) as Actor;

describe('the screens that the idle prefetch leaves out (performance audit 2026-10-21, FL-8)', () => {
  it('names the five screens of the sign-in and the links of an email', () => {
    expect([...SIGN_IN_SCREENS].sort()).toEqual(['consent', 'forgot', 'reset', 'signIn', 'welcome']);
  });

  it('skips the sign-in screens when a session is stored, and keeps them when none is', () => {
    const stored = prefetchSkip({ storedSession: true, session: () => undefined });
    for (const name of SIGN_IN_SCREENS) expect(stored(name), name).toBe(true);
    const none = prefetchSkip({ storedSession: false, session: () => undefined });
    for (const name of SIGN_IN_SCREENS) expect(none(name), name).toBe(false);
  });

  it('skips Admin only when the cached session cannot open it', () => {
    const skip = (session?: { authority: Actor }) => prefetchSkip({ storedSession: true, session: () => session })('admin');
    expect(skip(undefined)).toBe(false);
    expect(skip({ authority: actor() })).toBe(true);
    expect(skip({ authority: actor({ systemRole: 'admin' }) })).toBe(false);
    expect(skip({ authority: actor({ officeRights: ['people.invite'] } as Partial<Actor>) })).toBe(false);
  });

  it('keeps every other screen for every person', () => {
    const skip = prefetchSkip({ storedSession: true, session: () => ({ authority: actor() }) });
    for (const name of ['projects', 'project', 'work', 'meetings', 'inbox', 'notifications', 'search', 'tasks', 'dashboard', 'meeting', 'space', 'settings', 'whatsNew', 'projectByCode'] as const) {
      expect(skip(name), name).toBe(false);
    }
  });
});
