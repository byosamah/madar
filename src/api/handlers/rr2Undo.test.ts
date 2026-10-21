import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { Event, RoleSettings } from '../contract/entities';
import { NOW, testApi } from '../../test/factories';
import { without as off } from '../../test/rr2work';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The Undo of a CREATE event (security fix of role rights version 2, design 6.5). A person takes back a new item of their own (or of
 * their own agent) with the create right only. A new item of another person's agent, which the leader may take back through
 * ai.undoOthers, needs the right that deletes the item directly. People: usr_001 Admin, usr_002 leader of prj_001, usr_003 team member,
 * usr_005 agent of usr_003. The agent makes each item; the leader or the person takes it back.
 */
const pdf = () => new Blob(['x'], { type: 'application/pdf' });

function world(roles?: RoleSettings) {
  const t = testApi(calls);
  if (roles) t.store.state.settings.roles = roles;
  return t;
}

type T = ReturnType<typeof world>;
const eventOf = (t: T, verb: string): Event => Object.values(t.store.state.events).filter((e) => e.verb === verb).sort((a, b) => b.seq - a.seq)[0];
const undo = (t: T, who: string, verb: string) => {
  t.as(who);
  return t.api.call('events.undo', { eventId: eventOf(t, verb).id });
};

/** Each item that the agent of Sara (usr_003) makes, with the verb of its create event, and the switch that deletes it directly. */
const MAKERS: { name: string; verb: string; make: (t: T) => Promise<unknown>; create: Parameters<typeof off>[0]; remove: Parameters<typeof off>[0] }[] = [
  { name: 'a to-do', verb: 'task.created', make: (t) => t.api.call('tasks.create', { projectId: 'prj_001', title: 'By agent' }), create: 'task.add.team', remove: 'task.any.lead' },
  { name: 'a file', verb: 'file.added', make: (t) => t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() }), create: 'file.upload.team', remove: 'file.deleteAny.lead' },
  { name: 'a Tracker entry', verb: 'tracker.logged', make: (t) => t.api.call('tracker.log', { projectId: 'prj_001', type: 'message', direction: 'in', title: 'Client asks' }), create: 'tracker.log.team', remove: 'tracker.deleteAny.lead' },
  { name: 'a meeting', verb: 'meeting.created', make: (t) => t.api.call('meetings.create', { kind: 'client', title: 'Review', projectId: 'prj_001', startsAt: '2026-10-01T10:00:00+03:00' }), create: 'meeting.plan.team', remove: 'meeting.any.lead' },
];

describe('the Undo of a new item of the caller uses the create right only', () => {
  for (const item of MAKERS) {
    it(`${item.name}: the person takes back the item of the agent with the create right, also with the delete switch off`, async () => {
      const t = world();
      t.as('usr_005');
      await item.make(t);
      // The delete switches of the person go off. The create switch stays on.
      t.store.state.settings.roles = off('task.deleteOwn', 'file.deleteOwn', 'tracker.deleteOwn', 'meeting.editOwn');
      await expect(undo(t, 'usr_003', item.verb)).resolves.toBeTruthy();
    });

    it(`${item.name}: the person is refused when the create switch is off`, async () => {
      const t = world();
      t.as('usr_005');
      await item.make(t);
      t.store.state.settings.roles = off(item.create);
      await expect(undo(t, 'usr_003', item.verb)).rejects.toMatchObject({ code: 'forbidden' });
    });
  }

  it('a post and a comment: the author takes back their own with the create right, and is refused with it off', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = { ...Object.values(t.store.state.tasks)[0] ?? ({} as never), id: 'tsk_001' } as never;
    t.as('usr_005');
    await t.api.call('updates.create', { projectId: 'prj_001', body: 'By agent' });
    t.store.state.settings.roles = off('post.editOwn');
    await expect(undo(t, 'usr_003', 'update.posted')).resolves.toBeTruthy();
    const closed = world();
    closed.as('usr_005');
    await closed.api.call('updates.create', { projectId: 'prj_001', body: 'By agent' });
    closed.store.state.settings.roles = off('post.create.team');
    await expect(undo(closed, 'usr_003', 'update.posted')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the Undo of a new item of another person\'s agent needs the right that deletes it', () => {
  for (const item of MAKERS) {
    it(`${item.name}: the leader takes it back with the delete right, and is refused when that right is off even with the create switch on`, async () => {
      const on = world();
      on.as('usr_005');
      await item.make(on);
      await expect(undo(on, 'usr_002', item.verb)).resolves.toBeTruthy();
      const closed = world();
      closed.as('usr_005');
      await item.make(closed);
      closed.store.state.settings.roles = off(item.remove);
      await expect(undo(closed, 'usr_002', item.verb)).rejects.toMatchObject({ code: 'forbidden' });
      expect(eventOf(closed, item.verb).undoneBy).toBeFalsy();
    });
  }

  it('a post of the agent of another person stays with its author: the leader cannot take it back', async () => {
    const t = world();
    t.as('usr_005');
    await t.api.call('updates.create', { projectId: 'prj_001', body: 'By agent' });
    await expect(undo(t, 'usr_002', 'update.posted')).rejects.toMatchObject({ code: 'forbidden' });
    expect(Object.values(t.store.state.updates)).toHaveLength(1);
  });

  it('a comment of the agent of another person stays with its author too', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = { id: 'tsk_001', projectId: 'prj_001', stageId: 'stg_002', title: 'T', description: '', ownerId: 'usr_003', status: 'todo', dueDate: null, flagged: false, needsReview: true, checklist: [], createdBy: 'usr_002', createdAt: '2026-09-30T09:00:00.000+03:00', completedAt: null };
    t.store.state.counters.tsk = 1;
    t.as('usr_005');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'By agent' });
    await expect(undo(t, 'usr_002', 'comment.created')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(undo(t, 'usr_003', 'comment.created')).resolves.toBeTruthy();
  });

  it('shows the feed an Undo for the leader only when the delete right holds', async () => {
    const t = world();
    t.as('usr_005');
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'a.pdf', blob: pdf() });
    t.as('usr_002');
    const feed = async () => (await t.api.call('updates.list', { projectId: 'prj_001' })).find((item) => item.kind === 'event' && item.verb === 'file.added');
    expect(await feed()).toMatchObject({ canUndo: true });
    t.store.state.settings.roles = off('file.deleteAny.lead');
    expect(await feed()).toMatchObject({ canUndo: false });
  });
});

describe('the leader switch of ai.undoOthers still opens the Undo of an agent change', () => {
  it('refuses the leader when ai.undoOthers.lead is off', async () => {
    const t = world(off('ai.undoOthers.lead'));
    t.as('usr_005');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'By agent' });
    await expect(undo(t, 'usr_002', 'task.created')).rejects.toMatchObject({ code: 'forbidden' });
  });
});
