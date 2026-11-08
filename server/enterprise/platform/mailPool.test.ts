import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { liteDb } from '../../data/lite/db';
import { nodeHost } from '../../data/lite/host';
import { MAIL_POOL_SCHEMA, mailReserve, noticeShareOf, type PoolKind } from './mailPool';

const DAY = '2026-11-08';
const LIMIT = { limit: 100, share: 0.1 };

function pool() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(MAIL_POOL_SCHEMA);
  const db = liteDb(nodeHost(raw));
  const reserve = (ent: string, kind: PoolKind, ref: string, day = DAY, o = LIMIT) => db.tx('write', (q) => mailReserve(q, { ent, kind, day, ref }, o));
  const rows = () => (raw.prepare('select count(*) as n from mail_pool').get() as { n: number }).n;
  return { raw, reserve, rows };
}

describe('the mail pool of the account', () => {
  it('answers full for notice 91 and keeps sign-in places to 98', async () => {
    const { reserve } = pool();
    for (let i = 1; i <= 90; i += 1) expect(await reserve('ent_001', 'notice', `ent_001:n${i}`)).toBe('ok');
    expect(await reserve('ent_001', 'notice', 'ent_001:n91')).toBe('full');
    for (let i = 91; i <= 98; i += 1) expect(await reserve('ent_001', 'signin', `ent_001:s${i}`)).toBe('ok');
    expect(await reserve('ent_001', 'signin', 'ent_001:s99')).toBe('full');
  });

  it('counts one ref once, also when the pool is full', async () => {
    const { reserve, rows } = pool();
    expect(await reserve('ent_001', 'notice', 'ent_001:a')).toBe('ok');
    expect(await reserve('ent_001', 'notice', 'ent_001:a')).toBe('ok');
    expect(rows()).toBe(1);
    for (let i = 0; i < 89; i += 1) await reserve('ent_001', 'notice', `ent_001:n${i}`);
    expect(await reserve('ent_001', 'notice', 'ent_001:late')).toBe('full');
    expect(await reserve('ent_001', 'notice', 'ent_001:a')).toBe('ok');
  });

  it('holds a non-VADO enterprise to its share of notice places and never holds ENT_VADO', async () => {
    const { reserve } = pool();
    expect(noticeShareOf(100, 0.1)).toBe(9);
    for (let i = 1; i <= 9; i += 1) expect(await reserve('ent_002', 'notice', `ent_002:n${i}`)).toBe('ok');
    expect(await reserve('ent_002', 'notice', 'ent_002:n10')).toBe('full');
    // The share holds notice mail only: a sign-in place of the same enterprise still goes through.
    expect(await reserve('ent_002', 'signin', 'ent_002:s1')).toBe('ok');
    // ENT_VADO takes the places up to the notice limit of 90 (9 notice places and 1 sign-in place are used).
    let vado = 0;
    while ((await reserve('ent_001', 'notice', `ent_001:n${vado + 1}`)) === 'ok') vado += 1;
    expect(vado).toBe(90 - 10);
  });

  it('keeps at least one notice place for a small share', async () => {
    const { reserve } = pool();
    expect(noticeShareOf(100, 0.001)).toBe(1);
    expect(await reserve('ent_002', 'notice', 'ent_002:a', DAY, { limit: 100, share: 0.001 })).toBe('ok');
    expect(await reserve('ent_002', 'notice', 'ent_002:b', DAY, { limit: 100, share: 0.001 })).toBe('full');
  });

  it('deletes rows older than 2 days when it adds a place', async () => {
    const { reserve, raw, rows } = pool();
    await reserve('ent_001', 'notice', 'ent_001:old', '2026-11-04');
    await reserve('ent_001', 'notice', 'ent_001:two-days', '2026-11-06');
    expect(rows()).toBe(2);
    await reserve('ent_001', 'notice', 'ent_001:new', DAY);
    expect((raw.prepare('select ref from mail_pool order by ref').all() as { ref: string }[]).map((r) => r.ref)).toEqual(['ent_001:new', 'ent_001:two-days']);
  });

  it('refuses a day that is not YYYY-MM-DD, a bad kind, a bad enterprise and a bad ref', async () => {
    const { reserve, rows } = pool();
    for (const day of ['2026-11-8', '08-11-2026', '2026-13-45', '', '2026-11-08T00:00:00Z']) {
      await expect(reserve('ent_001', 'notice', 'ent_001:a', day)).rejects.toMatchObject({ code: 'invalid_input' });
    }
    await expect(reserve('ent_001', 'summary' as PoolKind, 'ent_001:a')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(reserve('ENT_1', 'notice', 'ENT_1:a')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(reserve('ent_001', 'notice', '')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(reserve('ent_001', 'notice', `ent_001:${'x'.repeat(200)}`)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(rows()).toBe(0);
  });

  it('refuses a ref that does not start with the enterprise of the call, and takes no place', async () => {
    const { reserve, rows } = pool();
    for (const ref of ['ent_001:a', 'a', 'ent_002', 'ent_002:', 'ENT_002:a', ' ent_002:a', 'ent_0020:a', 'ent_002_a']) {
      const error = await reserve('ent_002', 'notice', ref).catch((e: unknown) => e);
      expect(error, ref).toMatchObject({ code: 'invalid_input' });
      // The refusal names no enterprise.
      expect(String((error as Error).message), ref).not.toMatch(/ent_00\d/);
    }
    expect(rows()).toBe(0);
  });

  it('keeps the place of a ref of ent_001 for ent_001 only, and a repeat of a good ref of ent_002 takes no second place', async () => {
    const { reserve, raw, rows } = pool();
    expect(await reserve('ent_001', 'notice', 'ent_001:n1')).toBe('ok');
    expect(rows()).toBe(1);
    // An object of ent_002 that sends the ref of ent_001 gets the refusal and takes no place.
    await expect(reserve('ent_002', 'notice', 'ent_001:n1')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(reserve('ent_002', 'signin', 'ent_001:n2')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(rows()).toBe(1);
    // The same ref of ent_001 still answers ok for ent_001, with no second place.
    expect(await reserve('ent_001', 'notice', 'ent_001:n1')).toBe('ok');
    expect(rows()).toBe(1);
    // A good ref of ent_002 takes one place, and its repeat takes none.
    expect(await reserve('ent_002', 'notice', 'ent_002:n1')).toBe('ok');
    expect(await reserve('ent_002', 'notice', 'ent_002:n1')).toBe('ok');
    expect(rows()).toBe(2);
    expect(raw.prepare('select ent from mail_pool order by ref').all()).toEqual([{ ent: 'ent_001' }, { ent: 'ent_002' }]);
  });

  it('compares the enterprise of the row too, so a row of another enterprise never gives ok and never hides the missing place', async () => {
    const { reserve, raw, rows } = pool();
    // A row that an older build could have written with a ref of one enterprise under another enterprise.
    raw.prepare("insert into mail_pool (day, ref, kind, ent) values (?, ?, 'notice', 'ent_001')").run(DAY, 'ent_002:odd');
    // The lookup finds no row of ent_002, and the insert meets the key of the other row: the call fails and the mail stops.
    await expect(reserve('ent_002', 'notice', 'ent_002:odd')).rejects.toThrow();
    expect(rows()).toBe(1);
  });
});
