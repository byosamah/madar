import { beforeAll, describe, expect, it } from 'vitest';
import type { Notification } from '../../../src/api/contract/entities';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { ACTION_TRIGGERS } from '../../../src/api/handlers/notifications';
import { runBoth, type Run } from './compare';

/**
 * The Inbox loader and a notice of a hidden project (hidden projects, owner 2026-10-22, wave D3; security review of the notice commit). The
 * loader must give the list and the bell count of the whole office, for a notice of a project hidden after the notice, of a deleted
 * hidden project, and of a project that neither the office nor a delete event holds (fail closed).
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const STAMP = '2026-10-04T09:00:00.000+03:00';
const HIDDEN = 'prj_001';
const OUTSIDER = 'usr_003';
const CHOSEN = 'usr_007';
const LEADER = 'usr_002';
const ADMIN = 'usr_001';
let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

type View = { notification: Notification; gone: boolean; target: string; projectCode: string | null };

async function same(state: State, name: 'notifications.list' | 'notifications.count', actorId: string): Promise<Run> {
  const { whole, scoped } = await runBoth(state, name, {}, actorId, { now: NOW, correlationId: 'cor_test' });
  expect(scoped, `${name} as ${actorId}`).toEqual(whole);
  return whole;
}
const views = async (state: State, actor: string) => (await same(state, 'notifications.list', actor)).outcome.output as View[];
const count = async (state: State, actor: string) => (await same(state, 'notifications.count', actor)).outcome.output as { unread: number; badge: number };

function hidden(): State {
  const state = structuredClone(seed);
  state.projects[HIDDEN] = { ...state.projects[HIDDEN], access: { hidden: true, viewerIds: [CHOSEN] } };
  return state;
}

function notices(state: State, userId: string, ids: { task: string; update: string; project: string }, first = 801): void {
  const base = { userId, actorId: LEADER, read: false, createdAt: STAMP, dedupeKey: null };
  const id = (n: number) => `ntf_${first + n}`;
  state.notifications[id(0)] = { ...base, id: id(0), trigger: 'task_assigned', targetType: 'task', targetId: ids.task };
  state.notifications[id(1)] = { ...base, id: id(1), trigger: 'mention', targetType: 'update', targetId: ids.update };
  state.notifications[id(2)] = { ...base, id: id(2), trigger: 'added_to_project', targetType: 'project', targetId: ids.project };
}

/** The first task and post of the project, and the names that an outsider must never read. */
function itemsOf(state: State) {
  const task = Object.values(state.tasks).find((t) => t.projectId === HIDDEN)!;
  const update = Object.values(state.updates).find((u) => u.projectId === HIDDEN)!;
  return { task, update, project: state.projects[HIDDEN] };
}

function deleteEvent(state: State, id: string, verb: string, targetType: 'task' | 'update' | 'project', targetId: string, before: unknown): void {
  const seq = Math.max(...Object.values(state.events).map((e) => e.seq)) + 1;
  state.events[id] = {
    id, seq, projectId: HIDDEN, actorId: LEADER, actorKind: 'human', actingForId: LEADER, correlationId: `sty_${id}`, verb, targetType, targetId, before, after: null,
    createdAt: STAMP, undoneBy: null,
  } as never;
}

const text = (value: unknown) => JSON.stringify(value);
const MINE = ['ntf_801', 'ntf_802', 'ntf_803'];
/** The notices of these tests among the notices of the sample office. */
const mineOf = (list: View[]) => list.filter((view) => MINE.includes(view.notification.id));
/** The number the bell must show: the unread notices of an action that read as live in the list. */
const badgeOf = (list: View[]) => list.filter((view) => !view.notification.read && ACTION_TRIGGERS.has(view.notification.trigger) && !view.gone).length;

describe('the notice of a project hidden after the notice', () => {
  it('reads as gone and counts as gone for an outsider, on the loader and on the whole office, and stays whole for the people of the project', async () => {
    const state = hidden();
    const { task, update, project } = itemsOf(state);
    notices(state, OUTSIDER, { task: task.id, update: update.id, project: project.id });
    const all = await views(state, OUTSIDER);
    const list = mineOf(all);
    expect(list).toHaveLength(3);
    for (const view of list) {
      expect(view.gone).toBe(true);
      expect(view.target).toBe('');
      expect(view.projectCode).toBeNull();
      expect(text(view)).not.toContain(project.name);
      expect(text(view)).not.toContain(task.title);
    }
    // The bell never counts such a notice differently from the list.
    expect((await count(state, OUTSIDER)).badge).toBe(badgeOf(all));
    for (const person of [LEADER, CHOSEN, ADMIN]) {
      const mine = structuredClone(state);
      notices(mine, person, { task: task.id, update: update.id, project: project.id });
      const seen = mineOf(await views(mine, person));
      // A chosen person is no team member: the post and the project open, the to-do of the project too.
      expect(seen.map((view) => view.gone), person).toEqual([false, false, false]);
      expect((await count(mine, person)).badge, person).toBe(badgeOf(await views(mine, person)));
    }
  });
});

describe('the notice of a deleted hidden project', () => {
  function deleted(): State {
    const state = hidden();
    const { task, update, project } = itemsOf(state);
    notices(state, OUTSIDER, { task: task.id, update: update.id, project: project.id });
    notices(state, LEADER, { task: task.id, update: update.id, project: project.id }, 811);
    deleteEvent(state, 'evt_801', 'task.deleted', 'task', task.id, task);
    deleteEvent(state, 'evt_802', 'update.deleted', 'update', update.id, update);
    deleteEvent(state, 'evt_803', 'project.deleted', 'project', project.id, project);
    delete state.tasks[task.id];
    delete state.updates[update.id];
    delete state.projects[HIDDEN];
    return state;
  }

  it('reads as gone for an outsider and names nothing, on the loader as on the whole office', async () => {
    const state = deleted();
    const { task, project } = { task: seed.tasks[Object.values(seed.tasks).find((t) => t.projectId === HIDDEN)!.id], project: seed.projects[HIDDEN] };
    const all = await views(state, OUTSIDER);
    const list = mineOf(all);
    expect(list).toHaveLength(3);
    for (const view of list) {
      expect(view.gone).toBe(true);
      expect(text(view)).not.toContain(project.name);
      expect(text(view)).not.toContain(task.title);
      expect(view.projectCode).toBeNull();
    }
    expect((await count(state, OUTSIDER)).badge).toBe(badgeOf(all));
  });

  it('keeps the last name of the deleted hidden project for its leader', async () => {
    const state = deleted();
    const mine = (await views(state, LEADER)).find((view) => view.notification.id === 'ntf_813')!;
    expect(mine.target).toBe(seed.projects[HIDDEN].name);
  });
});

describe('a notice of a project that neither the office nor a delete event holds (fail closed)', () => {
  it('reads as gone for a person without "See hidden projects"', async () => {
    const state = structuredClone(seed);
    const task = Object.values(state.tasks).find((t) => t.projectId === HIDDEN)!;
    state.tasks[task.id] = { ...task, projectId: 'prj_099' };
    delete state.projects.prj_099;
    state.notifications.ntf_821 = {
      id: 'ntf_821', userId: OUTSIDER, trigger: 'task_assigned', actorId: LEADER, targetType: 'task', targetId: task.id, read: false, createdAt: STAMP, dedupeKey: null,
    };
    const list = (await views(state, OUTSIDER)).find((view) => view.notification.id === 'ntf_821')!;
    expect(list.gone).toBe(true);
    expect(list.target).toBe('');
    expect((await count(state, OUTSIDER)).badge).toBe(badgeOf(await views(state, OUTSIDER)));
  });
});

describe('the hidden view of a notice', () => {
  it('drops the message, the story, the day, the people of a copy and the actor, and puts a placeholder in the target', async () => {
    const state = hidden();
    const { task } = itemsOf(state);
    state.notifications.ntf_831 = {
      id: 'ntf_831', userId: OUTSIDER, trigger: 'due_tomorrow', actorId: LEADER, targetType: 'task', targetId: task.id, read: false, createdAt: STAMP, dedupeKey: null,
      correlationId: 'sty_secret', dueDate: '2026-10-09', messageId: 'cmt_555', forUserIds: [LEADER],
    };
    const view = (await views(state, OUTSIDER)).find((one) => one.notification.id === 'ntf_831') as View & { actor: unknown };
    expect(view.gone).toBe(true);
    const n = view.notification as Notification;
    expect(n.targetId).toBe('hidden');
    for (const key of ['forUserIds', 'messageId', 'correlationId', 'dueDate'] as const) expect(n, key).not.toHaveProperty(key);
    expect(n.actorId).toBeNull();
    expect(view.actor).toBeNull();
    expect(text(view)).not.toContain(task.id);
  });
});
