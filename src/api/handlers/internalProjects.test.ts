import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Internal projects (fbk_044, owner 2026-10-22). usr_001 is the Admin, usr_002 leads prj_001, usr_003 is on its team, usr_004 is outside.
 * usr_006 holds the Management role: it has the payment and Tracker switches, and no switch for hidden projects.
 */
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Maha Management', systemRole: 'management' });
  state.counters.usr = 6;
  state.subCompanies = { sub_001: { id: 'sub_001', name: 'Studio', nameAr: 'استوديو', createdAt: '2026-09-01T00:00:00.000+03:00' } as never };
  state.clients.cli_001 = {
    id: 'cli_001', name: 'Acme', contactName: '', phone: '', email: '', initials: 'ACM',
  };
  return t;
}

const NEW_INTERNAL = { kind: 'internal' as const, name: 'Portfolio 2026' };

describe('projects.create with kind internal', () => {
  it('makes a hidden project with the INT code and no client, place, area, sub-company or contract date', async () => {
    const t = world();
    t.as('usr_002');
    const detail = await t.api.call('projects.create', NEW_INTERNAL);
    expect(detail.project).toMatchObject({
      kind: 'internal', code: 'INT-26-001', clientId: null, areaM2: null, geo: null, location: '', contractStartDate: null,
      access: { hidden: true, viewerIds: [] },
    });
    expect(detail.project.subCompanyId ?? null).toBeNull();
    expect(detail.client).toBeNull();
  });

  it('counts the INT series by itself, and leaves the series of a client code alone', async () => {
    const t = world();
    t.as('usr_002');
    const first = await t.api.call('projects.create', NEW_INTERNAL);
    const second = await t.api.call('projects.create', { ...NEW_INTERNAL, name: 'Training' });
    expect([first.project.code, second.project.code]).toEqual(['INT-26-001', 'INT-26-002']);
    const client = await t.api.call('projects.create', { name: 'Villa', subCompanyId: 'sub_001', codeParts: { initials: 'ABC', classification: 'RES', type: 'Villa' } });
    expect(client.project.code).toBe('260900ABC-RES-Villa');
    expect(client.project.kind).toBeUndefined();
    expect(client.project.access).toBeUndefined();
    // A client project with the old automatic code keeps its own prefix and series.
    const old = await t.api.call('projects.create', { name: 'Old way', subCompanyId: 'sub_001' });
    expect(old.project.code).toBe('KH-26-002');
  });

  it('takes no sub-company, and does not ask for one in an office that has sub-companies', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('projects.create', NEW_INTERNAL)).resolves.toBeDefined();
    await expect(t.api.call('projects.create', { ...NEW_INTERNAL, subCompanyId: 'sub_001' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['subCompanyId'], reason: 'internal_project' },
    });
  });

  it.each([
    ['clientId', { clientId: 'cli_001' }],
    ['geo', { geo: { lat: 26.3, lng: 50.2 } }],
    ['areaM2', { areaM2: 500 }],
    ['contractStartDate', { contractStartDate: '2026-09-01' }],
    ['location', { location: 'Al Khobar' }],
    ['code', { code: '260901AZT-RES-Villa' }],
    ['codeParts', { codeParts: { initials: 'AZT', classification: 'RES' as const, type: 'Villa' } }],
    ['sameContractAs', { sameContractAs: 'prj_001' }],
  ])('refuses %s with the reason internal_project', async (field, extra) => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('projects.create', { ...NEW_INTERNAL, ...extra })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: [field], reason: 'internal_project' },
    });
    expect(Object.keys(t.store.state.projects)).toEqual(['prj_001']);
  });

  it('keeps the stages, the team, the leader and a start and end date', async () => {
    const t = world();
    t.as('usr_002');
    const detail = await t.api.call('projects.create', {
      ...NEW_INTERNAL, stages: ['Plan', 'Make'], teamIds: ['usr_003'], startDate: '2026-10-01', targetEndDate: '2026-12-01',
    });
    expect(detail.stages.map((stage) => stage.name)).toEqual(['Plan', 'Make']);
    expect(detail.members.map((member) => member.user.id).sort()).toEqual(['usr_002', 'usr_003']);
    expect(detail.project).toMatchObject({ startDate: '2026-10-01', targetEndDate: '2026-12-01' });
  });
});

describe('projects.update on an internal project', () => {
  async function made() {
    const t = world();
    t.as('usr_002');
    const detail = await t.api.call('projects.create', NEW_INTERNAL);
    return { t, id: detail.project.id };
  }

  it('changes the name, the description and the dates', async () => {
    const { t, id } = await made();
    const detail = await t.api.call('projects.update', { id, patch: { name: 'Portfolio 2027', description: 'Our work', targetEndDate: '2027-01-01' } });
    expect(detail.project).toMatchObject({ name: 'Portfolio 2027', description: 'Our work', targetEndDate: '2027-01-01', kind: 'internal' });
  });

  it.each([
    ['clientId', { clientId: 'cli_001' }],
    ['areaM2', { areaM2: 300 }],
    ['geo', { geo: { lat: 26.3, lng: 50.2 } }],
    ['subCompanyId', { subCompanyId: 'sub_001' }],
    ['contractStartDate', { contractStartDate: '2026-09-01' }],
    ['location', { location: 'Al Khobar' }],
  ])('refuses %s with the reason internal_project', async (field, patch) => {
    const { t, id } = await made();
    await expect(t.api.call('projects.update', { id, patch })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: [field], reason: 'internal_project' },
    });
  });

  it('refuses a code correction, even from the Admin', async () => {
    const { t, id } = await made();
    t.as('usr_001');
    await expect(t.api.call('projects.update', { id, patch: { code: 'INT-26-099' }, codeAnyway: true })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['code'], reason: 'internal_project' },
    });
    expect(t.store.state.projects[id].code).toBe('INT-26-001');
  });

  it('accepts an empty value for a field it keeps empty, and never changes the kind', async () => {
    const { t, id } = await made();
    await t.api.call('projects.update', { id, patch: { areaM2: null, clientId: null, name: 'Same kind' } });
    const detail = await t.api.call('projects.update', { id, patch: { kind: 'client' } as never });
    expect(detail.project.kind).toBe('internal');
  });

  it('keeps a client project open to every field', async () => {
    const t = world();
    t.as('usr_002');
    const detail = await t.api.call('projects.update', { id: 'prj_001', patch: { areaM2: 900, clientId: 'cli_001' } });
    expect(detail.project).toMatchObject({ areaM2: 900, clientId: 'cli_001' });
  });
});

describe('an internal project has no payments and no Tracker', () => {
  async function made() {
    const t = world();
    t.as('usr_002');
    const detail = await t.api.call('projects.create', { ...NEW_INTERNAL, teamIds: ['usr_003'] });
    return { t, id: detail.project.id };
  }

  it('refuses payments.create and tracker.log with the reason internal_project', async () => {
    const { t, id } = await made();
    t.as('usr_001');
    await expect(t.api.call('payments.create', { projectId: id, name: 'First', amount: 100, dueDate: '2026-11-01' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['projectId'], reason: 'internal_project' },
    });
    await expect(t.api.call('tracker.log', { projectId: id, type: 'message', direction: 'out', title: 'Hello' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['projectId'], reason: 'internal_project' },
    });
    expect(Object.keys(t.store.state.payments ?? {})).toHaveLength(0);
    expect(Object.keys(t.store.state.tracker ?? {})).toHaveLength(0);
  });

  it('still works on a client project', async () => {
    const t = world();
    t.as('usr_001');
    await expect(t.api.call('payments.create', { projectId: 'prj_001', name: 'First', amount: 100, dueDate: '2026-11-01' })).resolves.toBeDefined();
    await expect(t.api.call('tracker.log', { projectId: 'prj_001', type: 'message', direction: 'out', title: 'Hello' })).resolves.toBeDefined();
  });

  it('refuses a pause that waits for the client, and writes no Tracker line when a done to-do opens again', async () => {
    const { t, id } = await made();
    await expect(t.api.call('projects.pause', { id, reason: 'Waiting', kind: 'client' })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'internal_project' },
    });
    await t.api.call('projects.pause', { id, reason: 'Quiet month' });
    await t.api.call('projects.resume', { id });
    const stage = t.store.state.projects[id].currentStageId;
    const task = await t.api.call('tasks.create', { projectId: id, stageId: stage, title: 'Pick the cover', ownerId: 'usr_003', needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: task.task.id });
    await t.api.call('tasks.newVersion', { id: task.task.id, reason: 'The cover changed' });
    expect(Object.values(t.store.state.tracker ?? {}).filter((entry) => entry.projectId === id)).toHaveLength(0);
  });

  it('writes no Tracker line when a late to-do moves the to-dos that wait for it, and a client project still does', async () => {
    const { t, id } = await made();
    const state = t.store.state;
    const lateMove = async (projectId: string) => {
      const stage = state.projects[projectId].currentStageId;
      t.as('usr_002');
      const first = await t.api.call('tasks.create', { projectId, stageId: stage, title: 'First', ownerId: 'usr_003', needsReview: false, startDate: '2026-09-01', dueDate: '2026-09-10' });
      const second = await t.api.call('tasks.create', {
        projectId, stageId: stage, title: 'Second', ownerId: 'usr_003', needsReview: false, schedule: 'dynamic', durationDays: 3,
        startDate: '2026-09-11', prerequisiteIds: [first.task.id],
      });
      const was = state.tasks[second.task.id].dueDate;
      t.as('usr_003');
      await t.api.call('tasks.complete', { id: first.task.id });
      expect(state.tasks[second.task.id].dueDate).not.toBe(was);
      return Object.values(state.tracker ?? {}).filter((entry) => entry.projectId === projectId && entry.auto === 'shift').length;
    };
    expect(await lateMove('prj_001')).toBe(1);
    expect(await lateMove(id)).toBe(0);
  });
});

describe('a meeting of an internal project', () => {
  it('settles with the mark only, and keeps its minutes on the meeting', async () => {
    const t = world();
    t.as('usr_002');
    const project = await t.api.call('projects.create', { ...NEW_INTERNAL, teamIds: ['usr_003'] });
    const made = await t.api.call('meetings.create', { kind: 'client', title: 'Plan the shoot', projectId: project.project.id, startsAt: '2026-10-01T10:00:00+03:00' });
    setNow(new Date('2026-10-01T11:01:00+03:00'));
    const settled = await t.api.call('meetings.settle', { id: made.id });
    expect(settled.settledAt).not.toBeNull();
    expect(settled.trackerEntryId).toBeNull();
    expect(Object.values(t.store.state.tracker ?? {})).toHaveLength(0);
    const saved = await t.api.call('meetings.saveMinutes', { id: made.id, text: 'We chose the cover.', fileIds: [] });
    expect(saved.minutesPlace).toBe('meeting');
  });
});

describe('leaks of an internal project', () => {
  it('shows an outsider no refusal that names the project: Management gets not_found for the payment and Tracker calls', async () => {
    const t = world();
    t.as('usr_002');
    const detail = await t.api.call('projects.create', NEW_INTERNAL);
    t.as('usr_006');
    const missing = await t.api.call('payments.create', { projectId: 'prj_999', name: 'x', amount: 1, dueDate: '2026-11-01' }).catch((e: Error) => e);
    for (const run of [
      () => t.api.call('payments.create', { projectId: detail.project.id, name: 'x', amount: 1, dueDate: '2026-11-01' }),
      () => t.api.call('tracker.log', { projectId: detail.project.id, type: 'message', direction: 'out', title: 'x' }),
    ]) {
      const error = await run().catch((e: Error) => e);
      expect(error).toMatchObject({ code: 'not_found' });
      expect(error).not.toMatchObject({ details: { reason: 'internal_project' } });
    }
    expect(missing).toMatchObject({ code: 'not_found' });
  });

  it('keeps the INT codes out of every code question of a client project', async () => {
    const t = world();
    t.as('usr_002');
    const internal = await t.api.call('projects.create', NEW_INTERNAL);
    t.as('usr_003');
    // A code typed with the INT head names no contract, so it clashes with nothing and the refusal never names the internal project.
    const typed = await t.api.call('projects.create', { name: 'Typed', subCompanyId: 'sub_001', code: internal.project.code, codeAnyway: true });
    expect(typed.project.code).toBe(internal.project.code);
    // The series of a new client code ignores the INT codes: the first series of the month is still 00.
    const parts = await t.api.call('projects.create', { name: 'Parts', subCompanyId: 'sub_001', codeParts: { initials: 'ABC', classification: 'RES', type: 'Villa' } });
    expect(parts.project.code).toBe('260900ABC-RES-Villa');
  });

  it('refuses an Admin setting INT as the code prefix of client projects', async () => {
    const t = world();
    t.as('usr_001');
    await expect(t.api.call('settings.update', { codePrefix: 'INT' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['codePrefix'] } });
  });
});
