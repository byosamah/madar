import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hitLimit } from '../auth/rateLimit';
import { statementQuery } from '../data/dialect';
import { startOffice, type ItOffice } from './runCallOffice';

/**
 * The RATE_SQL text on the local Postgres (review 2026-11-10, finding 1) [Docker]. server/auth/rateLimit.test.ts pins the SQLite
 * twin; the db project runs only src/api tests, so this suite is the Postgres pin. Each parallel hit runs on an isolate of its own
 * (its own connections), as two requests do.
 */

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-04T06:15:00Z');

describe('hitLimit on the local database: no row over the limit', () => {
  let office: ItOffice;

  beforeAll(async () => {
    office = await startOffice('ratelimit');
  }, 60_000);

  afterAll(async () => {
    await office?.close();
  });

  it('a hit over the limit writes no row: the count stops at limit + 1', async () => {
    const q = statementQuery(office.isolate().db, 'write');
    const answers = [];
    for (let i = 0; i < 6; i += 1) answers.push(await hitLimit(q, { key: 'it:over', limit: 3, windowMs: HOUR, now: NOW }));
    expect(answers.map((a) => [a.ok, a.count])).toEqual([[true, 1], [true, 2], [true, 3], [false, 4], [false, 4], [false, 4]]);
    expect(await office.sql('select count from rate_limits where key = $1', ['it:over'])).toEqual([{ count: 4 }]);
  });

  it('five parallel hits at the last place, each on its own connections: exactly one passes', async () => {
    const isolates = Array.from({ length: 5 }, () => office.isolate());
    const hits = await Promise.all(isolates.map((one) => hitLimit(statementQuery(one.db, 'write'), { key: 'it:race', limit: 1, windowMs: HOUR, now: NOW })));
    expect(hits.filter((hit) => hit.ok)).toHaveLength(1);
    expect(hits.every((hit) => hit.count <= 2)).toBe(true);
    expect(await office.sql('select count from rate_limits where key = $1', ['it:race'])).toEqual([{ count: 2 }]);
  }, 60_000);
});
