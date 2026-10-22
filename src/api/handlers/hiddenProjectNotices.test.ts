import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { setNow } from '../../lib/dates';
import { makeProject, makeTask, makeUser, makeWorld, NOW, STAMP, testApi } from '../../test/factories';
import type { Notification } from '../contract/entities';
import { copyForAdmins } from '../adminCopies';
import { memberKey, type State } from '../store';

beforeEach(() => setNow(NOW));

/**
 * The notices of a hidden project (hidden projects, owner 2026-10-22, wave D3). A notice of a project that the owner of the notice no
 * longer sees reads as gone, as the notice of an office to-do does: no words, no names, no link, no badge. prj_002 is hidden: leader
 * usr_002, team usr_003, chosen person usr_006. usr_004 is a Member outside it. usr_001 is the Admin.
 */
const ADMIN = 'usr_001';
const LEADER = 'usr_002';
const TEAM = 'usr_003';
const OUTSIDER = 'usr_004';
const CHOSEN = 'usr_006';
const HIDDEN = 'prj_002';
const NAME = 'Portfolio of secret works';

function world(): State {
  const state = makeWorld();
  state.users.usr_006 = makeUser('usr_006', { name: 'Chosen Person' });
  state.projects[HIDDEN] = makeProject({ id: HIDDEN, code: 'INT-26-001', name: NAME, leaderId: LEADER, access: { hidden: true, viewerIds: [CHOSEN] } });
  for (const userId of [LEADER, TEAM]) state.members[memberKey(HIDDEN, userId)] = { projectId: HIDDEN, userId, discipline: 'Architect' };
  state.stages.stg_010 = { id: 'stg_010', projectId: HIDDEN, name: 'Concept', order: 0, startDate: null, endDate: null };
  state.tasks.tsk_020 = makeTask({ id: 'tsk_020', projectId: HIDDEN, stageId: 'stg_010', title: 'Secret plan', ownerId: TEAM });
  state.updates.upd_020 = { id: 'upd_020', projectId: HIDDEN, authorId: TEAM, body: 'Secret post', fileIds: [], createdAt: STAMP, editedAt: null };
  state.conversations.cnv_020 = { id: 'cnv_020', kind: 'project', projectId: HIDDEN, memberIds: [], name: null, createdAt: STAMP, archived: false } as never;
  state.meetings = {
    mtg_020: {
      id: 'mtg_020', kind: 'team', title: 'Secret meeting', projectId: HIDDEN, startsAt: '2026-10-05T10:00:00.000+03:00', endsAt: '2026-10-05T11:00:00.000+03:00',
      where: 'Room', guests: '', notes: '', organizerId: LEADER, attendeeIds: [TEAM], status: 'scheduled', rev: 1, createdBy: LEADER, createdAt: STAMP, updatedAt: STAMP,
    } as never,
  };
  return state;
}

type Target = Pick<Notification, 'targetType' | 'targetId'>;
const TARGETS: Record<string, Target> = {
  task: { targetType: 'task', targetId: 'tsk_020' },
  post: { targetType: 'update', targetId: 'upd_020' },
  project: { targetType: 'project', targetId: HIDDEN },
  chat: { targetType: 'chat', targetId: 'cnv_020' },
  meeting: { targetType: 'meeting', targetId: 'mtg_020' },
};
const TRIGGERS: Record<string, Notification['trigger']> = {
  task: 'task_assigned', post: 'mention', project: 'added_to_project', chat: 'mention', meeting: 'meeting_invited',
};

function notice(id: string, userId: string, kind: string, over: Partial<Notification> = {}): Notification {
  return { id, userId, trigger: TRIGGERS[kind], actorId: LEADER, ...TARGETS[kind], read: false, createdAt: STAMP, dedupeKey: null, ...over };
}

/** The world with one notice of each kind for a person. */
function withNotices(userId: string, over: Partial<Notification> = {}): ReturnType<typeof testApi<typeof calls>> {
  const state = world();
  Object.keys(TARGETS).forEach((kind, index) => {
    state.notifications[`ntf_90${index}`] = notice(`ntf_90${index}`, userId, kind, over);
  });
  const t = testApi(calls, state);
  t.as(userId);
  return t;
}

const words = (view: unknown) => JSON.stringify(view);

describe('a notice of a hidden project, for a person who does not see the project', () => {
  for (const kind of Object.keys(TARGETS)) {
    it(`reads as gone and names nothing: ${kind}`, async () => {
      const t = withNotices(OUTSIDER);
      const views = await t.api.call('notifications.list', {});
      const view = views.find((one) => one.notification.targetType === TARGETS[kind].targetType)!;
      expect(view.gone).toBe(true);
      expect(view.target).toBe('');
      expect(view.projectCode).toBeNull();
      expect(view.project).toBeNull();
      expect(view.link === '/notifications' || view.link === '').toBe(true);
      expect(view.forPeople).toEqual([]);
      expect(words(view)).not.toContain(NAME);
      expect(words(view)).not.toContain('Secret');
      expect(words(view)).not.toContain('INT-26-001');
    });
  }

  it('is no part of the badge', async () => {
    const t = withNotices(OUTSIDER);
    expect((await t.api.call('notifications.count', {})).badge).toBe(0);
  });

  it('names no people of a copy', async () => {
    const t = withNotices(OUTSIDER, { forUserIds: [TEAM, LEADER] });
    for (const view of await t.api.call('notifications.list', {})) expect(view.forPeople).toEqual([]);
  });

  it('reads as gone for the last copy of a deleted to-do of the hidden project, and of the deleted project itself', async () => {
    const state = world();
    const task = state.tasks.tsk_020;
    delete state.tasks.tsk_020;
    state.events.evt_900 = {
      id: 'evt_900', seq: 900, projectId: HIDDEN, actorId: LEADER, actorKind: 'human', actingForId: LEADER, correlationId: 'sty_del', verb: 'task.deleted',
      targetType: 'task', targetId: 'tsk_020', before: task, after: null, createdAt: STAMP, undoneBy: null,
    } as never;
    const project = state.projects[HIDDEN];
    delete state.projects[HIDDEN];
    // A deleted project takes its rows with it, as projects.delete does, so the database run keeps its foreign keys.
    const owned = ['members', 'stages', 'deadlines', 'tasks', 'updates', 'files', 'conversations', 'tracker', 'payments'] as const;
    for (const name of owned) {
      const rows = state[name] as Record<string, { projectId?: string | null }> | undefined;
      for (const [key, row] of Object.entries(rows ?? {})) if (row.projectId === HIDDEN) delete rows![key];
    }
    state.events.evt_901 = {
      id: 'evt_901', seq: 901, projectId: HIDDEN, actorId: LEADER, actorKind: 'human', actingForId: LEADER, correlationId: 'sty_del2', verb: 'project.deleted',
      targetType: 'project', targetId: HIDDEN, before: project, after: null, createdAt: STAMP, undoneBy: null,
    } as never;
    state.notifications.ntf_950 = notice('ntf_950', OUTSIDER, 'task', { trigger: 'task_deleted' });
    state.notifications.ntf_951 = notice('ntf_951', OUTSIDER, 'project');
    state.notifications.ntf_952 = notice('ntf_952', LEADER, 'project');
    const t = testApi(calls, state);
    t.as(OUTSIDER);
    for (const view of await t.api.call('notifications.list', {})) {
      expect(view.gone).toBe(true);
      expect(words(view)).not.toContain(NAME);
      expect(words(view)).not.toContain('Secret plan');
    }
    // The leader of the deleted hidden project still reads its last name.
    t.as(LEADER);
    const leader = (await t.api.call('notifications.list', {}))[0];
    expect(leader.target).toBe(NAME);
  });

  it('reads as gone for a person of a role without "See every project", on an open project where the person does not work', async () => {
    const state = world();
    state.projects[HIDDEN] = { ...state.projects[HIDDEN], access: undefined };
    state.settings = { ...state.settings, roles: { ...state.settings.roles, off: { member: ['project.seeAll'] } } };
    state.notifications.ntf_960 = notice('ntf_960', OUTSIDER, 'task');
    state.notifications.ntf_961 = notice('ntf_961', TEAM, 'task');
    const t = testApi(calls, state);
    t.as(OUTSIDER);
    expect((await t.api.call('notifications.list', {}))[0].gone).toBe(true);
    t.as(TEAM);
    expect((await t.api.call('notifications.list', {}))[0].gone).toBe(false);
  });
});

describe('a notice of a hidden project, for the people who see the project', () => {
  for (const userId of [LEADER, TEAM, CHOSEN, ADMIN]) {
    it(`keeps its words for ${userId}`, async () => {
      const t = withNotices(userId);
      const views = await t.api.call('notifications.list', {});
      expect(views).toHaveLength(5);
      // A chosen person is no team member: the chat of the project stays closed to the person, as to an office person outside the team.
      for (const view of views) expect(view.gone, view.notification.targetType).toBe(userId === CHOSEN && view.notification.targetType === 'chat');
      const project = views.find((view) => view.notification.targetType === 'project')!;
      expect(project.target).toBe(NAME);
      expect(project.projectCode).toBe('INT-26-001');
    });
  }

  it('keeps the words of an open project for everyone', async () => {
    const state = world();
    state.notifications.ntf_970 = { ...notice('ntf_970', OUTSIDER, 'task'), targetId: 'tsk_001', trigger: 'task_assigned' };
    state.tasks.tsk_001 = makeTask({ ownerId: TEAM });
    const t = testApi(calls, state);
    t.as(OUTSIDER);
    const [view] = await t.api.call('notifications.list', {});
    expect(view.gone).toBe(false);
    expect(view.target).toBe('Ground floor plan');
  });
});

describe('an Undo and a notice of a hidden project that its owner does not see', () => {
  it('keeps the notice, so the list and the count of the person do not change (as for an office to-do)', async () => {
    const state = world();
    // A story of the leader: the task is renamed. The outsider holds a notice of the story, but does not see the project.
    state.events.evt_980 = {
      id: 'evt_980', seq: 980, projectId: HIDDEN, actorId: LEADER, actorKind: 'human', actingForId: LEADER, correlationId: 'sty_980', verb: 'task.updated',
      targetType: 'task', targetId: 'tsk_020', before: { title: 'Old' }, after: { title: 'Secret plan' }, createdAt: STAMP, undoneBy: null,
    } as never;
    state.counters.evt = 980;
    state.notifications.ntf_980 = notice('ntf_980', OUTSIDER, 'task', { correlationId: 'sty_980' });
    state.notifications.ntf_981 = notice('ntf_981', TEAM, 'task', { correlationId: 'sty_980' });
    const t = testApi(calls, state);
    t.as(LEADER);
    await t.api.call('events.undoStory', { correlationId: 'sty_980' });
    // The notice of the person who sees the project goes with the story. The notice of the outsider stays and still reads as gone.
    expect(t.store.state.notifications.ntf_981).toBeUndefined();
    expect(t.store.state.notifications.ntf_980).toBeDefined();
    t.as(OUTSIDER);
    const [view] = await t.api.call('notifications.list', {});
    expect(view.gone).toBe(true);
  });
});

describe('the copies for an Admin who picked "Everything"', () => {
  it('make a copy of a notice of a hidden project, because the Admin holds "See hidden projects"', () => {
    const state = world();
    state.users.usr_001 = { ...state.users.usr_001, preferences: { ...state.users.usr_001.preferences, adminReach: 'all' } };
    const told = [notice('ntf_990', TEAM, 'task')];
    copyForAdmins(state, state.users[LEADER], STAMP, { userIds: [TEAM], trigger: 'task_assigned', targetType: 'task', targetId: 'tsk_020' } as never, told);
    const copies = Object.values(state.notifications).filter((n) => n.forUserIds !== undefined);
    expect(copies.map((n) => n.userId)).toEqual([ADMIN]);
  });
});
