import { afterEach, describe, expect, it, vi } from 'vitest';
import { WHATS_NEW } from './entries';
import { hasNew, markSeen, readSeen } from './seen';

describe("What's new seen mark", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('shows the bold mark when the person has seen nothing', () => {
    expect(hasNew(WHATS_NEW, null)).toBe(true);
  });

  it('clears the mark after the newest entry is marked seen', () => {
    markSeen('usr_001', WHATS_NEW[0].id);
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
});
