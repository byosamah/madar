import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calls } from '../calls';
import type { Task } from '../contract/entities';
import { trackerOf } from '../store';
import { makeStage, makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

// A switch that takes away only the Tracker posting right. Today every person who may move a stage back also has it, so the
// test needs the switch to reach the case where the two rights differ.
const rights = vi.hoisted(() => ({ denyPost: false }));
vi.mock('../permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../permissions')>();
  return {
    ...actual,
    can: (...args: Parameters<typeof actual.can>) => (rights.denyPost && args[1] === 'tracker.log' ? false : actual.can(...args)),
  };
});

beforeEach(() => {
  setNow(NOW);
  rights.denyPost = false;
});

// Today is Wed 30 Sep 2026. Concept (stg_001, Aug), Schematic Design (stg_002, Sep to Oct), Permits (stg_003, Nov).
// "Task A" is done in Concept and "Task B" is open in Schematic Design, so the project is in Schematic Design.
function world() {
  const t = testApi(calls);
  t.store.state.stages.stg_003 = makeStage({ id: 'stg_003', name: 'Permits', order: 2, startDate: '2026-11-01', endDate: '2026-11-30' });
  t.store.state.counters.stg = 3;
  put(t, 'tsk_001', { stageId: 'stg_001', status: 'done', completedAt: '2026-09-20T09:00:00.000+03:00' });
  put(t, 'tsk_002', { stageId: 'stg_002' });
  t.as('usr_002');
  return t;
}

type T = ReturnType<typeof testApi<typeof calls>>;
function put(t: T, id: string, overrides: Partial<Task> = {}): Task {
  const task = makeTask({ id, title: `Task ${'ABCDE'[Number(id.slice(-1)) - 1]}`, ownerId: 'usr_003', ...overrides });
  t.store.state.tasks[id] = task;
  t.store.state.counters.tsk = Math.max(t.store.state.counters.tsk ?? 0, Number(id.slice(-3)));
  return task;
}
const balady = (t: T) => Object.values(trackerOf(t.store.state)).filter((entry) => entry.type === 'balady');
const tag = (t: T) => t.store.state.projects.prj_001.currentStageId;

describe('a move back logged in the Tracker as a Balady update (owner, 2026-10-03, API-14)', () => {
  it('writes one Balady entry from a third party with the reason, today, when the person asks', async () => {
    const t = world();
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'Balady asked for changes to the drawings', logInTracker: true });
    expect(tag(t)).toBe('stg_001');
    expect(balady(t)).toHaveLength(1);
    expect(balady(t)[0]).toMatchObject({
      projectId: 'prj_001', type: 'balady', direction: 'third_party', title: 'Balady asked for changes to the drawings', note: '',
      date: '2026-09-30', waiting: null, auto: null, createdBy: 'usr_002',
    });
    const rows = await t.api.call('tracker.list', { projectId: 'prj_001' });
    expect(rows.map((row) => [row.entry.type, row.entry.title])).toEqual([['balady', 'Balady asked for changes to the drawings']]);
  });

  it('takes the entry back with the move in one Undo of the story', async () => {
    const t = world();
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'Balady asked for changes', logInTracker: true }, { correlationId: 'story_b' });
    expect(balady(t)).toHaveLength(1);
    await t.api.call('events.undoStory', { correlationId: 'story_b' });
    expect(balady(t)).toHaveLength(0);
    expect(tag(t)).toBe('stg_002');
    expect(t.store.state.tasks.tsk_001.status).toBe('done');
  });

  it('logs from every call that asks why the project moves back', async () => {
    const create = world();
    await create.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_001', title: 'Early', reason: 'A late brief item', logInTracker: true });
    expect(balady(create).map((entry) => entry.title)).toEqual(['A late brief item']);

    const template = world();
    template.store.state.taskTemplates = {
      ttp_001: {
        id: 'ttp_001', name: 'Site survey', stageName: 'Concept', description: '', checklist: [], needsReview: true, schedule: 'static',
        durationDays: null, createdBy: 'usr_002', createdAt: '2026-09-01T09:00:00.000+03:00',
      },
    };
    await template.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_001', reason: 'A new survey', logInTracker: true });
    expect(balady(template).map((entry) => entry.title)).toEqual(['A new survey']);

    const update = world();
    await update.api.call('tasks.update', { id: 'tsk_002', patch: { stageId: 'stg_001' }, reason: 'It belongs earlier', logInTracker: true });
    expect(balady(update).map((entry) => entry.title)).toEqual(['It belongs earlier']);

    const version = world();
    await version.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'Balady sent comments', logInTracker: true });
    expect(balady(version).map((entry) => entry.title)).toEqual(['Balady sent comments']);
  });

  it('keeps a long reason whole: the title holds the start and the note holds all of it', async () => {
    const t = world();
    const reason = `Balady asked for changes ${'to the drawings '.repeat(15)}`.trim();
    expect(reason.length).toBeGreaterThan(200);
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason, logInTracker: true });
    const [entry] = balady(t);
    expect(entry.title.length).toBeLessThanOrEqual(200);
    expect(reason.startsWith(entry.title.slice(0, -1))).toBe(true);
    expect(entry.note).toBe(reason);
    await expect(t.api.call('tracker.list', { projectId: 'prj_001' })).resolves.toHaveLength(1);
  });

  it('changes nothing when the box is not ticked, or when the project does not move back', async () => {
    const plain = world();
    await plain.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'No log' });
    expect(balady(plain)).toHaveLength(0);

    const off = world();
    await off.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'No log', logInTracker: false });
    expect(balady(off)).toHaveLength(0);

    const forward = world();
    await forward.api.call('tasks.update', { id: 'tsk_002', patch: { title: 'Renamed' }, logInTracker: true });
    await forward.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_003', title: 'Later', logInTracker: true });
    await forward.api.call('tasks.move', { id: 'tsk_002', status: 'in_progress', logInTracker: true });
    expect(balady(forward)).toHaveLength(0);
    expect(tag(forward)).toBe('stg_002');
  });

  it('logs nothing when the project does not move back in this call, even with an earlier move-back note saved', async () => {
    // An earlier move back without the box saves the Overview note. A later call that does not move the tag keeps that note,
    // and the box must not log it again (audit 2026-10-03, API-14 repair).
    const t = world();
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'First move back, not logged' });
    expect(tag(t)).toBe('stg_001');
    expect(t.store.state.projects.prj_001.stageBack).toMatchObject({ reason: 'First move back, not logged' });

    await t.api.call('tasks.update', { id: 'tsk_002', patch: { title: 'Renamed' }, reason: 'Not a move back', logInTracker: true });
    await t.api.call('tasks.update', { id: 'tsk_002', patch: { title: 'Renamed again' }, logInTracker: true });
    await t.api.call('tasks.move', { id: 'tsk_002', status: 'in_progress', logInTracker: true });
    expect(tag(t)).toBe('stg_001');
    expect(balady(t)).toHaveLength(0);
    await expect(t.api.call('tracker.list', { projectId: 'prj_001' })).resolves.toEqual([]);

    // The same call from a person without the Tracker posting right is not refused, because nothing goes to the Tracker.
    rights.denyPost = true;
    await t.api.call('tasks.update', { id: 'tsk_002', patch: { title: 'Renamed by a viewer' }, logInTracker: true });
    expect(t.store.state.tasks.tsk_002.title).toBe('Renamed by a viewer');
    expect(balady(t)).toHaveLength(0);
  });

  it('refuses nothing new: a move back with the box and no reason gets the same question as before', async () => {
    const t = world();
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', logInTracker: true })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'stage_back_reason', stageName: 'Concept' },
    });
    expect(balady(t)).toHaveLength(0);
    expect(t.store.state.tasks.tsk_001.status).toBe('done');
  });

  it('follows the Tracker rule: a person without the posting right cannot log, and the move is not made', async () => {
    const t = world();
    rights.denyPost = true;
    await expect(t.api.call('tracker.log', { projectId: 'prj_001', type: 'balady', direction: 'third_party', title: 'Direct' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'Balady asked', logInTracker: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(balady(t)).toHaveLength(0);
    expect(t.store.state.tasks.tsk_001.status).toBe('done');
    // Without the box, the same person moves the project back as before.
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'Balady asked' });
    expect(tag(t)).toBe('stg_001');
    expect(balady(t)).toHaveLength(0);
  });
});
