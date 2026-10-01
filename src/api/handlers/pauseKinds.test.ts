import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { insightCalls } from './insights';
import { peopleCalls } from './people';
import { projectCalls } from './projects';
import { trackerCalls } from './tracker';
import { makeProject, makeUser, makeWorld, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { staleDaysOf } from '../pause';

const calls = { ...projectCalls, ...trackerCalls, ...historyCalls, ...peopleCalls, ...insightCalls };

beforeEach(() => setNow(NOW));

// TODAY is 2026-09-30 (factories). The office clock runs at +03:00.
const stampDaysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().replace('Z', '+03:00');

describe('two kinds of pause', () => {
  it('pauses on the office side by default, and logs nothing in the Tracker', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const paused = await t.api.call('projects.pause', { id: 'prj_001', reason: 'The office reviews the budget.' });
    expect(paused.project.pause).toMatchObject({ kind: 'internal', reason: 'The office reviews the budget.' });
    expect(paused.project.pause?.trackerId).toBeUndefined();
    expect(await t.api.call('tracker.list', { projectId: 'prj_001' })).toEqual([]);
  });

  it('pauses for the client, and logs one open Tracker entry that waits for the client', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const paused = await t.api.call('projects.pause', { id: 'prj_001', reason: 'We wait for the signed brief.', kind: 'client' });
    expect(paused.project.pause).toMatchObject({ kind: 'client', trackerId: 'trk_001' });
    const rows = await t.api.call('tracker.list', { projectId: 'prj_001', openOnly: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].entry).toMatchObject({
      type: 'message', direction: 'out', title: 'We wait for the signed brief.', waiting: 'client', closedAt: null, createdBy: 'usr_002', auto: null,
    });
  });

  it('keeps a long reason whole in the note when the title has to be shorter', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const reason = 'w'.repeat(250);
    await t.api.call('projects.pause', { id: 'prj_001', reason, kind: 'client' });
    const entry = (await t.api.call('tracker.list', { projectId: 'prj_001' }))[0].entry;
    expect(entry.title).toHaveLength(200);
    expect(entry.title.endsWith('…')).toBe(true);
    expect(entry.note).toBe(reason);
  });

  it('closes the open entry when the project resumes, by the person who resumed it', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'We wait for the client.', kind: 'client' });
    t.as('usr_001');
    const resumed = await t.api.call('projects.resume', { id: 'prj_001' });
    expect(resumed.project.pause).toBeNull();
    const entry = t.store.state.tracker!.trk_001;
    expect(entry).toMatchObject({ closedBy: 'usr_001' });
    expect(entry.closedAt).not.toBeNull();
    expect(await t.api.call('tracker.list', { projectId: 'prj_001', openOnly: true })).toEqual([]);
  });

  it('leaves an entry alone that a person already closed, changed or deleted', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'Wait.', kind: 'client' });
    t.store.state.users.usr_003.systemRole = 'member';
    t.as('usr_003');
    await t.api.call('tracker.close', { id: 'trk_001' });
    const closedAt = t.store.state.tracker!.trk_001.closedAt;
    t.as('usr_002');
    await t.api.call('projects.resume', { id: 'prj_001' });
    expect(t.store.state.tracker!.trk_001).toMatchObject({ closedAt, closedBy: 'usr_003' });
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'Wait again.', kind: 'client' });
    await t.api.call('tracker.delete', { id: 'trk_002' });
    await expect(t.api.call('projects.resume', { id: 'prj_001' })).resolves.toMatchObject({ project: { status: 'active' } });
  });

  it('does not touch the Tracker when an office pause resumes', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('tracker.log', { projectId: 'prj_001', type: 'message', direction: 'out', title: 'Asked for a plan', waiting: 'client' });
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'Office reasons.' });
    await t.api.call('projects.resume', { id: 'prj_001' });
    expect(t.store.state.tracker!.trk_001.closedAt).toBeNull();
  });

  it('undoes a client pause in one step: the pause, then its entry', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'Wait for the client.', kind: 'client' }, { correlationId: 'cor_pause' });
    await t.api.call('events.undoStory', { correlationId: 'cor_pause' });
    expect(t.store.state.projects.prj_001.status).toBe('active');
    expect(t.store.state.tracker).toEqual({});
  });

  it('undoes a resume in one step: the pause comes back and its entry opens again', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'Wait for the client.', kind: 'client' });
    await t.api.call('projects.resume', { id: 'prj_001' }, { correlationId: 'cor_resume' });
    await t.api.call('events.undoStory', { correlationId: 'cor_resume' });
    expect(t.store.state.projects.prj_001).toMatchObject({ status: 'on_hold', pause: { kind: 'client', trackerId: 'trk_001' } });
    expect(t.store.state.tracker!.trk_001.closedAt).toBeNull();
  });

  it('refuses a second pause of a paused project, and a kind that is not one of the two', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'First.', kind: 'client' });
    await expect(t.api.call('projects.pause', { id: 'prj_001', reason: 'Second.', kind: 'client' })).rejects.toMatchObject({ code: 'conflict' });
    await t.api.call('projects.resume', { id: 'prj_001' });
    // @ts-expect-error The kind is checked at run time too, for an agent.
    await expect(t.api.call('projects.pause', { id: 'prj_001', reason: 'Third.', kind: 'other' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('keeps the rights of pausing: the leader and the Admin only', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await expect(t.api.call('projects.pause', { id: 'prj_001', reason: 'No.', kind: 'client' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.tracker).toEqual({});
  });

  it('reads a pause saved before kinds existed as an office pause', async () => {
    const t = testApi(calls);
    t.store.state.projects.prj_001.status = 'on_hold';
    t.store.state.projects.prj_001.pause = { reason: 'Old pause.', resumeOn: null, by: 'usr_002', at: stampDaysAgo(2) };
    const row = (await t.api.call('projects.list', { status: 'on_hold' }))[0];
    expect(row.project.pause?.kind).toBeUndefined();
    expect(row.staleDays).toBeNull();
    await expect(t.api.call('projects.resume', { id: 'prj_001' })).resolves.toMatchObject({ project: { status: 'active' } });
  });
});

describe('the stale limit', () => {
  it('has a default of 30 days, and only the Admin sets it, from 7 to 365', async () => {
    const t = testApi(calls);
    expect((await t.api.call('settings.get', {})).staleAfterDays).toBe(30);
    expect((await t.api.call('settings.update', { staleAfterDays: 45 })).staleAfterDays).toBe(45);
    for (const bad of [6, 366, 30.5, 0, -1]) {
      await expect(t.api.call('settings.update', { staleAfterDays: bad })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['staleAfterDays'] } });
    }
    expect((await t.api.call('settings.update', { staleAfterDays: 7 })).staleAfterDays).toBe(7);
    expect((await t.api.call('settings.update', { staleAfterDays: 365 })).staleAfterDays).toBe(365);
    t.store.state.users.usr_006 = makeUser('usr_006', { systemRole: 'management' });
    for (const userId of ['usr_006', 'usr_002']) {
      t.as(userId);
      await expect(t.api.call('settings.update', { staleAfterDays: 20 })).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('reads the default for an office saved before the setting existed', async () => {
    const t = testApi(calls);
    delete t.store.state.settings.staleAfterDays;
    t.store.state.projects.prj_001.status = 'on_hold';
    t.store.state.projects.prj_001.pause = { reason: 'Wait.', resumeOn: null, by: 'usr_002', at: stampDaysAgo(31) };
    expect(staleDaysOf(t.store.state, t.store.state.projects.prj_001, '2026-09-30')).toBe(31);
  });

  async function pausedFor(days: number, limit = 30) {
    const t = testApi(calls);
    t.store.state.settings.staleAfterDays = limit;
    t.store.state.projects.prj_001.status = 'on_hold';
    t.store.state.projects.prj_001.pause = { reason: 'Wait.', resumeOn: null, by: 'usr_002', at: stampDaysAgo(days), kind: 'client' };
    return t;
  }

  it('turns stale the day after the limit, never on the limit itself', async () => {
    for (const [days, stale] of [[29, null], [30, null], [31, 31], [34, 34]] as const) {
      const t = await pausedFor(days);
      expect((await t.api.call('projects.get', { id: 'prj_001' })).staleDays).toBe(stale);
    }
    const short = await pausedFor(7, 7);
    expect((await short.api.call('projects.get', { id: 'prj_001' })).staleDays).toBeNull();
    const shorter = await pausedFor(8, 7);
    expect((await shorter.api.call('projects.get', { id: 'prj_001' })).staleDays).toBe(8);
  });

  it('moves with the setting, because it is computed and never stored', async () => {
    const t = await pausedFor(20);
    expect((await t.api.call('projects.get', { id: 'prj_001' })).staleDays).toBeNull();
    await t.api.call('settings.update', { staleAfterDays: 10 });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).staleDays).toBe(20);
    expect(JSON.stringify(t.store.state.projects.prj_001)).not.toContain('stale');
  });

  it('is never stale for an active project', async () => {
    const t = testApi(calls);
    expect((await t.api.call('projects.get', { id: 'prj_001' })).staleDays).toBeNull();
  });

  it('shows a stale project in the Dashboard attention list, whatever the status filter says, and applies the people filters', async () => {
    const t = await pausedFor(34);
    t.store.state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', name: 'Fresh pause', leaderId: 'usr_004', status: 'on_hold', pause: { reason: 'Wait.', resumeOn: null, by: 'usr_004', at: stampDaysAgo(5) } });
    const view = await t.api.call('dashboard.get', {});
    expect(view.attention.stale).toEqual([{ project: expect.objectContaining({ id: 'prj_001' }), days: 34, kind: 'client' }]);
    expect((await t.api.call('dashboard.get', { status: 'completed' })).attention.stale).toHaveLength(1);
    expect((await t.api.call('dashboard.get', { leaderId: 'usr_004' })).attention.stale).toEqual([]);
    expect((await t.api.call('dashboard.get', { leaderId: 'usr_002' })).attention.stale).toHaveLength(1);
  });

  it('lists the stale projects with the longest wait first', async () => {
    const t = await pausedFor(40);
    t.store.state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', name: 'Longer pause', status: 'on_hold', pause: { reason: 'Wait.', resumeOn: null, by: 'usr_002', at: stampDaysAgo(90) } });
    const view = await t.api.call('dashboard.get', {});
    expect(view.attention.stale.map((row) => [row.project.id, row.days, row.kind])).toEqual([['prj_002', 90, 'internal'], ['prj_001', 40, 'client']]);
  });

  it('puts a paused project in the schedule only when the status filter asks for paused projects', async () => {
    const t = await pausedFor(34);
    expect((await t.api.call('dashboard.get', {})).schedule).toEqual([]);
    const rows = (await t.api.call('dashboard.get', { status: 'on_hold' })).schedule;
    expect(rows).toHaveLength(1);
    expect(rows[0].pause).toEqual({ kind: 'client', staleDays: 34 });
  });
});
