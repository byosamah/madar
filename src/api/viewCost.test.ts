import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { calls } from './calls';
import type { Event, Update } from './contract/entities';
import { resolveAuthority } from './execute';
import { ensureRights } from './rights';
import type { State } from './store';
import { feedFor, summaryOf, taskDetailOf, taskRowOf } from './views';
import { buildSeed } from '../data/seed';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from '../test/factories';

/**
 * The cost of the read views (speed review 2026-10-28). A list view must not scan a whole collection of the office once for each row
 * or each project. The scan tests count how often a view reads the keys of a collection. The pin tests fix the output of the views on
 * an office with to-dos that wait on others, and a feed with equal times, so a change of the lookups cannot change an answer.
 */

/** A state whose collections count how often a view lists their keys (Object.values, Object.keys, filter over values). */
function counted(state: State, names: ('tasks' | 'members' | 'stages' | 'deadlines' | 'updates' | 'events' | 'comments')[]): { state: State; scans: Record<string, number> } {
  const scans: Record<string, number> = Object.fromEntries(names.map((name) => [name, 0]));
  const copy: State = { ...state };
  for (const name of names) {
    copy[name] = new Proxy(state[name] as object, {
      ownKeys(target) {
        scans[name] += 1;
        return Reflect.ownKeys(target);
      },
    }) as never;
  }
  return { state: copy, scans };
}

/** Runs one call on a state as the person, with no output check, as the handler runs inside the server. */
function runCall(state: State, actorId: string, name: keyof typeof calls, input: Record<string, unknown>): unknown {
  const def = calls[name] as unknown as { input: { parse(value: unknown): unknown }; run(input: unknown, ctx: unknown, prepared: unknown): unknown };
  const { actor, authority } = resolveAuthority(state, actorId, def as never);
  const ctx = { state, actor, authority, correlationId: 'cost', stamp: '2026-09-30T09:00:00.000+03:00', today: TODAY, now: NOW, persistent: false };
  return def.run(def.input.parse(input), ctx, undefined);
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

let office: State;
beforeAll(async () => {
  setNow(NOW);
  office = await buildSeed(TODAY, async () => undefined);
  // To-dos that wait on the two to-dos before them, and stages that wait on the stage before them (the rows that need the lookups).
  const byProject = new Map<string, string[]>();
  for (const task of Object.values(office.tasks)) {
    if (task.projectId === null) continue;
    const list = byProject.get(task.projectId) ?? [];
    if (list.length >= 2 && list.length % 2 === 0) task.prerequisiteIds = [list[list.length - 1], list[list.length - 2]];
    list.push(task.id);
    byProject.set(task.projectId, list);
    if (task.status === 'done' && list.length % 3 === 0) task.status = 'in_progress';
  }
  for (const projectId of byProject.keys()) {
    const stages = Object.values(office.stages).filter((stage) => stage.projectId === projectId).sort((a, b) => a.order - b.order);
    stages.slice(1, 4).forEach((stage, index) => { stage.prerequisiteIds = [stages[index].id]; });
  }
  // Many feed rows with the same time, in the project with the most rows, so the order of equal times is pinned.
  const stamp = '2026-09-29T10:00:00.000+03:00';
  const base = Object.values(office.events).find((event) => event.verb === 'task.status_changed') as Event;
  for (let n = 0; n < 12; n += 1) {
    const id = `evt_${900 + n}`;
    office.events[id] = { ...structuredClone(base), id, seq: 9000 + n, projectId: 'prj_001', createdAt: stamp };
  }
  const post = Object.values(office.updates)[0] as Update;
  for (let n = 0; n < 3; n += 1) {
    const id = `upd_${900 + n}`;
    office.updates[id] = { ...structuredClone(post), id, projectId: 'prj_001', createdAt: stamp };
  }
});

describe('feedFor takes the newest rows before it labels them', () => {
  it('orders rows with equal times by their id, newest id first, across posts and changes', () => {
    const viewer = office.users[office.session.currentUserId];
    const items = feedFor(office, 'prj_001', 'all', 4, viewer);
    // Every row of the stamp has the same time, so the id decides: upd_902, upd_901, upd_900, then evt_911.
    expect(items.map((item) => item.id)).toEqual(['upd_902', 'upd_901', 'upd_900', 'evt_911']);
    expect(feedFor(office, 'prj_001', 'all', 2, viewer).map((item) => item.id)).toEqual(['upd_902', 'upd_901']);
    expect(feedFor(office, 'prj_001', 'tasks', 3, viewer).map((item) => item.id)).toEqual(['evt_911', 'evt_910', 'evt_909']);
  });

  it('asks the undo rule only for the rows that it returns', () => {
    const viewer = office.users[office.session.currentUserId];
    let asked = 0;
    const items = feedFor(office, 'prj_001', 'all', 2, viewer, () => { asked += 1; return false; });
    expect(items).toHaveLength(2);
    // Two posts lead the feed, so no change is a candidate beyond the two newest changes at most.
    expect(asked).toBeLessThanOrEqual(2);
  });

  it('gives the same rows for every limit as the full sort cut to that limit', () => {
    const viewer = office.users[office.session.currentUserId];
    for (const projectId of Object.keys(office.projects)) {
      for (const filter of ['all', 'posts', 'decisions', 'tasks', 'files'] as const) {
        const full = feedFor(office, projectId, filter, 500, viewer).map((item) => item.id);
        for (const limit of [1, 2, 3, 5, 40]) {
          expect(feedFor(office, projectId, filter, limit, viewer).map((item) => item.id), `${projectId} ${filter} ${limit}`).toEqual(full.slice(0, limit));
        }
      }
    }
  });
});

describe('projects.list reads each collection once, not once for each project', () => {
  it('scans the tasks, members, stages, deadlines, posts and changes at most twice', () => {
    const { state, scans } = counted(office, ['tasks', 'members', 'stages', 'deadlines', 'updates', 'events']);
    const rows = runCall(state, 'usr_001', 'projects.list', {}) as unknown[];
    expect(rows.length).toBe(Object.values(office.projects).filter((project) => project.status === 'active').length);
    expect(Object.keys(office.projects).length).toBeGreaterThan(8);
    for (const [name, count] of Object.entries(scans)) expect(count, name).toBeLessThanOrEqual(2);
  });

  it('gives a project the same summary with or without the shared lookups', () => {
    const viewer = office.users[office.session.currentUserId];
    for (const project of Object.values(office.projects)) {
      const rows = runCall(office, viewer.id, 'projects.list', { status: 'all' }) as { project: { id: string } }[];
      const own = rows.find((row) => row.project.id === project.id);
      expect(own).toEqual(summaryOf(office, project, TODAY, viewer));
    }
  });
});

describe('tasks.list reads the to-dos and stages once, not once for each waiting row', () => {
  it('scans the to-dos and stages at most twice, with many rows that wait', () => {
    const { state, scans } = counted(office, ['tasks', 'stages']);
    const rows = runCall(state, 'usr_001', 'tasks.list', {}) as { waitingFor: { tasks: unknown[]; stages: unknown[] } }[];
    expect(rows.filter((row) => row.waitingFor.tasks.length > 0).length).toBeGreaterThan(4);
    expect(rows.filter((row) => row.waitingFor.stages.length > 0).length).toBeGreaterThan(4);
    expect(scans.tasks).toBeLessThanOrEqual(2);
    expect(scans.stages).toBeLessThanOrEqual(2);
  });

  it('scans the comments at most twice for the comment count and the unread number of all rows (fbk_071)', () => {
    // Give the lead of each to-do a comment of another person, so every row has a number to count.
    const withTalk: State = structuredClone(office);
    let n = 0;
    for (const task of Object.values(withTalk.tasks)) {
      n += 1;
      const id = `cmt_${800 + n}`;
      withTalk.comments[id] = {
        id, targetType: 'task', targetId: task.id, authorId: task.ownerId === 'usr_002' ? 'usr_003' : 'usr_002', body: `Talk ${n}`,
        reactions: {}, fileIds: [], createdAt: `2026-09-29T11:${String(n % 60).padStart(2, '0')}:00.000+03:00`, editedAt: null,
      } as never;
    }
    const { state, scans } = counted(withTalk, ['comments']);
    const rows = runCall(state, 'usr_001', 'tasks.list', {}) as { unreadCount?: number }[];
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.some((row) => (row.unreadCount ?? 0) > 0)).toBe(true);
    expect(scans.comments).toBeLessThanOrEqual(2);
  });

  it('gives a row the same waiting lists as taskRowOf on its own', () => {
    const viewer = office.users[office.session.currentUserId];
    const rows = runCall(office, viewer.id, 'tasks.list', {}) as { task: { id: string } }[];
    for (const row of rows) expect(row).toEqual({ ...taskRowOf(office, office.tasks[row.task.id], TODAY, viewer), unreadCount: (row as { unreadCount?: number }).unreadCount });
  });
});

describe('the task panel reads the history of the to-do once', () => {
  it('scans the changes once for any person and any to-do, also when the delete flag asks who took the to-do', () => {
    // The lead of a to-do, who did not make it, reaches the take check of the delete flag (security review 2026-10-20).
    const viewers = Object.values(office.users).filter((user) => user.kind === 'human');
    let most = 0;
    let asked = 0;
    for (const task of Object.values(office.tasks).filter((one) => one.ownerId !== null)) {
      for (const viewer of viewers) {
        const { state, scans } = counted(office, ['events']);
        const detail = taskDetailOf(state, state.tasks[task.id], TODAY, ensureRights(state, viewer));
        if (detail.viewerCan.delete && viewer.id === task.ownerId && viewer.systemRole !== 'admin') asked += 1;
        most = Math.max(most, scans.events);
      }
    }
    // At least one lead of a to-do passes the take check, so the check was in the count.
    expect(asked).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(1);
  });
});

describe('the output of the read views stays the same (pins)', () => {
  const people = ['usr_001', 'usr_002', 'usr_003', 'usr_005'];

  it('projects.list', () => {
    const answers = people.map((id) => runCall(office, id, 'projects.list', { status: 'all' }));
    expect(digest(answers)).toBe('cf1a6a367e440281');
  });

  it('tasks.list, for the whole office, the mine filter and one project', () => {
    const answers = people.flatMap((id) => [
      runCall(office, id, 'tasks.list', {}), runCall(office, id, 'tasks.list', { filter: 'mine' }), runCall(office, id, 'tasks.list', { projectId: 'prj_001' }),
    ]);
    // The row has one new field (fbk_071). Without it the answers are the old ones: the pin of before the field stands.
    const withoutUnread = JSON.parse(JSON.stringify(answers, (key, value) => (key === 'unreadCount' ? undefined : value)));
    expect(digest(withoutUnread)).toBe('bbb89cb24534d52c');
    expect(digest(answers)).toBe('2c07c4f14258ec7b');
  });

  it('tasks.get for every to-do', () => {
    const answers = people.map((id) => Object.keys(office.tasks).map((taskId) => runCall(office, id, 'tasks.get', { id: taskId })));
    expect(digest(answers)).toBe('a7f0bd1d2ac1ffd0');
  });

  it('projects.get for every project', () => {
    const answers = people.map((id) => Object.keys(office.projects).map((projectId) => runCall(office, id, 'projects.get', { id: projectId })));
    expect(digest(answers)).toBe('23117f6ebf241926');
  });
});
