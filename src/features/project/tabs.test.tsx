import { describe, expect, it } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { State } from '../../api/store';
import { TODAY } from '../../test/factories';
import { renderHeldRemoteApp, type Asked } from '../../test/heldRemoteApp';
import { PROJECT_TABS, tabReads, type ProjectTab } from './tabs';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const flush = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const timesAsked = (asked: Asked[], name: string, input: unknown) => asked.filter((call) => call.name === name && same(call.input, input)).length;
const observed = (client: QueryClient, name: string, input: unknown) =>
  client.getQueryCache().find({ queryKey: ['api', name, input], exact: true })?.getObserversCount() ?? 0;

/** The tab and the link of a project page path. */
function linkOf(path: string): { tab: ProjectTab; params: URLSearchParams } {
  const params = new URLSearchParams(path.split('?')[1] ?? '');
  const raw = params.get('tab');
  return { tab: PROJECT_TABS.includes(raw as ProjectTab) ? (raw as ProjectTab) : 'overview', params };
}

/**
 * Opens the page with every answer held: each read of the tab must start with projects.get, before any answer. Then the
 * answers come: the tab must mount the same keys and ask the server for none of them again.
 */
async function expectOneTrip(path: string, prepare?: (state: State) => void) {
  const { tab, params } = linkOf(path);
  const reads = tabReads(tab, 'prj_001', params, { payments: false, today: TODAY });
  expect(reads.length).toBeGreaterThan(0);
  const { asked, queryClient, release } = await renderHeldRemoteApp(path, prepare, { hold: true });
  await flush();
  expect(asked).toContainEqual({ name: 'projects.get', input: { id: 'prj_001' } });
  for (const read of reads) expect(asked, `${read.name} ${JSON.stringify(read.input)} with projects.get`).toContainEqual({ name: read.name, input: read.input });
  release();
  await waitFor(() => { for (const read of reads) expect(observed(queryClient, read.name, read.input), `${read.name} ${JSON.stringify(read.input)} mounted`).toBeGreaterThan(0); }, { timeout: 10_000 });
  await flush(100);
  for (const read of reads) expect(timesAsked(asked, read.name, read.input), `${read.name} ${JSON.stringify(read.input)} asked once`).toBe(1);
  return { asked };
}

/** Opens Projects first, so the session is in the cache, then the project page with every answer held. */
async function fromProjects(userId: string) {
  const app = await renderHeldRemoteApp('/projects', as(userId));
  await waitFor(() => expect(app.queryClient.getQueryData(['api', 'session.get', {}])).toBeDefined(), { timeout: 10_000 });
  await flush(100);
  app.hold();
  await act(async () => { await app.router.navigate('/projects/prj_001'); });
  await flush();
  return app;
}

describe('the project page starts the reads of its tab with projects.get, real build (performance audit 2026-10-07, FET-2, LIV-1)', () => {
  it.each([
    '/projects/prj_001',
    '/projects/prj_001?tab=tasks',
    '/projects/prj_001?tab=tasks&show=mine',
    '/projects/prj_001?tab=tasks&show=no_lead',
    '/projects/prj_001?tab=activity',
    '/projects/prj_001?tab=activity&feed=posts',
    '/projects/prj_001?tab=files',
    '/projects/prj_001?task=tsk_007',
    '/projects/prj_001?tab=tasks&task=tsk_007',
    '/projects/prj_001?tab=tasks&task=tsk_007&thread=1',
  ])('%s', async (path) => {
    await expectOneTrip(path, as('usr_006'));
  }, 60_000);

  it('asks the Tracker rows of the Overview with projects.get, before any answer (LIV-1)', async () => {
    const { asked, release } = await renderHeldRemoteApp('/projects/prj_001', as('usr_006'), { hold: true });
    await flush();
    expect(asked).toContainEqual({ name: 'tracker.list', input: { projectId: 'prj_001', openOnly: true } });
    expect(asked).toContainEqual({ name: 'tasks.list', input: { projectId: 'prj_001', activeProjectsOnly: false } });
    expect(asked).toContainEqual({ name: 'updates.list', input: { projectId: 'prj_001', filter: 'posts' } });
    release();
  }, 60_000);

  it('asks the payments of the Overview with projects.get for the Admin', async () => {
    const { asked, queryClient, release } = await fromProjects('usr_001');
    expect(asked).toContainEqual({ name: 'payments.list', input: { projectId: 'prj_001' } });
    release();
    await waitFor(() => expect(observed(queryClient, 'payments.list', { projectId: 'prj_001' })).toBeGreaterThan(0), { timeout: 10_000 });
    await flush(100);
    expect(timesAsked(asked, 'payments.list', { projectId: 'prj_001' })).toBe(1);
  }, 60_000);

  it('asks no payments for a Member', async () => {
    const { asked, queryClient, release } = await fromProjects('usr_006');
    expect(asked).toContainEqual({ name: 'tracker.list', input: { projectId: 'prj_001', openOnly: true } });
    release();
    await waitFor(() => expect(observed(queryClient, 'tracker.list', { projectId: 'prj_001', openOnly: true })).toBeGreaterThan(0), { timeout: 10_000 });
    await flush(100);
    expect(asked.some((call) => call.name === 'payments.list')).toBe(false);
  }, 60_000);
});
