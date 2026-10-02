import { describe, expect, it } from 'vitest';
import { shiftState } from './shift';
import { unreadIn } from '../api/chatState';
import { makeWorld, STAMP } from '../test/factories';

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
