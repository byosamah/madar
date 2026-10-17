import { describe, expect, it } from 'vitest';
import { capRefusal, DAY_CAP_TTL_MS, dayCapOf } from './cap';
import { httpOf, nodeOffice } from './test/nodeOffice';

const day = (o: Partial<{ rows_read: number; rows_written: number; requests: number }> = {}) => ({ rows_read: 0, rows_written: 0, requests: 0, calls: 0, worker_requests: 0, ...o });
const update = { i: 0, name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Capped' } } };
const list = { i: 0, name: 'tasks.list', input: {} };

describe('the day cap of the test Worker (server/office/cap.ts)', () => {
  it('reads the cap of the var, and no cap when the var is not set', () => {
    expect(dayCapOf('rows_written=50000,rows_read=2500000,requests=50000')).toEqual({ rowsWritten: 50_000, rowsRead: 2_500_000, requests: 50_000 });
    expect(dayCapOf(undefined)).toBeNull();
    expect(dayCapOf('')).toBeNull();
    expect(() => dayCapOf('rows_written=many')).toThrow('MADAR_DAY_CAP');
    expect(() => dayCapOf('rows=10')).toThrow('MADAR_DAY_CAP');
    expect(() => dayCapOf('rows_written=0')).toThrow('MADAR_DAY_CAP');
  });

  it('refuses a write over the rows written, and lets a read through', () => {
    const cap = { rowsWritten: 100 };
    expect(capRefusal(day({ rows_written: 100 }), cap, true)?.details).toEqual({ reason: 'busy' });
    expect(capRefusal(day({ rows_written: 100 }), cap, false)).toBeUndefined();
    expect(capRefusal(day({ rows_written: 99 }), cap, true)).toBeUndefined();
  });

  it('refuses every call over the rows read or the requests', () => {
    expect(capRefusal(day({ rows_read: 10 }), { rowsRead: 10 }, false)?.message).toContain('03:00 Riyadh');
    expect(capRefusal(day({ requests: 5 }), { requests: 5 }, false)).toBeDefined();
    expect(capRefusal(day({ requests: 4 }), { requests: 5 }, false)).toBeUndefined();
  });

  it('stops a write batch of the copy at the cap, with the busy words, and serves a read batch', async () => {
    const t = await nodeOffice({ env: { MADAR_DAY_CAP: 'rows_written=10' } });
    t.raw.exec(`insert into usage_day (day, rows_written) values ('2026-10-04', 10)`);
    const out = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [update], overviewCalls: 0, worker: 0 }, t.net);
    expect(out.ok === false && out.error.details).toEqual({ reason: 'busy' });
    const read = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [list], overviewCalls: 0, worker: 0 }, t.net);
    expect(read.ok === false && read.error.details?.reason).not.toBe('busy');
  });

  it('acts on no copy with no cap', async () => {
    const t = await nodeOffice();
    t.raw.exec(`insert into usage_day (day, rows_written, rows_read, requests) values ('2026-10-04', 1000000, 100000000, 1000000)`);
    const out = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [update], overviewCalls: 0, worker: 0 }, t.net);
    expect(out.ok === false && out.error.details?.reason).not.toBe('busy');
  });

  it('lets a sign-in through over the rows written, refuses it over the rows read, and refuses an MCP request over the rows written', async () => {
    const t = await nodeOffice({ env: { MADAR_DAY_CAP: 'rows_written=10,rows_read=1000000' } });
    t.raw.exec(`insert into usage_day (day, rows_written) values ('2026-10-04', 10)`);
    const signin = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'a@madar.test', password: 'x' }));
    expect(signin.body).not.toContain('busy');
    const mcp = await t.route(httpOf('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(mcp.status).toBe(503);
    expect(mcp.body).toContain('busy');
    const forgot = await t.route(httpOf('POST', '/api/auth/forgot', { email: 'a@madar.test' }));
    expect(forgot.body).not.toContain('busy');

    const read = await nodeOffice({ env: { MADAR_DAY_CAP: 'rows_read=10' } });
    read.raw.exec(`insert into usage_day (day, rows_read) values ('2026-10-04', 10)`);
    const capped = await read.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'a@madar.test', password: 'x' }));
    expect(capped.body).toContain('busy');
    const forgotCapped = await read.route(httpOf('POST', '/api/auth/forgot', { email: 'a@madar.test' }));
    expect(forgotCapped.body).toContain('busy');
  });

  it('reads the day counts again after one minute, so a new day row takes effect', async () => {
    const t = await nodeOffice({ env: { MADAR_DAY_CAP: 'rows_written=10' } });
    const first = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [update], overviewCalls: 0, worker: 0 }, t.net);
    expect(first.ok === false && first.error.details?.reason).not.toBe('busy');
    t.raw.exec(`insert into usage_day (day, rows_written) values ('2026-10-04', 10)`);
    const held = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [update], overviewCalls: 0, worker: 0 }, t.net);
    expect(held.ok === false && held.error.details?.reason).not.toBe('busy');
    t.clock.advance(DAY_CAP_TTL_MS + 1);
    const later = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [update], overviewCalls: 0, worker: 0 }, t.net);
    expect(later.ok === false && later.error.details).toEqual({ reason: 'busy' });
  });
});
