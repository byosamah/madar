import { beforeEach, describe, expect, it } from 'vitest';
import { applyPatch, recordCreate, recordDelete, undoEvent, writeEvent, type EventContext } from './events';
import type { ApiError } from './errors';
import { makeTask, makeWorld, STAMP } from '../test/factories';

let ec: EventContext;
const meta = { projectId: 'prj_001', verb: 'task.updated', targetType: 'task' as const, targetId: 'tsk_001' };

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (error) {
    return (error as ApiError).code;
  }
}

beforeEach(() => {
  const state = makeWorld();
  state.tasks.tsk_001 = makeTask();
  ec = { state, actor: state.users.usr_002, stamp: STAMP };
});

describe('event log', () => {
  it('numbers events in order', () => {
    const a = writeEvent(ec, { ...meta, before: null, after: null });
    const b = writeEvent(ec, { ...meta, before: null, after: null });
    expect([a.id, a.seq, b.id, b.seq]).toEqual(['evt_001', 1, 'evt_002', 2]);
    expect(a.actorKind).toBe('human');
    expect(a.createdAt).toBe(STAMP);
  });

  it('records only the fields that change', () => {
    const task = ec.state.tasks.tsk_001;
    const event = applyPatch(ec, task, { status: 'in_progress', title: task.title }, meta);
    expect(event?.before).toEqual({ status: 'todo' });
    expect(event?.after).toEqual({ status: 'in_progress' });
    expect(task.status).toBe('in_progress');
    expect(applyPatch(ec, task, { status: 'in_progress' }, meta)).toBeNull();
  });

  it('records the person an agent acted for, and the story id', () => {
    const agent = ec.state.users.usr_005;
    const event = writeEvent({ ...ec, actor: agent, correlationId: 'cor_weekly' }, { ...meta, before: null, after: null });
    expect(event).toMatchObject({ actorId: 'usr_005', actorKind: 'agent', actingForId: 'usr_003', correlationId: 'cor_weekly' });
    expect(writeEvent(ec, { ...meta, before: null, after: null }).actingForId).toBe('usr_002');
  });
});

describe('undo', () => {
  it('puts the old values back and marks the event', () => {
    const task = ec.state.tasks.tsk_001;
    const event = applyPatch(ec, task, { status: 'in_progress' }, meta)!;
    const undo = undoEvent(ec, event.id);
    expect(task.status).toBe('todo');
    expect(undo.verb).toBe('undo');
    expect(ec.state.events[event.id].undoneBy).toBe(undo.id);
  });

  it('refuses after a later change to the same field', () => {
    const task = ec.state.tasks.tsk_001;
    const first = applyPatch(ec, task, { status: 'in_progress' }, meta)!;
    applyPatch(ec, task, { status: 'done' }, meta);
    expect(codeOf(() => undoEvent(ec, first.id))).toBe('conflict');
  });

  it('allows an undo after a later change to another field', () => {
    const task = ec.state.tasks.tsk_001;
    const first = applyPatch(ec, task, { status: 'in_progress' }, meta)!;
    applyPatch(ec, task, { flagged: true }, meta);
    undoEvent(ec, first.id);
    expect(task.status).toBe('todo');
    expect(task.flagged).toBe(true);
  });

  it('undoes a create and a delete', () => {
    const extra = makeTask({ id: 'tsk_002' });
    ec.state.tasks.tsk_002 = extra;
    const created = recordCreate(ec, { ...meta, targetId: 'tsk_002', entity: extra });
    undoEvent(ec, created.id);
    expect(ec.state.tasks.tsk_002).toBeUndefined();

    const deleted = recordDelete(ec, { ...meta, entity: ec.state.tasks.tsk_001 });
    delete ec.state.tasks.tsk_001;
    undoEvent(ec, deleted.id);
    expect(ec.state.tasks.tsk_001.title).toBe('Ground floor plan');
  });

  it('refuses to undo twice and refuses some verbs', () => {
    const event = applyPatch(ec, ec.state.tasks.tsk_001, { status: 'in_progress' }, meta)!;
    undoEvent(ec, event.id);
    expect(codeOf(() => undoEvent(ec, event.id))).toBe('conflict');
    const created = writeEvent(ec, { projectId: 'prj_001', verb: 'project.created', targetType: 'project', targetId: 'prj_001', before: null, after: {} });
    expect(codeOf(() => undoEvent(ec, created.id))).toBe('conflict');
    expect(codeOf(() => undoEvent(ec, 'evt_999'))).toBe('not_found');
  });
});

describe('undo link and the reference map (plan 4.13, A1)', () => {
  it('names the undone event on the undo event', () => {
    const event = applyPatch(ec, ec.state.tasks.tsk_001, { status: 'in_progress' }, meta)!;
    const undo = undoEvent(ec, event.id);
    expect(undo.undoes).toBe(event.id);
    expect(writeEvent(ec, { ...meta, before: null, after: null }).undoes).toBeUndefined();
  });

  it('refuses the undo of a file upload when a direct chat message carries the file', () => {
    ec.state.files.fil_009 = {
      id: 'fil_009', projectId: 'prj_001', stageId: null, taskId: null, name: 'plan.pdf',
      versions: [{ letter: 'A', blobKey: 'blob_009', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_002', uploadedAt: STAMP }],
    };
    const created = recordCreate(ec, { projectId: 'prj_001', verb: 'file.uploaded', targetType: 'file', targetId: 'fil_009', entity: ec.state.files.fil_009 });
    ec.state.messages.msg_001 = {
      id: 'msg_001', conversationId: 'cnv_099', authorId: 'usr_002', actingForId: 'usr_002', body: 'see this', mentions: [], fileIds: ['fil_009'],
      createdAt: STAMP, editedAt: null,
    };
    expect(codeOf(() => undoEvent(ec, created.id))).toBe('conflict');
    delete ec.state.messages.msg_001;
    undoEvent(ec, created.id);
    expect(ec.state.files.fil_009).toBeUndefined();
  });

  it('refuses the undo of a task create while another task waits for it', () => {
    const extra = makeTask({ id: 'tsk_002' });
    ec.state.tasks.tsk_002 = extra;
    const created = recordCreate(ec, { ...meta, targetId: 'tsk_002', entity: extra });
    ec.state.tasks.tsk_001.prerequisiteIds = ['tsk_002'];
    expect(codeOf(() => undoEvent(ec, created.id))).toBe('conflict');
  });
});
