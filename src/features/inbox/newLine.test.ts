import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { HALA, OMAR, makeBubble } from './logHarness';
import { firstUnreadId, useOpenMark, type NewMark } from './newLine';

const t = (hm: string) => `2026-09-29T${hm}:00.000+03:00`;

describe('where the New line goes (design item 3)', () => {
  it('goes above the first message of another person after the read time', () => {
    const list = [makeBubble({ id: 'a', createdAt: t('09:00'), body: 'a' }), makeBubble({ id: 'b', author: HALA, mine: true, createdAt: t('09:10'), body: 'b' }),
      makeBubble({ id: 'c', createdAt: t('09:20'), body: 'c' }), makeBubble({ id: 'd', author: OMAR, createdAt: t('09:30'), body: 'd' })];
    expect(firstUnreadId(list, { unread: 2, readUpTo: t('09:15') })).toBe('c');
  });
  it('skips a quiet line and your own message after the read time', () => {
    const list = [makeBubble({ id: 'l', createdAt: t('09:20'), body: '', line: { id: 'l', at: t('09:20'), type: 'renamed', actor: OMAR, people: [], name: 'Site' } }),
      makeBubble({ id: 'm', author: HALA, mine: true, createdAt: t('09:21'), body: 'm' }), makeBubble({ id: 'o', createdAt: t('09:22'), body: 'o' })];
    expect(firstUnreadId(list, { unread: 1, readUpTo: t('09:15') })).toBe('o');
  });
  it('draws no line when nothing was unread at the open', () => {
    expect(firstUnreadId([makeBubble({ id: 'a', createdAt: t('09:20'), body: 'a' })], { unread: 0, readUpTo: t('09:15') })).toBeNull();
  });
  it('goes above the first message of another person in the log for a chat never read', () => {
    expect(firstUnreadId([makeBubble({ id: 'a', author: HALA, mine: true, createdAt: t('09:00'), body: 'a' }), makeBubble({ id: 'b', createdAt: t('09:05'), body: 'b' })], { unread: 3, readUpTo: null })).toBe('b');
  });
  it('counts back over the messages of other people when there is no read time (a task thread)', () => {
    const list = [makeBubble({ id: 'c1', createdAt: t('09:00'), body: '1' }), makeBubble({ id: 'c2', author: HALA, mine: true, createdAt: t('09:05'), body: '2' }),
      makeBubble({ id: 'c3', createdAt: t('09:10'), body: '3' }), makeBubble({ id: 'r', createdAt: t('09:12'), body: 'x', reason: { kind: 'due_date' } }),
      makeBubble({ id: 'c4', author: OMAR, createdAt: t('09:15'), body: '4' })];
    expect(firstUnreadId(list, { unread: 2 })).toBe('c3');
    expect(firstUnreadId(list, { unread: 9 })).toBe('c3');
  });
});

describe('the read state at the open', () => {
  it('waits for a fresh answer, then keeps the first one', () => {
    const { result, rerender } = renderHook((answer) => useOpenMark(answer, (data: NewMark) => data), {
      initialProps: { data: { unread: 0, readUpTo: 'A' } as NewMark | undefined, isStale: true, isFetchedAfterMount: false },
    });
    expect(result.current).toBeNull();
    rerender({ data: { unread: 2, readUpTo: 'A' }, isStale: false, isFetchedAfterMount: true });
    expect(result.current).toEqual({ unread: 2, readUpTo: 'A' });
    rerender({ data: { unread: 0, readUpTo: 'B' }, isStale: false, isFetchedAfterMount: true });
    expect(result.current).toEqual({ unread: 2, readUpTo: 'A' });
  });
  it('takes a cached answer that no change made old at once', () => {
    const { result } = renderHook(() => useOpenMark({ data: { unread: 1, readUpTo: null } as NewMark, isStale: false, isFetchedAfterMount: false }, (data) => data));
    expect(result.current).toEqual({ unread: 1, readUpTo: null });
  });
});
