import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import { trackerCalls } from './tracker';
import { historyCalls } from './history';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...taskCalls, ...trackerCalls, ...historyCalls };
const at = (time: string) => setNow(new Date(`2026-09-30T${time}Z`));

// Faisal (usr_002) leads prj_001, Sara (usr_003) is on the team, Omar (usr_004) is outside, usr_005 is Sara's agent.
function world() {
  const t = testApi(calls);
  const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_003', uploadedAt: '2026-09-30T09:00:00.000+03:00' };
  t.store.state.files.fil_001 = { id: 'fil_001', projectId: 'prj_001', stageId: null, taskId: null, name: 'Survey.pdf', versions: [version] };
  return t;
}

const BASE = { projectId: 'prj_001', type: 'message', direction: 'in', title: 'Can the lobby move?' } as const;

describe('tracker.export', () => {
  it('gives one row for every event with the exact office time, newest first', async () => {
    const t = world();
    t.as('usr_003');
    at('06:00:05');
    const { entry } = await t.api.call('tracker.log', { ...BASE, waiting: 'us', note: 'By phone', fileIds: ['fil_001'] });
    at('06:10:30');
    await t.api.call('tracker.update', { id: entry.id, title: 'Can the lobby move east?' });
    at('06:20:00');
    t.as('usr_002');
    await t.api.call('tracker.close', { id: entry.id });
    at('21:05:09');
    await t.api.call('tracker.update', { id: entry.id, waiting: 'client' });
    at('21:06:00');
    await t.api.call('tracker.delete', { id: entry.id });

    const rows = await t.api.call('tracker.export', { projectId: 'prj_001' });
    expect(rows.map((r) => [r.date, r.time, r.event, r.by])).toEqual([
      ['2026-10-01', '00:06:00', 'deleted', 'Faisal Leader'],
      ['2026-10-01', '00:05:09', 'reopened', 'Faisal Leader'],
      ['2026-09-30', '09:20:00', 'closed', 'Faisal Leader'],
      ['2026-09-30', '09:10:30', 'edited', 'Sara Team'],
      ['2026-09-30', '09:00:05', 'logged', 'Sara Team'],
    ]);
    // The row shows the entry as it was right after the event.
    expect(rows[4]).toMatchObject({ type: 'message', direction: 'in', title: 'Can the lobby move?', note: 'By phone', files: ['Survey.pdf'], waiting: 'us', auto: null, byAgent: false });
    expect(rows[3].title).toBe('Can the lobby move east?');
    expect(rows[0].title).toBe('Can the lobby move east?');
  });

  it('names the person an agent acts for and marks the agent', async () => {
    const t = world();
    t.as('usr_005');
    await t.api.call('tracker.log', BASE);
    const [row] = await t.api.call('tracker.export', { projectId: 'prj_001' });
    expect(row).toMatchObject({ by: 'Sara Team', byAgent: true, event: 'logged' });
  });

  it('lists a reply task opened and a reply logged', async () => {
    const t = world();
    t.as('usr_002');
    const { entry } = await t.api.call('tracker.log', { ...BASE, waiting: 'us', replyBy: { userId: 'usr_003', dueDate: '2026-10-04' } });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: entry.replyTaskId! });
    const rows = await t.api.call('tracker.export', { projectId: 'prj_001' });
    expect(rows.map((r) => r.event).sort()).toEqual(['closed', 'logged', 'reply_logged', 'reply_task'].sort());
    const reply = rows.find((r) => r.event === 'reply_logged')!;
    expect(reply).toMatchObject({ title: 'Reply: Can the lobby move?', auto: 'reply', direction: 'out', by: 'Sara Team' });
    expect(rows.find((r) => r.event === 'closed')).toMatchObject({ waiting: 'us', title: 'Can the lobby move?' });
  });

  it('filters by type and by side, and keeps one project apart from another', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tracker.log', BASE);
    await t.api.call('tracker.log', { ...BASE, direction: 'out', title: 'Sent the plan' });
    await t.api.call('tracker.log', { ...BASE, type: 'meeting', direction: 'both', title: 'Site meeting' });
    await t.api.call('tracker.log', { ...BASE, type: 'other', direction: 'none', title: 'A neighbour phoned' });
    const titles = async (input: object) => (await t.api.call('tracker.export', { projectId: 'prj_001', ...input })).map((r) => r.title).sort();
    expect(await titles({})).toHaveLength(4);
    expect(await titles({ type: 'meeting' })).toEqual(['Site meeting']);
    expect(await titles({ side: 'out' })).toEqual(['Sent the plan']);
    expect(await titles({ side: 'none' })).toEqual(['A neighbour phoned']);
    expect(await titles({ type: 'message', side: 'in' })).toEqual(['Can the lobby move?']);
    t.store.state.projects.prj_002 = { ...t.store.state.projects.prj_001, id: 'prj_002', code: 'P-002' };
    expect(await t.api.call('tracker.export', { projectId: 'prj_002' })).toEqual([]);
  });

  it('leaves out a change that was undone, and the undo itself', async () => {
    const t = world();
    t.as('usr_002');
    const { entry } = await t.api.call('tracker.log', { ...BASE, waiting: 'us' });
    await t.api.call('tracker.close', { id: entry.id }, { correlationId: 'cor_close' });
    await t.api.call('events.undoStory', { correlationId: 'cor_close' });
    expect((await t.api.call('tracker.export', { projectId: 'prj_001' })).map((r) => r.event)).toEqual(['logged']);
    const second = await t.api.call('tracker.log', { ...BASE, title: 'Undone entry' }, { correlationId: 'cor_log' });
    await t.api.call('events.undoStory', { correlationId: 'cor_log' });
    expect(second.entry.title).toBe('Undone entry');
    expect((await t.api.call('tracker.export', { projectId: 'prj_001' })).map((r) => r.title)).toEqual(['Can the lobby move?']);
  });

  it('lets anyone who can open the project read it, and refuses a missing project', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tracker.log', BASE);
    t.as('usr_004');
    expect(await t.api.call('tracker.export', { projectId: 'prj_001' })).toHaveLength(1);
    await expect(t.api.call('tracker.export', { projectId: 'prj_099' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is read-only: it writes no event', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tracker.log', BASE);
    const before = Object.keys(t.store.state.events).length;
    await t.api.call('tracker.export', { projectId: 'prj_001' });
    expect(Object.keys(t.store.state.events)).toHaveLength(before);
  });
});

describe('the side follows the type', () => {
  const ALLOWED = {
    message: ['in', 'out'], file: ['in', 'out'], meeting: ['both'], balady: ['third_party'], other: ['none', 'in', 'out', 'both'],
  } as const;
  const SIDES = ['in', 'out', 'both', 'third_party', 'none'] as const;

  it('accepts exactly the sides of each type and refuses the rest with the reason side_for_type', async () => {
    const t = world();
    t.as('usr_002');
    for (const [type, allowed] of Object.entries(ALLOWED)) {
      for (const direction of SIDES) {
        const call = t.api.call('tracker.log', { ...BASE, type: type as keyof typeof ALLOWED, direction });
        if ((allowed as readonly string[]).includes(direction)) await expect(call).resolves.toBeDefined();
        else await expect(call).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['direction'], reason: 'side_for_type' } });
      }
    }
  });

  it('checks the resulting pair on an update, from the entry when only one of them is sent', async () => {
    const t = world();
    t.as('usr_002');
    const { entry } = await t.api.call('tracker.log', BASE);
    await expect(t.api.call('tracker.update', { id: entry.id, type: 'meeting' })).rejects.toMatchObject({ details: { reason: 'side_for_type' } });
    await expect(t.api.call('tracker.update', { id: entry.id, direction: 'both' })).rejects.toMatchObject({ details: { reason: 'side_for_type' } });
    const row = await t.api.call('tracker.update', { id: entry.id, type: 'meeting', direction: 'both' });
    expect(row.entry).toMatchObject({ type: 'meeting', direction: 'both' });
    await expect(t.api.call('tracker.update', { id: entry.id, type: 'balady' })).rejects.toMatchObject({ details: { reason: 'side_for_type' } });
    const other = await t.api.call('tracker.update', { id: entry.id, type: 'other', direction: 'none' });
    expect(other.entry).toMatchObject({ type: 'other', direction: 'none' });
  });
});
