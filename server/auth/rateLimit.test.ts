import { describe, expect, it } from 'vitest';
import type { Query } from '../core/ports';
import { markLite, statementQuery } from '../data/dialect';
import { freshLite } from '../data/lite/testDb';
import { hashedKey, hitLimit, limitAddress, RATE_SQL } from './rateLimit';

/** The rate_limits table in memory: it answers RATE_SQL as the upsert does (no update and no row over the limit, the third value). */
function memoryLimits() {
  const rows = new Map<string, number>();
  const q = (async (text: string, values?: unknown[]) => {
    if (text !== RATE_SQL) throw new Error(`Unexpected SQL: ${text}`);
    const [key, start, limit] = values as [string, string, number];
    const id = `${key}|${start}`;
    const count = rows.get(id);
    if (count !== undefined && count > limit) return [];
    rows.set(id, (count ?? 0) + 1);
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

describe('hitLimit on node:sqlite: the RATE_LITE text of the office object (review 2026-11-10, finding 1)', () => {
  const now = new Date('2026-10-04T06:15:00Z');

  it('a hit over the limit writes no row: the count stops at limit + 1', async () => {
    const { raw, db } = await freshLite();
    const q = statementQuery(db, 'write');
    const answers = [];
    for (let i = 0; i < 6; i += 1) answers.push(await hitLimit(q, { key: 'signin:pair:x', limit: 3, windowMs: HOUR, now }));
    expect(answers.map((a) => [a.ok, a.count])).toEqual([[true, 1], [true, 2], [true, 3], [false, 4], [false, 4], [false, 4]]);
    expect(answers[5].retryAfterMs).toBe(45 * 60 * 1000);
    expect(raw.prepare('select count from rate_limits where key = ?').all('signin:pair:x')).toEqual([{ count: 4 }]);
  });

  it('two hits at the last place: exactly one passes', async () => {
    const { db } = await freshLite();
    // Each hit is one statement of its own, as two requests send them; db.tx keeps one transaction open at a time.
    const q = markLite((async (text: string, values: unknown[] = []) => db.host.exec(text, values as never).rows) as Query);
    const both = await Promise.all([1, 2].map(() => hitLimit(q, { key: 'authorize:ip:x', limit: 1, windowMs: HOUR, now })));
    expect(both.filter((one) => one.ok)).toHaveLength(1);
    expect(both.map((one) => one.count).sort()).toEqual([1, 2]);
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

describe('limitAddress: the address of a limit key (review 2026-11-10, task D3b)', () => {
  it('gives every address of one IPv6 /64 block the same text, and another block another text', () => {
    const block = limitAddress('2001:db8:1:2:aaaa::1');
    expect(block).toBe('2001:0db8:0001:0002');
    expect(limitAddress('2001:DB8:1:2::ffff')).toBe(block);
    expect(limitAddress('2001:0db8:0001:0002:0000:0000:0000:0009')).toBe(block);
    expect(limitAddress(' 2001:db8:1:2:1:2:3:4 ')).toBe(block);
    expect(limitAddress('2001:db8:1:3::1')).toBe('2001:0db8:0001:0003');
  });

  it('reads ::, brackets, a zone id and an IPv4-mapped address', () => {
    expect(limitAddress('::1')).toBe('0000:0000:0000:0000');
    expect(limitAddress('::')).toBe('0000:0000:0000:0000');
    expect(limitAddress('[2001:db8::1]')).toBe('2001:0db8:0000:0000');
    expect(limitAddress('fe80::1%en0')).toBe('fe80:0000:0000:0000');
    expect(limitAddress('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(limitAddress('::FFFF:0102:0304')).toBe('1.2.3.4');
    expect(limitAddress('64:ff9b::1.2.3.4')).toBe('0064:ff9b:0000:0000');
  });

  it('keeps an IPv4 address and a text that is no address as they are, trimmed and lower-case, and never throws', () => {
    expect(limitAddress('1.2.3.4')).toBe('1.2.3.4');
    expect(limitAddress(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(limitAddress('not-an-address')).toBe('not-an-address');
    expect(limitAddress('Unknown')).toBe('unknown');
    for (const odd of ['', ':::', '1::2::3', '2001:db8:1:2:3:4:5:6:7', '12345::1', 'g::1', '1.2.3.4::', '[2001:db8::1', '::ffff:1.2.3.999']) {
      expect(() => limitAddress(odd), odd).not.toThrow();
      expect(limitAddress(odd), odd).toBe(odd.trim().toLowerCase());
    }
  });
});
