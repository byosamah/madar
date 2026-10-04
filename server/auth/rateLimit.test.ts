import { describe, expect, it } from 'vitest';
import type { Query } from '../core/ports';
import { hashedKey, hitLimit, RATE_SQL } from './rateLimit';

/** The rate_limits table in memory: it answers RATE_SQL as the upsert does. */
function memoryLimits() {
  const rows = new Map<string, number>();
  const q = (async (text: string, values?: unknown[]) => {
    if (text !== RATE_SQL) throw new Error(`Unexpected SQL: ${text}`);
    const [key, start] = values as [string, string];
    const id = `${key}|${start}`;
    rows.set(id, (rows.get(id) ?? 0) + 1);
    return [{ count: rows.get(id) }];
  }) as Query;
  return { rows, q };
}

const HOUR = 60 * 60 * 1000;

describe('hitLimit: fixed windows in rate_limits (plan 5.1)', () => {
  it('lets the first "limit" hits of a window through and refuses the next, with the time until the window ends', async () => {
    const { q } = memoryLimits();
    const now = new Date('2026-10-04T06:15:00Z');
    const answers = [];
    for (let i = 0; i < 4; i += 1) answers.push(await hitLimit(q, { key: 'forgot:email:x', limit: 3, windowMs: HOUR, now }));
    expect(answers.map((a) => [a.ok, a.count])).toEqual([[true, 1], [true, 2], [true, 3], [false, 4]]);
    expect(answers[3].retryAfterMs).toBe(45 * 60 * 1000);
  });

  it('starts a new window at the next window start, and keeps keys apart', async () => {
    const { q, rows } = memoryLimits();
    for (let i = 0; i < 3; i += 1) await hitLimit(q, { key: 'a', limit: 3, windowMs: HOUR, now: new Date('2026-10-04T06:59:59Z') });
    expect((await hitLimit(q, { key: 'a', limit: 3, windowMs: HOUR, now: new Date('2026-10-04T07:00:00Z') })).ok).toBe(true);
    expect((await hitLimit(q, { key: 'b', limit: 3, windowMs: HOUR, now: new Date('2026-10-04T06:59:59Z') })).ok).toBe(true);
    expect([...rows.keys()]).toEqual(['a|2026-10-04T06:00:00.000Z', 'a|2026-10-04T07:00:00.000Z', 'b|2026-10-04T06:00:00.000Z']);
  });
});

describe('hashedKey', () => {
  it('keeps no email or address in the table: a sha256 of the lower-case value, the same for the same value', async () => {
    const one = await hashedKey('forgot:email', 'Sara@Madar.test');
    expect(one).toMatch(/^forgot:email:[0-9a-f]{64}$/);
    expect(one).not.toContain('sara');
    expect(await hashedKey('forgot:email', ' sara@madar.test ')).toBe(one);
    expect(await hashedKey('forgot:ip', 'sara@madar.test')).not.toBe(one);
  });
});
