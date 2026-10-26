import { afterEach, describe, expect, it, vi } from 'vitest';
import { WHATS_NEW } from './entries';
import { hasNew, isNewer, markSeen, newestId, readSeen } from './seen';

describe("What's new seen mark", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('shows the bold mark when the person has seen nothing', () => {
    expect(hasNew(WHATS_NEW, null)).toBe(true);
  });

  it('clears the mark after the newest entry is marked seen', () => {
    markSeen('usr_001', newestId(WHATS_NEW)!);
    expect(hasNew(WHATS_NEW, readSeen('usr_001'))).toBe(false);
  });

  it('keeps the mark for each person', () => {
    markSeen('usr_001', WHATS_NEW[0].id);
    expect(hasNew(WHATS_NEW, readSeen('usr_002'))).toBe(true);
  });

  it('stores the mark under madar.whatsNewSeen.<user id>', () => {
    markSeen('usr_001', WHATS_NEW[0].id);
    expect(window.localStorage.getItem('madar.whatsNewSeen.usr_001')).toBe(WHATS_NEW[0].id);
  });

  it('shows the mark again when an older entry is the one stored', () => {
    expect(hasNew(WHATS_NEW, '2000-01-01-1')).toBe(true);
  });

  it('shows no bold item when the storage throws on a read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(hasNew(WHATS_NEW, readSeen('usr_001'))).toBe(false);
  });

  it('does not throw when the storage throws on a write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => markSeen('usr_001', WHATS_NEW[0].id)).not.toThrow();
  });

  it('takes the newest entry by its day, not the pinned first entry (2026-10-26)', () => {
    const entries = [{ id: '2026-10-23-102', day: '2026-10-25' }, { id: '2026-10-23-112', day: '2026-10-26' }, { id: '2026-10-23-111', day: '2026-10-26' }, { id: '2026-10-23-107', day: '2026-10-25' }];
    expect(newestId(entries)).toBe('2026-10-23-112');
    expect(newestId([{ id: '2026-10-23-102', day: '2026-10-25' }, { id: '2026-10-23-107', day: '2026-10-25' }])).toBe('2026-10-23-102');
  });

  it('shows the mark when the person saw only the pinned usage entry and a newer entry came (2026-10-26)', () => {
    const entries = [{ id: '2026-10-23-102', day: '2026-10-25' }, { id: '2026-10-23-112', day: '2026-10-26' }, { id: '2026-10-23-107', day: '2026-10-25' }];
    expect(hasNew(entries, '2026-10-23-102')).toBe(true);
    expect(hasNew(entries, '2026-10-23-112')).toBe(false);
  });

  it('counts as newer only the entries above the seen one, with the pinned entry in the place of its day', () => {
    const entries = [{ id: '2026-10-23-102', day: '2026-10-25' }, { id: '2026-10-23-112', day: '2026-10-26' }, { id: '2026-10-23-107', day: '2026-10-25' }];
    expect(isNewer(entries, '2026-10-23-112', '2026-10-23-102')).toBe(true);
    expect(isNewer(entries, '2026-10-23-107', '2026-10-23-102')).toBe(false);
    expect(isNewer(entries, '2026-10-23-102', '2026-10-23-107')).toBe(true);
    expect(isNewer(entries, '2026-10-23-112', null)).toBe(false);
    expect(isNewer(entries, '2026-10-23-112', '2000-01-01-1')).toBe(false);
  });
});
