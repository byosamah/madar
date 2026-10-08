import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderHeldRemoteApp } from '../../test/heldRemoteApp';

// Hala is the Admin and leads the clinic project. The thread of one clinic task holds one comment.
const withTaskTalk = (state: State) => {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006');
  if (!task) throw new Error('The sample has no task in the clinic project.');
  task.title = 'Room finish schedule';
  for (const [id, c] of Object.entries(state.comments)) if (c.targetType === 'task' && c.targetId === task.id) delete state.comments[id];
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
};
const CANNOT = 'Only the project team can comment here.';
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

/** Notes whether a text ever showed on the page, also for one render only. */
function watchFor(text: string): { seen: boolean; stop: () => void } {
  const watch = { seen: false, stop: () => undefined as void };
  const observer = new MutationObserver(() => {
    if (document.body.textContent?.includes(text)) watch.seen = true;
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  watch.stop = () => observer.disconnect();
  return watch;
}

describe('a task thread in the Inbox, real build (performance audit 2026-10-07, FET-M2)', () => {
  it('asks projects.get with tasks.get when the Inbox row names the project, and never shows the team-only line to the leader', async () => {
    const { callsOf, hold, release, store } = await renderHeldRemoteApp('/inbox', withTaskTalk);
    const taskId = Object.values(store.state.tasks).find((t) => t.title === 'Room finish schedule')?.id ?? '';
    const row = await within(await screen.findByRole('list', { name: 'Chats' }, { timeout: 10_000 })).findByRole('link', { name: /Room finish schedule/ }, { timeout: 10_000 });
    const cannot = watchFor(CANNOT);
    hold();
    await userEvent.click(row);
    await flush();
    expect(callsOf('tasks.get')).toContainEqual({ id: taskId });
    expect(callsOf('projects.get')).toContainEqual({ id: 'prj_006' });
    release();
    expect(await screen.findByRole('textbox', { name: 'Message' }, { timeout: 10_000 })).toBeInTheDocument();
    await flush();
    cannot.stop();
    expect(cannot.seen).toBe(false);
    expect(screen.queryByText(CANNOT)).toBeNull();
  }, 30_000);

  it('with no cached Inbox list, asks projects.get after tasks.get as before', async () => {
    const seed = await renderHeldRemoteApp('/', withTaskTalk);
    const taskId = Object.values(seed.store.state.tasks).find((t) => t.title === 'Room finish schedule')?.id ?? '';
    seed.unmount();
    const { callsOf, releaseHeld } = await renderHeldRemoteApp(`/inbox/${taskId}`, withTaskTalk, { hold: true });
    await flush();
    expect(callsOf('tasks.get')).toContainEqual({ id: taskId });
    expect(callsOf('projects.get')).toEqual([]);
    releaseHeld();
    await waitFor(() => expect(callsOf('projects.get')).toContainEqual({ id: 'prj_006' }), { timeout: 10_000 });
    releaseHeld();
  }, 30_000);
});
