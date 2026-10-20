import { beforeEach, describe, expect, it } from 'vitest';
import type { FileRec, RoleSettings, TrackerEntry } from '../contract/entities';
import { calls } from '../calls';
import { mayDeleteFile, mayDeleteTracker } from '../views';
import { withRights } from '../rights';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * What the six rights of projects and to-dos open through the calls (role-rights, owner 2026-10-23). Each holder is a Member who is NOT
 * on the team of prj_001. usr_002 leads prj_001, usr_003 is on its team, usr_004 is outside with no right.
 * usr_021 editAny, usr_022 changeLeaderAny, usr_023 archiveAny, usr_024 reviewAny, usr_025 changeAny, usr_026 undoAny,
 * usr_027 undoAny + editAny. usr_030 is an agent of the leader usr_002.
 */
const ROLES: RoleSettings = {
  custom: [
    { id: 'rol_001', name: 'Editor', nameAr: 'محرر', rights: ['project.editAny'] },
    { id: 'rol_002', name: 'Leader changer', nameAr: 'مغيّر القائد', rights: ['project.changeLeaderAny'] },
    { id: 'rol_003', name: 'Archiver', nameAr: 'مؤرشف', rights: ['project.archiveAny'] },
    { id: 'rol_004', name: 'Reviewer', nameAr: 'مراجع', rights: ['task.reviewAny'] },
    { id: 'rol_005', name: 'Changer', nameAr: 'مغيّر', rights: ['task.changeAny'] },
    { id: 'rol_006', name: 'Undoer', nameAr: 'متراجع', rights: ['agents.undoAny'] },
    { id: 'rol_007', name: 'Editor and undoer', nameAr: 'محرر ومتراجع', rights: ['agents.undoAny', 'project.editAny'] },
    { id: 'rol_008', name: 'Editor and changer', nameAr: 'محرر ومغيّر', rights: ['project.editAny', 'task.changeAny'] },
    { id: 'rol_009', name: 'Editor, changer and reviewer', nameAr: 'محرر ومغيّر ومراجع', rights: ['project.editAny', 'task.changeAny', 'task.reviewAny'] },
  ],
};
const EDIT = 'usr_021';
const LEADER_CHANGE = 'usr_022';
const ARCHIVE = 'usr_023';
const REVIEW = 'usr_024';
const CHANGE = 'usr_025';
const UNDO = 'usr_026';
const EDIT_UNDO = 'usr_027';
const EDIT_CHANGE = 'usr_031';
const EDIT_CHANGE_REVIEW = 'usr_032';
const NOBODY = 'usr_004';
const LEADER = 'usr_002';
const TEAM = 'usr_003';

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = structuredClone(ROLES);
  const people = [
    makeUser(EDIT, { name: 'Editor Person', roleId: 'rol_001' }),
    makeUser(LEADER_CHANGE, { name: 'Leader Person', roleId: 'rol_002' }),
    makeUser(ARCHIVE, { name: 'Archive Person', roleId: 'rol_003' }),
    makeUser(REVIEW, { name: 'Review Person', roleId: 'rol_004' }),
    makeUser(CHANGE, { name: 'Change Person', roleId: 'rol_005' }),
    makeUser(UNDO, { name: 'Undo Person', roleId: 'rol_006' }),
    makeUser(EDIT_UNDO, { name: 'Edit And Undo Person', roleId: 'rol_007' }),
    makeUser(EDIT_CHANGE, { name: 'Edit Change Person', roleId: 'rol_008' }),
    makeUser(EDIT_CHANGE_REVIEW, { name: 'Edit Change Review Person', roleId: 'rol_009' }),
    makeUser('usr_030', { name: 'Leader Agent', kind: 'agent', discipline: 'Agent', ownerId: LEADER }),
  ];
  for (const user of people) state.users[user.id] = user;
  state.counters.usr = 32;
  state.counters.rol = 9;
  return t;
}
type World = ReturnType<typeof world>;

const code = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return 'ok';
  } catch (e) {
    return (e as { code: string }).code;
  }
};

/** A task of prj_001 led by the team member, and sent to review by that member. */
async function taskInReview(t: World): Promise<string> {
  t.as(LEADER);
  const task = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Plot plan', ownerId: TEAM, stageId: 'stg_002' });
  t.as(TEAM);
  await t.api.call('tasks.complete', { id: task.task.id });
  expect(t.store.state.tasks[task.task.id].status).toBe('in_review');
  return task.task.id;
}

describe('project.editAny, project.changeLeaderAny and project.archiveAny through the calls', () => {
  it('lets a holder do the job of the right on a project the holder is not on, and nothing of the other two', async () => {
    const t = world();
    // project.editAny
    t.as(EDIT);
    expect(await code(() => t.api.call('projects.update', { id: 'prj_001', patch: { description: 'New brief' } }))).toBe('ok');
    expect(t.store.state.projects.prj_001.description).toBe('New brief');
    expect(await code(() => t.api.call('projects.setLeader', { id: 'prj_001', leaderId: TEAM }))).toBe('forbidden');
    expect(await code(() => t.api.call('projects.setStatus', { id: 'prj_001', status: 'archived' }))).toBe('forbidden');
    expect(await code(() => t.api.call('projects.delete', { id: 'prj_001', confirm: true } as never))).toBe('forbidden');
    // project.changeLeaderAny
    t.as(LEADER_CHANGE);
    expect(await code(() => t.api.call('projects.update', { id: 'prj_001', patch: { description: 'Other' } }))).toBe('forbidden');
    expect(await code(() => t.api.call('projects.setStatus', { id: 'prj_001', status: 'archived' }))).toBe('forbidden');
    expect(await code(() => t.api.call('projects.setLeader', { id: 'prj_001', leaderId: TEAM }))).toBe('ok');
    expect(t.store.state.projects.prj_001.leaderId).toBe(TEAM);
    // project.archiveAny
    t.as(ARCHIVE);
    expect(await code(() => t.api.call('projects.update', { id: 'prj_001', patch: { description: 'Other' } }))).toBe('forbidden');
    expect(await code(() => t.api.call('projects.setLeader', { id: 'prj_001', leaderId: LEADER }))).toBe('forbidden');
    expect(await code(() => t.api.call('projects.setStatus', { id: 'prj_001', status: 'completed' }))).toBe('ok');
    expect(t.store.state.projects.prj_001.status).toBe('completed');
  });

  it('refuses all three to a Member with no right, and writes no event', async () => {
    const t = world();
    const events = Object.keys(t.store.state.events).length;
    t.as(NOBODY);
    expect(await code(() => t.api.call('projects.update', { id: 'prj_001', patch: { description: 'x' } }))).toBe('forbidden');
    expect(await code(() => t.api.call('projects.setLeader', { id: 'prj_001', leaderId: TEAM }))).toBe('forbidden');
    expect(await code(() => t.api.call('projects.setStatus', { id: 'prj_001', status: 'archived' }))).toBe('forbidden');
    expect(Object.keys(t.store.state.events).length).toBe(events);
  });

  it('gives the right to the agent of the holder, as a Member agent never has it', async () => {
    const t = world();
    t.store.state.users.usr_030.ownerId = EDIT;
    t.as('usr_030');
    expect(await code(() => t.api.call('projects.update', { id: 'prj_001', patch: { description: 'By agent' } }))).toBe('ok');
    t.store.state.users.usr_030.ownerId = NOBODY;
    expect(await code(() => t.api.call('projects.update', { id: 'prj_001', patch: { description: 'Again' } }))).toBe('forbidden');
  });
});

describe('task.reviewAny and task.changeAny through the calls', () => {
  it('lets only a holder of task.reviewAny approve a task of a project the holder is not on', async () => {
    const t = world();
    const id = await taskInReview(t);
    for (const person of [NOBODY, EDIT, CHANGE, ARCHIVE]) {
      t.as(person);
      expect(await code(() => t.api.call('tasks.approve', { id })), person).toBe('forbidden');
      expect(await code(() => t.api.call('tasks.sendBack', { id, note: 'Again' })), person).toBe('forbidden');
    }
    expect(t.store.state.tasks[id].status).toBe('in_review');
    t.as(REVIEW);
    expect(await code(() => t.api.call('tasks.approve', { id }))).toBe('ok');
    expect(t.store.state.tasks[id].status).toBe('done');
  });

  it('lets a holder of task.reviewAny send a task back, and gives that holder no other power', async () => {
    const t = world();
    const id = await taskInReview(t);
    t.as(REVIEW);
    expect(await code(() => t.api.call('tasks.update', { id, patch: { title: 'New title' } }))).toBe('forbidden');
    expect(await code(() => t.api.call('tasks.delete', { id }))).toBe('forbidden');
    expect(await code(() => t.api.call('tasks.sendBack', { id, note: 'Add the setbacks.' }))).toBe('ok');
    expect(t.store.state.tasks[id].status).toBe('in_progress');
  });

  it('lets a holder of task.changeAny change and delete a task of a project, and nothing else', async () => {
    const t = world();
    const id = await taskInReview(t);
    t.as(CHANGE);
    expect(await code(() => t.api.call('tasks.approve', { id }))).toBe('forbidden');
    expect(await code(() => t.api.call('projects.update', { id: 'prj_001', patch: { description: 'x' } }))).toBe('forbidden');
    expect(await code(() => t.api.call('tasks.update', { id, patch: { title: 'New title' } }))).toBe('ok');
    expect(t.store.state.tasks[id].title).toBe('New title');
    expect(await code(() => t.api.call('tasks.delete', { id }))).toBe('ok');
    expect(t.store.state.tasks[id]).toBeUndefined();
    // A Member without the right changes none of it.
    const other = await taskInReview(t);
    t.as(NOBODY);
    expect(await code(() => t.api.call('tasks.update', { id: other, patch: { title: 'x' } }))).toBe('forbidden');
    expect(await code(() => t.api.call('tasks.delete', { id: other }))).toBe('forbidden');
  });

  it('keeps the office tasks of other people private from a holder of task.changeAny, for every call', async () => {
    const t = world();
    t.as(LEADER);
    const office = await t.api.call('tasks.create', { title: 'Private errand', ownerId: TEAM });
    const secret = Object.keys(t.store.state.tasks).length;
    t.as(CHANGE);
    for (const run of [
      () => t.api.call('tasks.get', { id: office.task.id }),
      () => t.api.call('tasks.update', { id: office.task.id, patch: { title: 'Taken' } }),
      () => t.api.call('tasks.delete', { id: office.task.id }),
      () => t.api.call('tasks.approve', { id: office.task.id }),
    ]) expect(await code(run)).toBe('not_found');
    const listed = await t.api.call('tasks.list', { filter: 'all' } as never);
    expect(JSON.stringify(listed)).not.toContain('Private errand');
    expect(Object.keys(t.store.state.tasks).length).toBe(secret);
    expect(t.store.state.tasks[office.task.id].title).toBe('Private errand');
  });

  it('does not let task.changeAny delete a file or a Tracker entry of a project', () => {
    const t = world();
    const state = t.store.state;
    const holder = withRights(state, state.users[CHANGE]);
    const file = { id: 'fil_001', projectId: 'prj_001', versions: [{ uploadedBy: TEAM }] } as unknown as FileRec;
    const entry = { id: 'trk_001', projectId: 'prj_001', createdBy: TEAM } as unknown as TrackerEntry;
    expect(mayDeleteFile(state, holder, file)).toBe(false);
    expect(mayDeleteTracker(state, holder, entry)).toBe(false);
    // The leader and the Admin still do, as before.
    expect(mayDeleteFile(state, withRights(state, state.users[LEADER]), file)).toBe(true);
    expect(mayDeleteTracker(state, withRights(state, state.users.usr_001), entry)).toBe(true);
  });
});

describe('agents.undoAny through the calls', () => {
  /** The agent of the leader changes the project; the event names the agent and the leader. */
  async function agentChange(t: World): Promise<string> {
    t.as('usr_030');
    await t.api.call('projects.update', { id: 'prj_001', patch: { description: 'By the agent' } });
    const event = Object.values(t.store.state.events).find((e) => e.actorKind === 'agent' && e.targetType === 'project')!;
    expect(event).toBeDefined();
    return event.id;
  }

  it('opens the Undo of an agent change on a project the holder is not on only when the holder can also make that change', async () => {
    const t = world();
    const id = await agentChange(t);
    // No right at all: not the person of the agent, not the leader.
    t.as(NOBODY);
    expect(await code(() => t.api.call('events.undo', { eventId: id }))).toBe('forbidden');
    // The undo right alone passes the first gate; the second gate asks the right to edit the project, which the holder lacks.
    t.as(UNDO);
    expect(await code(() => t.api.call('events.undo', { eventId: id }))).toBe('forbidden');
    // The edit right alone does not pass the first gate.
    t.as(EDIT);
    expect(await code(() => t.api.call('events.undo', { eventId: id }))).toBe('forbidden');
    expect(t.store.state.projects.prj_001.description).toBe('By the agent');
    // Both rights together take the change back.
    t.as(EDIT_UNDO);
    expect(await code(() => t.api.call('events.undo', { eventId: id }))).toBe('ok');
    expect(t.store.state.projects.prj_001.description).not.toBe('By the agent');
  });

  it('never opens the Undo of a change by a person (not an agent) to a holder of agents.undoAny', async () => {
    const t = world();
    t.as(LEADER);
    await t.api.call('projects.update', { id: 'prj_001', patch: { description: 'By the leader' } });
    const event = Object.values(t.store.state.events).find((e) => e.targetType === 'project' && e.actorKind !== 'agent')!;
    t.as(EDIT_UNDO);
    expect(await code(() => t.api.call('events.undo', { eventId: event.id }))).toBe('forbidden');
    expect(t.store.state.projects.prj_001.description).toBe('By the leader');
  });
});

/**
 * A right gives only its own power (security check, 2026-10-23). The stand-ins of the leader inside other rules ask the right that
 * fits: the review need asks task.review, a person put on the team asks project.edit, and a template made from a task asks project.edit.
 */
describe('a right gives only its own power', () => {
  const TEMPLATE = {
    name: 'Villa',
    roles: [{ id: 'r1', name: 'Architect', defaultUserId: TEAM }],
    stages: [{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }, { id: 's2', name: 'Permits', startOffset: null, durationDays: null }],
    tasks: [
      { id: 't1', stageId: 's1', title: 'Massing study', description: '', checklist: [], needsReview: false, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true },
      { id: 't2', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: false, roleId: 'r1', startOffset: 10, durationDays: 5, flexible: true },
    ],
  };
  const APPLY = { add: false, bringBack: true, removed: 'keep', text: false, dates: false, leads: false, closed: 'leave', stages: false, edited: 'keep' } as const;

  /** The leader has the project "Harbour" with the stage Concept and the task "Massing study". Then one person applies the template. */
  async function applied(person: string): Promise<{ made: boolean; needsReview: boolean | undefined }> {
    const t = world();
    t.as('usr_001');
    const templateId = (await t.api.call('projectTemplates.save', TEMPLATE as never)).id;
    t.as(LEADER);
    const { project } = await t.api.call('projects.create', { name: 'Harbour', stages: ['Concept', 'Permits'], startDate: '2026-08-02', teamIds: [TEAM] });
    const concept = Object.values(t.store.state.stages).find((stage) => stage.projectId === project.id && stage.name === 'Concept')!;
    await t.api.call('tasks.create', { projectId: project.id, stageId: concept.id, title: 'Massing study', ownerId: TEAM, startDate: '2026-08-02', dueDate: '2026-08-13' });
    t.as(person);
    const match = await t.api.call('projectTemplates.matchPlan', { projectId: project.id, templateId });
    await t.api.call('projectTemplates.link', { projectId: project.id, templateId, stageMatches: match.stages, taskMatches: match.tasks, rolePeople: { r1: TEAM } } as never);
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: project.id, choices: APPLY, apply: true });
    const added = Object.values(t.store.state.tasks).find((task) => task.projectId === project.id && task.templatePartId === 't2');
    return { made: added !== undefined, needsReview: added?.needsReview };
  }

  it('keeps the review need of the new tasks of an applied template for a person with task.changeAny and no review right', async () => {
    // The template says "no review" for every task. Only a reviewer keeps that.
    expect(await applied(EDIT_CHANGE)).toEqual({ made: true, needsReview: true });
    expect(await applied(EDIT)).toEqual({ made: true, needsReview: true });
    expect(await applied(EDIT_CHANGE_REVIEW)).toEqual({ made: true, needsReview: false });
  });

  it('keeps the same answer for the roles of today: the leader and the Admin skip the review', async () => {
    expect(await applied(LEADER)).toEqual({ made: true, needsReview: false });
    expect(await applied('usr_001')).toEqual({ made: true, needsReview: false });
  });

  it('keeps the review need of the tasks of a new project made from a template, for every role', async () => {
    for (const person of [CHANGE, EDIT_CHANGE, EDIT_CHANGE_REVIEW, NOBODY, 'usr_001']) {
      const t = world();
      t.as('usr_001');
      const templateId = (await t.api.call('projectTemplates.save', TEMPLATE as never)).id;
      t.as(person);
      const { project } = await t.api.call('projects.create', { name: `By ${person}`, template: { templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
      const tasks = Object.values(t.store.state.tasks).filter((task) => task.projectId === project.id);
      expect(tasks.length, person).toBe(2);
      // The maker of a new project leads it, so the answer follows the leader rule, never the right to change a task.
      const leads = t.store.state.projects[project.id].leaderId === person || person === 'usr_001';
      for (const task of tasks) expect(task.needsReview, person).toBe(!leads);
    }
  });

  it('refuses the review need to a holder of task.changeAny: create with no review, and a change of the need', async () => {
    const t = world();
    const id = await taskInReview(t);
    t.as(CHANGE);
    expect(await code(() => t.api.call('tasks.update', { id, patch: { needsReview: false } }))).toBe('forbidden');
    t.as(EDIT_CHANGE);
    expect(await code(() => t.api.call('tasks.update', { id, patch: { needsReview: false } }))).toBe('forbidden');
    t.as(EDIT_CHANGE_REVIEW);
    expect(await code(() => t.api.call('tasks.update', { id, patch: { needsReview: false } }))).toBe('ok');
  });

  it('does not let the right to change a task put a person on the team: the lead outside the team needs project.edit', async () => {
    const t = world();
    const id = await taskInReview(t);
    t.as(CHANGE);
    expect(await code(() => t.api.call('tasks.update', { id, patch: { ownerId: NOBODY } }))).toBe('invalid_input');
    expect(await code(() => t.api.call('tasks.update', { id, patch: { helperIds: [NOBODY] } }))).toBe('invalid_input');
    expect(t.store.state.members[`prj_001:${NOBODY}`]).toBeUndefined();
    // A holder of both rights may, as the leader does. Madar adds that person to the team.
    t.as(EDIT_CHANGE);
    expect(await code(() => t.api.call('tasks.update', { id, patch: { ownerId: NOBODY } }))).toBe('ok');
    expect(t.store.state.members[`prj_001:${NOBODY}`]).toBeDefined();
  });

  it('keeps the team of a project from a holder of task.changeAny: no member added or removed', async () => {
    const t = world();
    t.as(CHANGE);
    expect(await code(() => t.api.call('members.add', { projectId: 'prj_001', userId: NOBODY, discipline: 'Architect' } as never))).toBe('forbidden');
    expect(await code(() => t.api.call('members.remove', { projectId: 'prj_001', userId: TEAM } as never))).toBe('forbidden');
  });

  it('makes a template of the office from a task only for a person who may edit the project', async () => {
    const t = world();
    const id = await taskInReview(t);
    t.as(CHANGE);
    expect(await code(() => t.api.call('taskTemplates.save', { fromTaskId: id }))).toBe('forbidden');
    expect((await t.api.call('tasks.get', { id })).viewerCan.saveTemplate).toBe(false);
    t.as(EDIT);
    expect(await code(() => t.api.call('taskTemplates.save', { fromTaskId: id }))).toBe('ok');
    expect((await t.api.call('tasks.get', { id })).viewerCan.saveTemplate).toBe(true);
    // The leader and the Admin, as before.
    t.as(LEADER);
    expect((await t.api.call('tasks.get', { id })).viewerCan.saveTemplate).toBe(true);
    t.as('usr_001');
    expect((await t.api.call('tasks.get', { id })).viewerCan.saveTemplate).toBe(true);
  });

  it('keeps the project meetings with the leader and the Admin: no right of the sheet reaches them', async () => {
    const t = world();
    t.as(EDIT_CHANGE_REVIEW);
    expect(await code(() => t.api.call('meetings.create', { kind: 'client', title: 'Review the facade', projectId: 'prj_001', startsAt: '2026-10-05T10:00:00+03:00' } as never))).toBe('forbidden');
  });
});
