import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { projectCalls } from './projects';
import { projectTemplateCalls } from './projectTemplates';
import { taskCalls } from './tasks';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { eventLabel } from '../views';
import type { SyncChoices } from '../templateSync';

beforeEach(() => setNow(NOW));

/**
 * The apply of a template to an ongoing project (fbk_020, owner 2026-10-19): the link with the adding is a project matter. The leader
 * of the project and the Admin may do it (project.edit) on an open project. The update of many projects stays with the Admin.
 * The test world: usr_001 is the Admin, usr_002 leads Test Tower (prj_001), usr_003 is on its team, usr_004 is on no team, and usr_005
 * is an agent of usr_003. Today is Wednesday 2026-09-30.
 */
const world = () => testApi({ ...projectCalls, ...projectTemplateCalls, ...taskCalls, ...historyCalls });
type World = ReturnType<typeof world>;

const TEMPLATE = {
  name: 'Villa',
  roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_003' }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: null, durationDays: null },
    { id: 's2', name: 'Permits', startOffset: null, durationDays: null },
    { id: 's3', name: 'Supervision', startOffset: null, durationDays: null },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing study', description: '', checklist: [], needsReview: false, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true },
    { id: 't2', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: false, roleId: 'r1', startOffset: 10, durationDays: 5, flexible: true },
    { id: 't3', stageId: 's3', title: 'Site visit', description: '', checklist: [], needsReview: false, roleId: null, startOffset: 15, durationDays: 3, flexible: true },
  ],
};
const OTHER = {
  name: 'Mosque',
  roles: [],
  stages: [{ id: 's1', name: 'Brief', startOffset: null, durationDays: null }, { id: 's2', name: 'Design', startOffset: null, durationDays: null }],
  tasks: [{ id: 't1', stageId: 's1', title: 'Client brief', description: '', checklist: [], needsReview: false, roleId: null, startOffset: 0, durationDays: 4, flexible: true }],
};

/** The picks of the apply sheet: only the parts that a bring back covers. */
const APPLY: SyncChoices = { add: false, bringBack: true, removed: 'keep', text: false, dates: false, leads: false, closed: 'leave', stages: false, edited: 'keep' };

type Setup = { t: World; projectId: string; templateId: string; massingId: string };

/** Faisal (usr_002) leads "Harbour": the stages Concept and Permits, and the task "Massing study", from Sunday 2026-08-02. */
async function setUp(): Promise<Setup> {
  const t = world();
  const templateId = (await t.api.call('projectTemplates.save', TEMPLATE)).id;
  t.as('usr_002');
  const { project } = await t.api.call('projects.create', { name: 'Harbour', stages: ['Concept', 'Permits'], startDate: '2026-08-02', teamIds: ['usr_003'] });
  const concept = Object.values(t.store.state.stages).find((stage) => stage.projectId === project.id && stage.name === 'Concept')!;
  const massing = await t.api.call('tasks.create', {
    projectId: project.id, stageId: concept.id, title: 'Massing study', ownerId: 'usr_003', startDate: '2026-08-02', dueDate: '2026-08-13',
  });
  return { t, projectId: project.id, templateId, massingId: massing.task.id };
}

let stories = 0;

/** What the apply sheet sends: the link with the picks of the names, then the adding, in one story. */
async function apply(t: World, projectId: string, templateId: string, link: Record<string, unknown> = {}): Promise<string> {
  const match = await t.api.call('projectTemplates.matchPlan', { projectId, templateId });
  const linked = await t.api.run('projectTemplates.link', {
    projectId, templateId, stageMatches: match.stages, taskMatches: match.tasks, rolePeople: { r1: 'usr_003' }, ...link,
  } as never, { correlationId: `sty_apply_${stories += 1}` });
  await t.api.run('projectTemplates.syncApply', { templateId, projectId, choices: APPLY, apply: true }, { correlationId: linked.storyId });
  return linked.storyId;
}

const byPart = (t: World, projectId: string, partId: string) =>
  Object.values(t.store.state.tasks).find((task) => task.projectId === projectId && task.templatePartId === partId);
const stageByPart = (t: World, projectId: string, partId: string) =>
  Object.values(t.store.state.stages).find((stage) => stage.projectId === projectId && stage.templatePartId === partId);

describe('the rights of the apply', () => {
  it('lets the leader apply a template to the own project, and the Admin to any open project', async () => {
    const { t, projectId, templateId } = await setUp();
    await apply(t, projectId, templateId);
    expect(t.store.state.projects[projectId].templateLink?.templateId).toBe(templateId);
    expect(byPart(t, projectId, 't2')).toBeDefined();
    expect(stageByPart(t, projectId, 's3')).toMatchObject({ name: 'Supervision' });
    // The Admin applies to the project of the leader.
    t.as('usr_001');
    const other = await t.api.call('projects.create', { name: 'Admin villa', stages: ['Concept'], startDate: '2026-08-02', leader: 'usr_002' });
    await apply(t, other.project.id, templateId);
    expect(t.store.state.projects[other.project.id].templateLink?.templateId).toBe(templateId);
  });

  it('refuses a team member without the project right, on every call of the apply', async () => {
    const { t, projectId, templateId } = await setUp();
    t.as('usr_003');
    await expect(t.api.call('projectTemplates.matchPlan', { projectId, templateId })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: {}, taskMatches: {}, rolePeople: {} })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('projectTemplates.syncApply', { templateId, projectId, choices: APPLY, apply: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.projects[projectId].templateLink).toBeFalsy();
  });

  it('refuses a person who leads another project: a leader may not apply to the project of another leader', async () => {
    const { t, projectId, templateId } = await setUp();
    t.as('usr_001');
    const mine = await t.api.call('projects.create', { name: 'Hala project', stages: ['Concept'], startDate: '2026-08-02' });
    t.as('usr_002');
    await expect(t.api.call('projectTemplates.matchPlan', { projectId: mine.project.id, templateId })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('projectTemplates.link', { projectId: mine.project.id, templateId, stageMatches: {}, taskMatches: {}, rolePeople: {} })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('projectTemplates.syncApply', { templateId, projectId: mine.project.id, choices: APPLY, apply: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(projectId).not.toBe(mine.project.id);
  });

  it('refuses a person who is on no team', async () => {
    const { t, projectId, templateId } = await setUp();
    t.as('usr_004');
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: {}, taskMatches: {}, rolePeople: {} })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a done or archived project, and accepts a paused one', async () => {
    const { t, projectId, templateId } = await setUp();
    await t.api.call('projects.setStatus', { id: projectId, status: 'completed' });
    await expect(t.api.call('projectTemplates.matchPlan', { projectId, templateId })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'project_closed' } });
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: {}, taskMatches: {}, rolePeople: {} })).rejects.toMatchObject({ details: { reason: 'project_closed' } });
    await t.api.call('projects.setStatus', { id: projectId, status: 'archived' });
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: {}, taskMatches: {}, rolePeople: {} })).rejects.toMatchObject({ details: { reason: 'project_closed' } });
    await t.api.call('projects.setStatus', { id: projectId, status: 'active' });
    await t.api.call('projects.pause', { id: projectId, reason: 'Waiting for the client', resumeOn: null, kind: 'client' });
    await apply(t, projectId, templateId);
    expect(byPart(t, projectId, 't3')).toBeDefined();
  });

  it('refuses a done project also when the call is the adding after a link', async () => {
    const { t, projectId, templateId } = await setUp();
    await apply(t, projectId, templateId);
    await t.api.call('projects.setStatus', { id: projectId, status: 'completed' });
    await expect(t.api.call('projectTemplates.syncApply', { templateId, projectId, choices: APPLY, apply: true })).rejects.toMatchObject({ details: { reason: 'project_closed' } });
  });

  it('keeps the update of many projects and the other picks with the Admin', async () => {
    const { t, projectId, templateId } = await setUp();
    await apply(t, projectId, templateId);
    // The leader may not send the update with the other picks, with or without the apply mark.
    for (const choices of [{ ...APPLY, text: true }, { ...APPLY, add: true }, { ...APPLY, dates: true }, { ...APPLY, leads: true }]) {
      await expect(t.api.call('projectTemplates.syncApply', { templateId, projectId, choices, apply: true })).rejects.toMatchObject({ code: 'forbidden' });
    }
    // The bring back alone, with no apply mark, is the update of the Admin.
    await expect(t.api.call('projectTemplates.syncApply', { templateId, projectId, choices: APPLY })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('projectTemplates.usage', { templateId })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('projectTemplates.syncPlan', { templateId, projectIds: [projectId] })).rejects.toMatchObject({ code: 'forbidden' });
    // Template edits stay as they are: the leader did not save the template, and holds no template right.
    await expect(t.api.call('projectTemplates.save', { ...TEMPLATE, id: templateId, name: 'Villa 2' })).rejects.toMatchObject({ code: 'forbidden' });
    // The Admin sends the other picks as before, also with the apply mark.
    t.as('usr_001');
    await t.api.call('projectTemplates.syncApply', { templateId, projectId, choices: { ...APPLY, text: true }, apply: true });
  });

  it('gives an agent the rights of its person', async () => {
    const { t, projectId, templateId } = await setUp();
    // usr_005 acts for usr_003, who is on the team and holds no project right.
    t.as('usr_005');
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: {}, taskMatches: {}, rolePeople: {} })).rejects.toMatchObject({ code: 'forbidden' });
    // The same agent acting for the leader holds the leader's right.
    t.store.state.users.usr_005.ownerId = 'usr_002';
    await apply(t, projectId, templateId);
    expect(t.store.state.projects[projectId].templateLink?.templateId).toBe(templateId);
  });
});

describe('the apply adds the parts that have no match', () => {
  it('adds the stages and tasks with no match, keeps the items of the project, and links the matches', async () => {
    const { t, projectId, templateId, massingId } = await setUp();
    await apply(t, projectId, templateId);
    expect(t.store.state.tasks[massingId]).toMatchObject({ templatePartId: 't1', startDate: '2026-08-02', dueDate: '2026-08-13' });
    expect(stageByPart(t, projectId, 's1')).toMatchObject({ name: 'Concept' });
    expect(stageByPart(t, projectId, 's3')).toMatchObject({ name: 'Supervision' });
    expect(byPart(t, projectId, 't2')).toMatchObject({ title: 'Balady pack', status: 'todo' });
    expect(byPart(t, projectId, 't3')).toMatchObject({ title: 'Site visit' });
    expect(t.store.state.projects[projectId].templateLink?.droppedPartIds).toEqual([]);
  });

  it('gives the added parts the dates of the template from today, and never moves an existing item', async () => {
    const { t, projectId, templateId, massingId } = await setUp();
    // The template from 2026-08-02: t2 on 08-16 to 08-20, t3 on 08-23 to 08-25. Today is Wednesday 09-30, so t2 (the earliest added) starts today.
    await apply(t, projectId, templateId);
    expect(byPart(t, projectId, 't2')).toMatchObject({ startDate: '2026-09-30', dueDate: '2026-10-06' });
    // t3 keeps its place after t2: 5 working days later, and keeps its 3 working days.
    expect(byPart(t, projectId, 't3')).toMatchObject({ startDate: '2026-10-07', dueDate: '2026-10-11' });
    expect(t.store.state.tasks[massingId]).toMatchObject({ startDate: '2026-08-02', dueDate: '2026-08-13' });
    // The stage of the added tasks has the shifted dates too.
    expect(stageByPart(t, projectId, 's3')).toMatchObject({ startDate: '2026-10-07', endDate: '2026-10-11' });
  });

  it('keeps the dates of the template when the project starts today or later', async () => {
    const t = world();
    const templateId = (await t.api.call('projectTemplates.save', TEMPLATE)).id;
    t.as('usr_002');
    const { project } = await t.api.call('projects.create', { name: 'Fresh', stages: ['Concept'], startDate: '2026-10-04' });
    await apply(t, project.id, templateId);
    // Day 0 is Sunday 10-04: t2 starts 10 working days later, on 10-18.
    expect(byPart(t, project.id, 't2')).toMatchObject({ startDate: '2026-10-18' });
  });

  it('gives a lead only when the default person of the role is active, and tells that lead', async () => {
    const { t, projectId, templateId } = await setUp();
    t.store.state.users.usr_003.active = false;
    await apply(t, projectId, templateId, { rolePeople: { r1: null } });
    expect(byPart(t, projectId, 't2')?.ownerId).toBeNull();
    const second = await setUp();
    await apply(second.t, second.projectId, second.templateId);
    const task = byPart(second.t, second.projectId, 't2')!;
    expect(task.ownerId).toBe('usr_003');
    // The lead of a new task gets the normal new-task notice. The person who applies gets none, and nobody gets a second one.
    const notices = Object.values(second.t.store.state.notifications).filter((notice) => notice.targetId === task.id);
    expect(notices.map((notice) => [notice.userId, notice.trigger])).toEqual([['usr_003', 'task_assigned']]);
    expect(Object.values(second.t.store.state.notifications).some((notice) => notice.userId === 'usr_002')).toBe(false);
  });

  it('writes the whole apply in one story, with one History line that counts what it added', async () => {
    const { t, projectId, templateId } = await setUp();
    const story = await apply(t, projectId, templateId);
    const events = Object.values(t.store.state.events).filter((event) => event.projectId === projectId && event.correlationId === story);
    const verbs = new Set(events.map((event) => event.verb));
    // project.stage_changed is the stage tag of the project, which follows its tasks.
    expect(verbs).toEqual(new Set([
      'project.template_linked', 'stage.template_linked', 'task.template_linked', 'stage.created', 'task.created', 'project.stage_changed', 'project.template_applied',
    ]));
    const line = events.find((event) => event.verb === 'project.template_applied')!;
    expect(eventLabel(t.store.state, line)).toEqual({ label: 'Harbour', detail: { template: 'Villa', stages: '1', tasks: '2' } });
    // The Admin update does not write this line.
    expect(events.some((event) => event.verb === 'project.template_synced')).toBe(false);
  });

  it('takes the whole apply back with one Undo of the story', async () => {
    const { t, projectId, templateId } = await setUp();
    const story = await apply(t, projectId, templateId);
    await t.api.call('events.undoStory', { correlationId: story });
    expect(t.store.state.projects[projectId].templateLink).toBeFalsy();
    expect(byPart(t, projectId, 't2')).toBeUndefined();
    expect(stageByPart(t, projectId, 's3')).toBeUndefined();
    // The notice of the new lead goes with the story.
    expect(Object.values(t.store.state.notifications).filter((notice) => notice.correlationId === story)).toEqual([]);
  });
});

describe('a project that follows a template already', () => {
  it('refuses a second link unless the call says to replace', async () => {
    const { t, projectId, templateId } = await setUp();
    await apply(t, projectId, templateId);
    const other = (await t.api.call('projectTemplates.save', OTHER)).id;
    await expect(t.api.call('projectTemplates.link', { projectId, templateId: other, stageMatches: {}, taskMatches: {}, rolePeople: {} }))
      .rejects.toMatchObject({ details: { reason: 'already_linked' } });
    // The same template again is an update, never a replace.
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: {}, taskMatches: {}, rolePeople: {}, replace: true }))
      .rejects.toMatchObject({ details: { reason: 'already_linked' } });
  });

  it('replaces the link with another template, clears the part ids of the old one, and one Undo brings the old link back', async () => {
    const { t, projectId, templateId, massingId } = await setUp();
    await apply(t, projectId, templateId);
    const before = structuredClone(t.store.state.projects[projectId].templateLink);
    const other = (await t.api.call('projectTemplates.save', OTHER)).id;
    // The part id t1 of the old template must not make the new part t1 look present.
    const story = await apply(t, projectId, other, { replace: true, rolePeople: {} });
    const link = t.store.state.projects[projectId].templateLink!;
    expect(link.templateId).toBe(other);
    expect(t.store.state.tasks[massingId].templatePartId).toBeUndefined();
    expect(byPart(t, projectId, 't1')).toMatchObject({ title: 'Client brief' });
    expect(stageByPart(t, projectId, 's1')).toMatchObject({ name: 'Brief' });
    expect(stageByPart(t, projectId, 's2')).toMatchObject({ name: 'Design' });
    await t.api.call('events.undoStory', { correlationId: story });
    expect(t.store.state.projects[projectId].templateLink).toEqual(before);
    expect(t.store.state.tasks[massingId]).toMatchObject({ templatePartId: 't1' });
    expect(byPart(t, projectId, 't1')?.id).toBe(massingId);
  });
});
