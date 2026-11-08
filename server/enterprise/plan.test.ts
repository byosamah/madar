import { describe, expect, it } from 'vitest';
import { capVerdict, FREE_LIMITS, planFrom, shareCapOf, warnings } from './plan';
import type { DayCounts } from './types';

const plan = planFrom(() => undefined);
const day = (o: Partial<DayCounts>): DayCounts => ({ requests: 0, rowsRead: 0, rowsWritten: 0, mails: 0, ...o });

describe('the plan settings', () => {
  it('reads the Free limits with no variable', () => expect(plan).toEqual({ limits: FREE_LIMITS, share: 0.1 }));
  it('reads the MADAR_PLAN_* variables and the share', () => {
    const p = planFrom((n) => ({ MADAR_PLAN_REQUESTS: '200000', MADAR_ENTERPRISE_SHARE: '0.25' })[n]);
    expect(p.limits.requests).toBe(200_000);
    expect(p.share).toBe(0.25);
  });
  it('names the variable in the error of a bad value', () => {
    expect(() => planFrom((n) => (n === 'MADAR_ENTERPRISE_SHARE' ? '2' : undefined))).toThrow('MADAR_ENTERPRISE_SHARE');
    expect(() => planFrom((n) => (n === 'MADAR_PLAN_MAILS' ? '-5' : undefined))).toThrow('MADAR_PLAN_MAILS');
    expect(() => planFrom((n) => (n === 'MADAR_PLAN_ROWS_READ' ? 'many' : undefined))).toThrow('MADAR_PLAN_ROWS_READ');
  });
  it('gives the share of each metered limit', () => expect(shareCapOf(plan)).toEqual({ requests: 10_000, rowsRead: 500_000, rowsWritten: 10_000 }));
});

describe('the cap rule', () => {
  it('never refuses ENT_VADO', () =>
    expect(capVerdict({ ent: 'ent_001', plan, own: day({ requests: 1e9 }), account: day({ rowsRead: 1e9 }), writes: true })).toEqual({ allowed: true }));
  it('refuses another enterprise at its share of requests', () => {
    expect(capVerdict({ ent: 'ent_002', plan, own: day({ requests: 10_000 }), account: day({}), writes: false })).toEqual({ allowed: false, reason: 'busy' });
    expect(capVerdict({ ent: 'ent_002', plan, own: day({ requests: 9_999 }), account: day({}), writes: false }).allowed).toBe(true);
  });
  it('rows written over the share refuse a write only', () => {
    const own = day({ rowsWritten: 10_000 });
    expect(capVerdict({ ent: 'ent_002', plan, own, account: day({}), writes: true }).allowed).toBe(false);
    expect(capVerdict({ ent: 'ent_002', plan, own, account: day({}), writes: false }).allowed).toBe(true);
  });
  it('stops every other enterprise at 90 percent of the account', () => {
    const account = day({ rowsRead: 4_500_000 });
    expect(capVerdict({ ent: 'ent_002', plan, own: day({}), account, writes: false }).allowed).toBe(false);
    expect(capVerdict({ ent: 'ent_001', plan, own: day({}), account, writes: false }).allowed).toBe(true);
  });
  it('stops a write only at 90 percent of the rows written of the account', () => {
    const account = day({ rowsWritten: 90_000 });
    expect(capVerdict({ ent: 'ent_002', plan, own: day({}), account, writes: true }).allowed).toBe(false);
    expect(capVerdict({ ent: 'ent_002', plan, own: day({}), account, writes: false }).allowed).toBe(true);
  });
  it('warns at 70 percent', () => expect(warnings(plan, day({ requests: 70_000, rowsRead: 100 }))).toEqual(['requests']));
});
