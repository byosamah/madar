import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { State } from '../../../api/store';
import { renderHeldRemoteApp, type Asked } from '../../../test/heldRemoteApp';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
/** An office task that Omar made and Sara leads (as in OfficeTasks.test.tsx). */
const withOfficeTask = (state: State) => {
  state.session.currentUserId = 'usr_005';
  state.tasks.tsk_900 = {
    id: 'tsk_900', projectId: null, stageId: null, title: 'Renew the trade licence', description: '', ownerId: 'usr_005', status: 'todo',
    dueDate: '2026-09-28', flagged: false, needsReview: true, checklist: [], createdBy: 'usr_004', createdAt: '2026-09-29T09:00:00.000+03:00',
    completedAt: null,
  };
  state.counters.tsk = Math.max(state.counters.tsk ?? 0, 900);
};
const flush = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const timesAsked = (asked: Asked[], name: string, input: unknown) => asked.filter((call) => call.name === name && same(call.input, input)).length;
const observed = (client: QueryClient, name: string, input: unknown) =>
  client.getQueryCache().find({ queryKey: ['api', name, input], exact: true })?.getObserversCount() ?? 0;

/** Waits until no new call goes out for a while: the reads of the screen settled. */
async function settle(asked: Asked[]) {
  let seen = -1;
  while (seen !== asked.length) {
    seen = asked.length;
    await flush(150);
  }
}

/**
 * Loads the list screen first, as a person sees it before a press. Then the task link opens with every answer held: each read
 * of the panel starts before the first answer, the panel mounts the same key, and the key goes to the server once.
 */
async function expectOneTrip(base: string, path: string, prepare: (state: State) => void, reads: [string, unknown][], title: string) {
  const { asked, hold, queryClient, release, router } = await renderHeldRemoteApp(base, prepare);
  await waitFor(() => expect(queryClient.getQueryData(['api', 'session.get', {}])).toBeDefined(), { timeout: 10_000 });
  await settle(asked);
  const from = asked.length;
  hold();
  await act(async () => { await router.navigate(path); });
  await flush();
  for (const [name, input] of reads) expect(asked.slice(from), `${name} ${JSON.stringify(input)} before the first answer`).toContainEqual({ name, input });
  release();
  expect(await screen.findByRole('dialog', { name: title }, { timeout: 10_000 })).toBeInTheDocument();
  await waitFor(() => { for (const [name, input] of reads) expect(observed(queryClient, name, input), `${name} mounted`).toBeGreaterThan(0); }, { timeout: 10_000 });
  await settle(asked);
  for (const [name, input] of reads) expect(timesAsked(asked, name, input), `${name} asked once`).toBe(1);
}

describe('the task panel outside its project, real build (performance audit 2026-10-07, FET-1)', () => {
  it('asks the project, the task and its files in the first round trip, from Home', async () => {
    await expectOneTrip('/', '/?task=tsk_007&project=prj_001', as('usr_001'), [
      ['projects.get', { id: 'prj_001' }],
      ['tasks.get', { id: 'tsk_007' }],
      ['files.list', { projectId: 'prj_001', taskId: 'tsk_007' }],
    ], 'Stair details');
    const sheet = screen.getByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).getByLabelText('Lead')).toHaveDisplayValue('Yousef Saleh');
  }, 30_000);

  it('asks the task and its files in the first round trip, for an office task on Tasks', async () => {
    await expectOneTrip('/work', '/work?task=tsk_900', withOfficeTask, [
      ['tasks.get', { id: 'tsk_900' }],
      ['files.list', { taskId: 'tsk_900' }],
    ], 'Renew the trade licence');
  }, 30_000);

  it('also asks the comments in the first round trip when the link opens the Conversation', async () => {
    await expectOneTrip('/', '/?task=tsk_007&project=prj_001&thread=1', as('usr_006'), [
      ['projects.get', { id: 'prj_001' }],
      ['tasks.get', { id: 'tsk_007' }],
      ['files.list', { projectId: 'prj_001', taskId: 'tsk_007' }],
      ['comments.list', { targetType: 'task', targetId: 'tsk_007' }],
    ], 'Stair details');
    expect(await screen.findByRole('textbox', { name: 'Add a comment' }, { timeout: 10_000 })).toBeInTheDocument();
  }, 30_000);
});
