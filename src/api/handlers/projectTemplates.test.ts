import { beforeEach, describe, expect, it } from 'vitest';
import { projectTemplateCalls } from './projectTemplates';
import { historyCalls } from './history';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const world = () => testApi({ ...projectTemplateCalls, ...historyCalls });

/** A small template: an Architect role (default Faisal), two stages, two tasks. */
const draft = (extra: Record<string, unknown> = {}) => ({
  name: 'Villa',
  roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: null, durationDays: null },
    { id: 's2', name: 'Permits', startOffset: null, durationDays: null },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing study', description: '', checklist: ['Site model'], needsReview: true, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true },
    { id: 't2', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 10, durationDays: 5, flexible: false },
  ],
  ...extra,
});

describe('project templates', () => {
  it('lists nothing in an old office that has no template collection', async () => {
    const t = world();
    delete t.store.state.projectTemplates;
    expect(await t.api.call('projectTemplates.list', {})).toEqual([]);
  });

  it('saves a template and lists it for everyone, by name', async () => {
    const t = world();
    t.as('usr_003');
    const saved = await t.api.call('projectTemplates.save', draft({ name: '  Villa  ' }));
    expect(saved).toMatchObject({ id: 'ptp_001', name: 'Villa', createdBy: 'usr_003', createdByName: 'Sara Team', canEdit: true });
    expect(saved.createdAt).toBe(saved.updatedAt);
    await t.api.call('projectTemplates.save', draft({ name: 'Apartment block' }));
    t.as('usr_004');
    const rows = await t.api.call('projectTemplates.list', {});
    expect(rows.map((r) => [r.name, r.canEdit])).toEqual([['Apartment block', false], ['Villa', false]]);
    expect(rows[1].tasks.map((task) => task.title)).toEqual(['Massing study', 'Balady pack']);
  });

  it('refuses a name that exists, ignoring case', async () => {
    const t = world();
    await t.api.call('projectTemplates.save', draft());
    await expect(t.api.call('projectTemplates.save', draft({ name: 'vILLA' }))).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'duplicate_name' } });
  });

  it('refuses a blank name, no stages, and a stage name twice', async () => {
    const t = world();
    await expect(t.api.call('projectTemplates.save', draft({ name: '  ' }))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('projectTemplates.save', draft({ stages: [], tasks: [] }))).rejects.toMatchObject({ code: 'invalid_input' });
    const twice = [{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }, { id: 's2', name: ' concept ', startOffset: null, durationDays: null }];
    await expect(t.api.call('projectTemplates.save', draft({ stages: twice, tasks: [] }))).rejects.toMatchObject({ details: { reason: 'duplicate_stage' } });
  });

  it('lets a task move to another stage of the template, keeps its id and days, and records one change that Undo takes back (fbk_031)', async () => {
    const t = world();
    const saved = await t.api.call('projectTemplates.save', draft());
    const moved = draft({ tasks: draft().tasks.map((task) => (task.id === 't1' ? { ...task, stageId: 's2' } : task)) });
    const row = await t.api.call('projectTemplates.save', { ...moved, id: saved.id });
    expect(row.tasks.map((task) => [task.id, task.stageId, task.startOffset, task.durationDays])).toEqual([['t1', 's2', 0, 10], ['t2', 's2', 10, 5]]);
    expect(row.stages.map((stage) => stage.id)).toEqual(['s1', 's2']);
    const events = Object.values(t.store.state.events).filter((e) => e.verb === 'projectTemplate.updated');
    expect(events).toHaveLength(1);
    await t.api.call('events.undo', { eventId: events[0].id });
    expect(t.store.state.projectTemplates![saved.id].tasks.map((task) => [task.id, task.stageId])).toEqual([['t1', 's1'], ['t2', 's2']]);
  });

  it('lets the last task leave a stage: a stage with no task is still a stage', async () => {
    const t = world();
    const saved = await t.api.call('projectTemplates.save', draft());
    const moved = draft({ tasks: draft().tasks.map((task) => ({ ...task, stageId: 's2' })) });
    const row = await t.api.call('projectTemplates.save', { ...moved, id: saved.id });
    expect(row.tasks.every((task) => task.stageId === 's2')).toBe(true);
    expect(row.stages).toHaveLength(2);
  });

  it('refuses an id twice in one template, a task of a missing stage, and a task of a missing role', async () => {
    const t = world();
    // The role took the id first, so the stage with the same id is the one refused.
    const sameId = draft({ roles: [{ id: 's1', name: 'Architect', defaultUserId: null }], tasks: [] });
    await expect(t.api.call('projectTemplates.save', sameId)).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['stages'] } });
    const base = draft();
    const noStage = { ...base, tasks: [{ ...base.tasks[0], stageId: 's9' }] };
    await expect(t.api.call('projectTemplates.save', noStage)).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['tasks'] } });
    const noRole = { ...base, tasks: [{ ...base.tasks[0], roleId: 'r9' }] };
    await expect(t.api.call('projectTemplates.save', noRole)).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['tasks'] } });
  });

  it('refuses a stage with only one of its two numbers', async () => {
    const t = world();
    const half = draft({ stages: [{ id: 's1', name: 'Concept', startOffset: 3, durationDays: null }], tasks: [] });
    await expect(t.api.call('projectTemplates.save', half)).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['stages'] } });
    const both = draft({ stages: [{ id: 's1', name: 'Concept', startOffset: 3, durationDays: 4 }], tasks: [] });
    expect((await t.api.call('projectTemplates.save', both)).stages[0]).toEqual({ id: 's1', name: 'Concept', startOffset: 3, durationDays: 4 });
  });

  it('refuses a default person who left the office, and an agent', async () => {
    const t = world();
    t.store.state.users.usr_004.active = false;
    const gone = draft({ roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_004' }] });
    await expect(t.api.call('projectTemplates.save', gone)).rejects.toMatchObject({ details: { reason: 'person_inactive' } });
    const agent = draft({ roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_005' }] });
    await expect(t.api.call('projectTemplates.save', agent)).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['roles'] } });
  });

  it('refuses two roles with one name', async () => {
    const t = world();
    const roles = [{ id: 'r1', name: 'Architect', defaultUserId: null }, { id: 'r2', name: 'architect', defaultUserId: null }];
    await expect(t.api.call('projectTemplates.save', draft({ roles, tasks: [] }))).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['roles'] } });
  });

  it('lets the person who saved it change it: the id and the first time stay, the change time moves, and Undo takes it back', async () => {
    const t = world();
    t.as('usr_003');
    const saved = await t.api.call('projectTemplates.save', draft());
    setNow(new Date(NOW.getTime() + 60_000));
    const changed = await t.api.call('projectTemplates.save', { ...draft({ name: 'Villa, short' }), id: saved.id });
    expect(changed).toMatchObject({ id: saved.id, name: 'Villa, short', createdAt: saved.createdAt });
    expect(changed.updatedAt > saved.updatedAt).toBe(true);
    // The same name as itself is not a clash.
    await t.api.call('projectTemplates.save', { ...draft({ name: 'Villa, short' }), id: saved.id });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'projectTemplate.updated')!;
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.projectTemplates![saved.id].name).toBe('Villa');
  });

  it('records no change when the same template is saved again', async () => {
    const t = world();
    const saved = await t.api.call('projectTemplates.save', draft());
    const before = Object.keys(t.store.state.events).length;
    const again = await t.api.call('projectTemplates.save', { ...draft(), id: saved.id });
    expect(again.updatedAt).toBe(saved.updatedAt);
    expect(Object.keys(t.store.state.events)).toHaveLength(before);
  });

  it('lets only the person who saved it or the Admin change or delete it', async () => {
    const t = world();
    t.as('usr_003');
    const { id } = await t.api.call('projectTemplates.save', draft());
    t.as('usr_004');
    await expect(t.api.call('projectTemplates.save', { ...draft({ name: 'Mine now' }), id })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('projectTemplates.delete', { id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await t.api.call('projectTemplates.save', { ...draft({ name: 'Checked by the Admin' }), id });
    await t.api.call('projectTemplates.delete', { id });
    expect(await t.api.call('projectTemplates.list', {})).toEqual([]);
  });

  it('answers not found for a template that does not exist', async () => {
    const t = world();
    await expect(t.api.call('projectTemplates.delete', { id: 'ptp_404' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.api.call('projectTemplates.save', { ...draft(), id: 'ptp_404' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('brings a deleted template back with Undo, and lets only its author or the Admin undo', async () => {
    const t = world();
    t.as('usr_003');
    const { id } = await t.api.call('projectTemplates.save', draft());
    await t.api.call('projectTemplates.delete', { id });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'projectTemplate.deleted')!;
    t.as('usr_004');
    await expect(t.api.call('events.undo', { eventId: event.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.projectTemplates![id].name).toBe('Villa');
  });

  it('saves the template of an agent in the name of its person', async () => {
    const t = world();
    t.as('usr_005');
    const saved = await t.api.call('projectTemplates.save', draft());
    expect(saved.createdBy).toBe('usr_003');
  });

  it('saves the waits of tasks and stages, and lists them', async () => {
    const t = world();
    const base = draft();
    const waits = {
      ...base,
      stages: [base.stages[0], { ...base.stages[1], prerequisiteIds: ['s1'] }],
      tasks: [base.tasks[0], { ...base.tasks[1], prerequisiteIds: ['t1'] }],
    };
    const saved = await t.api.call('projectTemplates.save', waits);
    expect(saved.stages[1]).toMatchObject({ prerequisiteIds: ['s1'] });
    expect(saved.tasks[1]).toMatchObject({ prerequisiteIds: ['t1'] });
    expect(saved.tasks[0]).not.toHaveProperty('prerequisiteIds');
  });

  it('refuses a task that waits for a task that is not in the template', async () => {
    const t = world();
    const base = draft();
    const missing = { ...base, tasks: [{ ...base.tasks[0], prerequisiteIds: ['t9'] }, base.tasks[1]] };
    await expect(t.api.call('projectTemplates.save', missing)).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['tasks'], reason: 'prerequisite_not_in_template' },
    });
  });

  it('refuses a stage that waits for a stage that is not in the template', async () => {
    const t = world();
    const base = draft();
    const missing = { ...base, stages: [base.stages[0], { ...base.stages[1], prerequisiteIds: ['s9'] }] };
    await expect(t.api.call('projectTemplates.save', missing)).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['stages'], reason: 'prerequisite_not_in_template' },
    });
  });

  it('refuses a task that waits for itself, and two tasks that wait for each other', async () => {
    const t = world();
    const base = draft();
    const self = { ...base, tasks: [{ ...base.tasks[0], prerequisiteIds: ['t1'] }, base.tasks[1]] };
    await expect(t.api.call('projectTemplates.save', self)).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'dependency_cycle' } });
    const pair = { ...base, tasks: [{ ...base.tasks[0], prerequisiteIds: ['t2'] }, { ...base.tasks[1], prerequisiteIds: ['t1'] }] };
    await expect(t.api.call('projectTemplates.save', pair)).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'dependency_cycle' } });
  });

  it('refuses two stages that wait for each other', async () => {
    const t = world();
    const base = draft();
    const pair = {
      ...base,
      stages: [{ ...base.stages[0], prerequisiteIds: ['s2'] }, { ...base.stages[1], prerequisiteIds: ['s1'] }],
      tasks: [],
    };
    await expect(t.api.call('projectTemplates.save', pair)).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['stages'], reason: 'dependency_cycle' } });
  });

  it('refuses a part that is listed twice in its waits', async () => {
    const t = world();
    const base = draft();
    const twice = { ...base, tasks: [base.tasks[0], { ...base.tasks[1], prerequisiteIds: ['t1', 't1'] }] };
    await expect(t.api.call('projectTemplates.save', twice)).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'duplicate_prerequisite' } });
  });
});
