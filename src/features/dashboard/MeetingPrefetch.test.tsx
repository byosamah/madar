import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderHeldRemoteApp, type Asked } from '../../test/heldRemoteApp';

const MEETING = '/dashboard/meeting?mode=projects';

// The agenda shows the late projects first. Shore Walk Retail Kiosks is late here, so it is the first project screen.
// Progress photos (tsk_130) is in progress there (as in MeetingActInPlace.test.tsx).
const shoreWalkFirst = (state: State) => {
  state.projects.prj_011.healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
};
const asMember = (state: State) => {
  shoreWalkFirst(state);
  state.session.currentUserId = 'usr_006';
};
const flush = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const has = (asked: Asked[], name: string, input: unknown) => asked.some((call) => call.name === name && same(call.input, input));

/** Waits until no new call goes out for a while: the reads of the screen settled. */
async function settle(asked: Asked[]) {
  let seen = -1;
  while (seen !== asked.length) {
    seen = asked.length;
    await flush(150);
  }
}

/** The keys that the panels of one meeting project screen mount (MeetingProjects.tsx and meeting/*). */
const projectKeys = (projectId: string, payments: boolean): [string, unknown][] => [
  ['projects.get', { id: projectId }],
  ['updates.list', { projectId, filter: 'posts' }],
  ['tasks.list', { projectId, activeProjectsOnly: false }],
  ['tracker.list', { projectId, openOnly: true }],
  ['files.list', { projectId }],
  ...(payments ? [['payments.list', { projectId }] as [string, unknown]] : []),
];

/** Moves the meeting one project on with the arrow key, and gives the id of the project that shows then. */
async function nextProject(store: { state: State }, before: string): Promise<string> {
  await userEvent.keyboard('{ArrowRight}');
  const article = await waitFor(() => {
    const shown = screen.getByRole('article');
    expect(shown).not.toHaveAccessibleName(before);
    return shown;
  }, { timeout: 10_000 });
  const name = article.getAttribute('aria-label');
  const project = Object.values(store.state.projects).find((item) => item.name === name);
  if (!project) throw new Error(`No project named ${name}.`);
  return project.id;
}

describe('the meeting, real build (performance audit 2026-10-07, FET-12 part a)', () => {
  it('asks the reads of the next project after the current one settles, so the arrow press asks nothing of them', async () => {
    const { asked, store } = await renderHeldRemoteApp(MEETING, shoreWalkFirst);
    const first = await screen.findByRole('article', {}, { timeout: 10_000 });
    expect(first).toHaveAccessibleName('Shore Walk Retail Kiosks');
    await settle(asked);
    const pressedAt = asked.length;
    const nextId = await nextProject(store, 'Shore Walk Retail Kiosks');
    await settle(asked);
    // Hala is the Admin, so she sees the payments and her screen asks for them.
    for (const [name, input] of projectKeys(nextId, true)) {
      expect(has(asked.slice(0, pressedAt), name, input), `${name} ${JSON.stringify(input)} before the press`).toBe(true);
      expect(has(asked.slice(pressedAt), name, input), `${name} ${JSON.stringify(input)} after the press`).toBe(false);
    }
  }, 60_000);

  it('asks no payments for a person outside the payment roles', async () => {
    const { asked, store } = await renderHeldRemoteApp(MEETING, asMember);
    await screen.findByRole('article', {}, { timeout: 10_000 });
    await settle(asked);
    const pressedAt = asked.length;
    const nextId = await nextProject(store, 'Shore Walk Retail Kiosks');
    await settle(asked);
    for (const [name, input] of projectKeys(nextId, false)) expect(has(asked.slice(0, pressedAt), name, input), `${name} before the press`).toBe(true);
    expect(asked.some((call) => call.name === 'payments.list')).toBe(false);
  }, 60_000);
});

describe('the task panel over the meeting, real build (performance audit 2026-10-07, FET-1)', () => {
  it('asks the task and its files in one round trip when the meeting list holds the task', async () => {
    const { asked, hold, release } = await renderHeldRemoteApp(MEETING, shoreWalkFirst);
    const article = await screen.findByRole('article', {}, { timeout: 10_000 });
    await settle(asked);
    hold();
    const attention = within(within(article).getByRole('region', { name: 'Needs attention' }));
    await userEvent.click(attention.getByRole('button', { name: /^Progress photos/ }));
    await flush();
    expect(asked).toContainEqual({ name: 'tasks.get', input: { id: 'tsk_130' } });
    expect(asked).toContainEqual({ name: 'files.list', input: { projectId: 'prj_011', taskId: 'tsk_130' } });
    release();
    expect(await screen.findByRole('dialog', { name: 'Progress photos' }, { timeout: 10_000 })).toBeInTheDocument();
  }, 60_000);

  it('closes the panel on any error of the task, with no error line in between', async () => {
    let failed = false;
    const watch = new MutationObserver(() => {
      if (document.body.textContent?.includes('The data did not load.')) failed = true;
    });
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    await renderHeldRemoteApp(`${MEETING}&task=tsk_130`, shoreWalkFirst, { fail: (name) => name === 'tasks.get' });
    await screen.findByRole('article', {}, { timeout: 10_000 });
    await waitFor(() => expect(window.location.hash).not.toContain('task='), { timeout: 10_000 });
    await flush(100);
    watch.disconnect();
    expect(screen.queryByRole('dialog', { name: 'Progress photos' })).toBeNull();
    expect(failed).toBe(false);
  }, 60_000);
});
