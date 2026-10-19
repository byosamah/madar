import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';
import { settleFuture, shiftState } from './shift';
import { unreadIn } from '../api/chatState';
import { memoryPersister } from '../api/persist';
import { bootstrap } from '../app/bootstrap';
import { setNow } from '../lib/dates';
import { makeWorld, STAMP, TODAY } from '../test/factories';

const NEXT_DAY = '2026-10-01T09:00:00.000+03:00';

describe('The daily date shift moves every time field (audit 2026-10-03, API-10)', () => {
  it('moves read marks, pauses, stage notes, date notes, versions and report times', () => {
    const state = makeWorld();
    state.conversations.cnv_001 = { id: 'cnv_001', kind: 'project', projectId: 'prj_001', memberIds: [], createdAt: STAMP } as typeof state.conversations[string];
    state.messages.msg_001 = {
      id: 'msg_001', conversationId: 'cnv_001', authorId: 'usr_002', actingForId: 'usr_002', body: 'Site visit moved', fileIds: [], createdAt: STAMP, editedAt: null,
    } as unknown as typeof state.messages[string];
    state.chatReads['cnv_001:usr_003'] = { conversationId: 'cnv_001', userId: 'usr_003', lastReadAt: STAMP };
    const project = state.projects.prj_001;
    project.status = 'on_hold';
    project.pause = { reason: 'Client', resumeOn: '2026-10-10', by: 'usr_002', at: STAMP, kind: 'internal' };
    project.stageBack = { fromStageId: 'stg_002', toStageId: 'stg_001', reason: 'Redo', by: 'usr_002', at: STAMP };
    state.tasks.tsk_001 = {
      id: 'tsk_001', projectId: 'prj_001', stageId: 'stg_002', title: 'Plan', description: '', ownerId: 'usr_003', status: 'todo', dueDate: '2026-10-05',
      flagged: false, needsReview: true, checklist: [], createdBy: 'usr_002', createdAt: STAMP, completedAt: null,
      dateNotes: [{ from: { startDate: null, dueDate: '2026-10-04' }, to: { startDate: null, dueDate: '2026-10-05' }, reason: 'A finished late', at: STAMP }],
      version: 2, versions: [{ n: 1, reason: '', openedAt: STAMP, openedBy: 'usr_002', finishedAt: STAMP }, { n: 2, reason: 'Comments', openedAt: STAMP, openedBy: 'usr_002', finishedAt: null }],
    };
    state.feedback = {
      fbk_001: { id: 'fbk_001', kind: 'bug', message: 'Broken', page: '/', screenshots: [], status: 'done', createdBy: 'usr_003', createdAt: STAMP, doneBy: 'usr_001', doneAt: STAMP },
    };
    expect(unreadIn(state, 'cnv_001', 'usr_003')).toBe(0);
    const moved = shiftState(structuredClone(state), 1);
    expect(moved.chatReads['cnv_001:usr_003'].lastReadAt).toBe(NEXT_DAY);
    expect(unreadIn(moved, 'cnv_001', 'usr_003')).toBe(0);
    expect(moved.projects.prj_001.pause).toMatchObject({ at: NEXT_DAY, resumeOn: '2026-10-11' });
    expect(moved.projects.prj_001.stageBack?.at).toBe(NEXT_DAY);
    expect(moved.tasks.tsk_001.dateNotes?.[0].at).toBe(NEXT_DAY);
    expect(moved.tasks.tsk_001.versions?.[0]).toMatchObject({ openedAt: NEXT_DAY, finishedAt: NEXT_DAY });
    expect(moved.feedback?.fbk_001.doneAt).toBe(NEXT_DAY);
  });
});

describe('Nothing in the office happened later than the load time (audit 2026-10-03, BRW-4)', () => {
  const STAMP_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  /**
   * Every stamp in the state, under any key, so a time field that the shift does not know also counts. The start and the end of a
   * meeting are planned for later (fbk_022): they move with the days, and they are the one pair of fields that may be in the future.
   */
  function stamps(value: unknown, out: string[] = []): string[] {
    if (typeof value === 'string' && STAMP_TEXT.test(value)) out.push(value);
    else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) if (key !== 'startsAt' && key !== 'endsAt') stamps(item, out);
    }
    return out;
  }
  const latest = (state: unknown) => Math.max(...stamps(state).map((stamp) => Date.parse(stamp)));
  const early = new Date('2026-09-29T21:51:00Z'); // 00:51 office time on Wed 30 Sep

  it('moves the sample stamps of later today to just before the load time, in the same order', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    expect(latest(state)).toBeGreaterThan(early.getTime());
    const before = [...new Set(stamps(state))].sort((a, b) => Date.parse(a) - Date.parse(b));
    const settled = settleFuture(structuredClone(state), early);
    expect(latest(settled)).toBeLessThanOrEqual(early.getTime());
    const after = [...new Set(stamps(settled))].sort((a, b) => Date.parse(a) - Date.parse(b));
    expect(after).toHaveLength(before.length);
    const message = Object.values(state.messages).find((m) => m.createdAt === '2026-09-30T07:15:00.000+03:00')!;
    expect(settled.messages[message.id].createdAt.slice(0, 10)).toBe(TODAY);
    expect(settled.messages[message.id].createdAt < settled.messages[Object.values(state.messages).find((m) => m.createdAt === '2026-09-30T07:50:00.000+03:00')!.id].createdAt).toBe(true);
  });

  it('keeps every stamp that is already in the past', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    const late = new Date('2026-09-30T20:00:00Z');
    expect(settleFuture(state, late)).toBe(state);
  });

  it('settles the sample office at an early load, and again after the daily shift', async () => {
    setNow(early);
    const persister = memoryPersister();
    const first = await bootstrap({ persister, latencyMs: 0 });
    expect(latest(first.store.state)).toBeLessThanOrEqual(early.getTime());
    setNow(new Date('2026-09-30T07:00:00Z')); // 10:00
    await first.api.call('tasks.create', { projectId: 'prj_001', title: 'Late morning task' });
    await first.store.flush();
    const nextMorning = new Date('2026-10-01T04:00:00Z'); // 07:00 the next day
    setNow(nextMorning);
    const second = await bootstrap({ persister, latencyMs: 0 });
    expect(latest(second.store.state)).toBeLessThanOrEqual(nextMorning.getTime());
  });

  it('settles the sample office when it is reset', async () => {
    setNow(early);
    const runtime = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    await runtime.api.call('session.resetSampleData', {});
    expect(latest(runtime.store.state)).toBeLessThanOrEqual(early.getTime());
  });
});
