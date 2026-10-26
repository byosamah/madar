import { describe, expect, it } from 'vitest';
import { sharedCalls } from '../../src/api/sharedCalls';
import { serverCallMap } from '../core/serverCallMap';
import { INTERNAL_LOADER_OF, LOADER_OF } from '../data/loaders/index';
import { SERVER_CALLS, SERVER_HOOKS } from '../calls/index';
import { MCP_ALLOW, MCP_ADMIN, MCP_BY_RIGHT, MCP_DENY } from '../mcp/tools';
import { DAFTRA_INTERNAL_CALLS, DAFTRA_PAID_CALL } from './paidCall';

/** The internal call of the job step daftra (server/daftra/paidCall.ts): reachable by the job only. */
describe('the internal paid call', () => {
  it('has a loader of its own, and the public loader list does not hold it', () => {
    expect(Object.keys(INTERNAL_LOADER_OF)).toEqual([DAFTRA_PAID_CALL]);
    expect(Object.keys(LOADER_OF)).not.toContain(DAFTRA_PAID_CALL);
  });

  it('is in no public list: not the shared calls, not the server calls, not the hooks, not the call map, and no MCP list', () => {
    expect(Object.keys(sharedCalls)).not.toContain(DAFTRA_PAID_CALL);
    expect(Object.keys(SERVER_CALLS)).not.toContain(DAFTRA_PAID_CALL);
    expect(Object.keys(SERVER_HOOKS)).not.toContain(DAFTRA_PAID_CALL);
    expect(serverCallMap.has(DAFTRA_PAID_CALL)).toBe(false);
    for (const list of [MCP_ALLOW, MCP_ADMIN, MCP_DENY, Object.keys(MCP_BY_RIGHT)] as readonly (readonly string[])[]) expect(list).not.toContain(DAFTRA_PAID_CALL);
  });

  it('is the only entry of its own map, a write', () => {
    expect([...DAFTRA_INTERNAL_CALLS.keys()]).toEqual([DAFTRA_PAID_CALL]);
    expect(DAFTRA_INTERNAL_CALLS.get(DAFTRA_PAID_CALL)).toMatchObject({ kind: 'shared', readOnly: false });
  });

  it('takes an account name, an invoice id and a day: a bad input is refused before any change', () => {
    const entry = DAFTRA_INTERNAL_CALLS.get(DAFTRA_PAID_CALL)!;
    const good = { id: 'pay_001', account: 'MAZJ', invoiceId: '1830', receivedOn: '2026-10-22' };
    expect(entry.input.safeParse(good).success).toBe(true);
    for (const bad of [{ account: 'mazj' }, { account: 'M' }, { invoiceId: '' }, { receivedOn: '22/10/2026' }, { id: 'prj_001' }]) {
      expect(entry.input.safeParse({ ...good, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
