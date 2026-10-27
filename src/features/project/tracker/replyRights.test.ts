import { afterEach, describe, expect, it } from 'vitest';
import type { UserCard } from '../../../api/contract/views';
import { setNow } from '../../../lib/dates';
import { defaultReplier, defaultReplyDay } from './replyRights';

const person = (id: string) => ({ id }) as UserCard;

afterEach(() => setNow(null));

describe('the default of a reply', () => {
  it('names the viewer when the viewer is among the people, else the first person', () => {
    const people = [person('a'), person('b')];
    expect(defaultReplier(people, 'b')).toBe('b');
    expect(defaultReplier(people, 'x')).toBe('a');
    expect(defaultReplier(people, undefined)).toBe('a');
  });

  it('names nobody when there are no people', () => {
    expect(defaultReplier([], 'a')).toBe('');
  });

  it('is due two working days from today', () => {
    // Monday 2026-10-26 (the office week runs Sunday to Thursday).
    setNow(new Date('2026-10-26T09:00:00+03:00'));
    expect(defaultReplyDay()).toBe('2026-10-28');
  });
});
