import { describe, expect, it } from 'vitest';
import { clientParam, dayParam, oneOf, userParam } from './params';

describe('link values', () => {
  it('keeps a known value and falls back on anything else', () => {
    expect(oneOf('quarter', ['month', 'quarter'] as const, 'month')).toBe('quarter');
    expect(oneOf('decade', ['month', 'quarter'] as const, 'month')).toBe('month');
    expect(oneOf(null, ['month', 'quarter'] as const, 'month')).toBe('month');
  });

  it('keeps a real day only', () => {
    expect(dayParam('2026-09-30')).toBe('2026-09-30');
    expect(dayParam('banana')).toBeUndefined();
    expect(dayParam('2026-02-31')).toBeUndefined();
    expect(dayParam(null)).toBeUndefined();
  });

  it('keeps a person or a client id only when it has the form of one (owner, 2026-10-06)', () => {
    expect(userParam('usr_002')).toBe('usr_002');
    expect(userParam('nobody')).toBeUndefined();
    expect(userParam(null)).toBeUndefined();
    expect(clientParam('cli_001')).toBe('cli_001');
    expect(clientParam('usr_001')).toBeUndefined();
    expect(clientParam('')).toBeUndefined();
  });
});
