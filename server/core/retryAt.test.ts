import { describe, expect, it } from 'vitest';
import { NetBudgetSpent } from '../office/net';
import { retryAtOf } from './retryAt';

describe('retryAtOf', () => {
  it('gives the time to try again of a spent network budget', () => {
    const now = new Date('2026-11-08T06:00:00Z');
    expect(retryAtOf(new NetBudgetSpent(now))?.toISOString()).toBe('2026-11-08T06:01:00.000Z');
  });

  it('gives null for a plain error, for null, and for a retryAt that is not a date', () => {
    expect(retryAtOf(new Error('plain'))).toBeNull();
    expect(retryAtOf(null)).toBeNull();
    expect(retryAtOf({ retryAt: '2026-11-08T06:01:00Z' })).toBeNull();
    expect(retryAtOf({ retryAt: new Date('nope') })).toBeNull();
  });
});
