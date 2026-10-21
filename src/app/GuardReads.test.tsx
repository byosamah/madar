import { describe, expect, it } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { State } from '../api/store';
import { renderHeldRemoteApp, type Asked } from '../test/heldRemoteApp';
import { without } from '../test/rr2work';
import { GUARD_READS } from './guardReads';

/**
 * The guarded routes start their reads with the session (performance audit 2026-10-21, DF-7). RequireRight and the Admin page draw
 * nothing until session.get answers, so each screen read used to start one round trip later. Every list below is what its screen
 * asks for the link: the test holds every answer, sees the reads go out with session.get, then lets them come and checks that the
 * screen mounted the same keys and asked the server for none of them again.
 */
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const flush = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const timesAsked = (asked: Asked[], name: string, input: unknown) => asked.filter((call) => call.name === name && same(call.input, input)).length;
const observed = (client: QueryClient, name: string, input: unknown) =>
  client.getQueryCache().find({ queryKey: ['api', name, input], exact: true })?.getObserversCount() ?? 0;

type Read = { name: string; input: unknown };
const CASES: [string, string, Read[]][] = [
  ['Dashboard', '/dashboard', [
    { name: 'dashboard.get', input: { status: 'active' } }, { name: 'clients.list', input: {} }, { name: 'teams.list', input: {} },
  ]],
  ['Dashboard with filters in the link', '/dashboard?leader=usr_002&team=tm_001&view=schedule&status=on_hold', [
    { name: 'dashboard.get', input: { status: 'active', leaderId: 'usr_002', teamId: 'tm_001' } },
    { name: 'dashboard.get', input: { status: 'on_hold', leaderId: 'usr_002', teamId: 'tm_001' } },
    { name: 'clients.list', input: {} }, { name: 'teams.list', input: {} },
  ]],
  ['Meeting view', '/dashboard/meeting', [
    { name: 'dashboard.get', input: { status: 'active' } }, { name: 'tasks.list', input: { includeDone: false, activeProjectsOnly: false } },
    { name: 'users.list', input: {} }, { name: 'clients.list', input: {} }, { name: 'teams.list', input: {} }, { name: 'subCompanies.list', input: {} },
  ]],
  ['Meeting view with a status and a client', '/dashboard/meeting?status=all&client=cli_001', [
    { name: 'dashboard.get', input: { status: 'all', clientId: 'cli_001' } },
  ]],
  ['Open space', '/dashboard/space', [
    { name: 'projects.list', input: { status: 'all' } }, { name: 'tasks.list', input: { activeProjectsOnly: false, includeDone: false } },
    { name: 'users.list', input: {} }, { name: 'subCompanies.list', input: {} },
  ]],
  ['Open space with a sub-company', '/dashboard/space?subCompany=sub_001', [
    { name: 'projects.list', input: { status: 'all', subCompanyId: 'sub_001' } },
    { name: 'tasks.list', input: { activeProjectsOnly: false, includeDone: false, subCompanyId: 'sub_001' } },
  ]],
  ['Admin', '/admin', [
    { name: 'settings.get', input: {} }, { name: 'users.list', input: { includeInactive: true } }, { name: 'teams.list', input: {} },
  ]],
  ['Admin People', '/admin/people', [
    { name: 'settings.get', input: {} }, { name: 'users.list', input: { includeInactive: true } }, { name: 'teams.list', input: {} },
  ]],
];

describe('the reads of a guarded route start with session.get, real build (performance audit 2026-10-21, DF-7)', () => {
  it.each(CASES)('%s', async (_label, path, reads) => {
    const { asked, queryClient, release } = await renderHeldRemoteApp(path, as('usr_001'), { hold: true });
    await flush();
    expect(asked).toContainEqual({ name: 'session.get', input: {} });
    for (const read of reads) expect(asked, `${read.name} ${JSON.stringify(read.input)} with session.get`).toContainEqual({ name: read.name, input: read.input });
    release();
    await waitFor(() => { for (const read of reads) expect(observed(queryClient, read.name, read.input), `${read.name} ${JSON.stringify(read.input)} mounted`).toBeGreaterThan(0); }, { timeout: 10_000 });
    await flush(100);
    for (const read of reads) expect(timesAsked(asked, read.name, read.input), `${read.name} ${JSON.stringify(read.input)} asked once`).toBe(1);
  });

  it('keeps a list for every guarded screen, and none for the other screens', () => {
    expect(Object.keys(GUARD_READS).sort()).toEqual(['admin', 'dashboard', 'meeting', 'space']);
  });

  it('starts nothing for a person whose cached session lacks the switch', async () => {
    // usr_005 is a Member. The first screen is Tasks, so the session is in the cache when the person opens the Dashboard link.
    const app = await renderHeldRemoteApp('/work', (state) => {
      state.session.currentUserId = 'usr_005';
      state.settings.roles = without('dashboard.view');
    });
    await waitFor(() => expect(app.queryClient.getQueryData(['api', 'session.get', {}])).toBeDefined(), { timeout: 10_000 });
    await flush(100);
    const before = app.asked.length;
    await act(async () => { await app.router.navigate('/dashboard/meeting'); });
    await flush(100);
    expect(app.asked.slice(before).filter((call) => call.name === 'dashboard.get')).toEqual([]);
  });
});
