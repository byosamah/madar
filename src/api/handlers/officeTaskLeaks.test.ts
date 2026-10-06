import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { mentionMarkup } from '../../lib/text';

beforeEach(() => setNow(NOW));

/**
 * The privacy review of office tasks (2026-10-06): what a person who is not on an office task must never learn, not even that a
 * record exists. Omar (usr_004) makes an office task that Sara (usr_003) leads. Faisal (usr_002) is on no office task and leads
 * prj_001. Hala (usr_001) is the Admin.
 */
const ADMIN = 'usr_001';
const OUTSIDER = 'usr_002';
const LEAD = 'usr_003';
const MAKER = 'usr_004';
const BODY = 'The fee is 4,000 riyals, paid from the office card.';

async function world() {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  t.store.state.counters.usr = 6;
  t.as(MAKER);
  const taskId = (await t.api.call('tasks.create', { title: 'Renew the office licence', ownerId: LEAD })).task.id;
  t.as(LEAD);
  const commentId = (await t.api.call('comments.create', { targetType: 'task', targetId: taskId, body: 'First words' })).comment.id;
  const fileId = (await t.api.call('files.upload', { name: 'Licence.pdf', taskId, blob: new Blob(['licence'], { type: 'application/pdf' }) })).file.id;
  return { t, taskId, commentId, fileId };
}

type World = Awaited<ReturnType<typeof world>>;
const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};
const error = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    const { code, message, details } = e as { code: string; message: string; details?: { reason?: string } };
    return { code, message, reason: details?.reason };
  }
};

describe('finding 1: an Undo of a comment change after its office task is deleted stays private', () => {
  for (const [verb, change] of [
    ['comment.edited', (w: World) => w.t.api.call('comments.update', { id: w.commentId, body: BODY })],
    ['comment.reacted', (w: World) => w.t.api.call('reactions.toggle', { commentId: w.commentId, emoji: '👍' })],
    ['comment.created', (w: World) => w.t.api.call('comments.create', { targetType: 'task', targetId: w.taskId, body: BODY })],
  ] as const) {
    it(`${verb}: the undo event names the office task, and the outsider never reads it`, async () => {
      const w = await world();
      await as(w, LEAD, () => change(w));
      const made = Object.values(w.t.store.state.events).filter((e) => e.verb === verb).at(-1)!;
      expect(made.officeTaskId).toBe(w.taskId);
      await as(w, MAKER, () => w.t.api.call('tasks.delete', { id: w.taskId }));
      await as(w, LEAD, () => w.t.api.call('events.undo', { eventId: made.id }));
      const undo = Object.values(w.t.store.state.events).find((e) => e.undoes === made.id)!;
      expect(undo.officeTaskId).toBe(w.taskId);
      const seen = JSON.stringify(await as(w, OUTSIDER, () => w.t.api.call('events.list', { limit: 500 })));
      expect(seen).not.toContain(w.taskId);
      expect(seen).not.toContain('First words');
      expect(seen).not.toContain(BODY);
    });
  }

  it('file.added: the undo after the task delete names the office task, and the outsider never reads it', async () => {
    const w = await world();
    const added = Object.values(w.t.store.state.events).find((e) => e.verb === 'file.added')!;
    expect(added.officeTaskId).toBe(w.taskId);
    await as(w, MAKER, () => w.t.api.call('tasks.delete', { id: w.taskId }));
    await as(w, LEAD, () => w.t.api.call('events.undo', { eventId: added.id }));
    expect(Object.values(w.t.store.state.events).find((e) => e.undoes === added.id)?.officeTaskId).toBe(w.taskId);
    const seen = JSON.stringify(await as(w, OUTSIDER, () => w.t.api.call('events.list', { limit: 500 })));
    expect(seen).not.toContain('Licence.pdf');
  });

  it('a comment event on a deleted office task still names the task: the last copy of the task tells', async () => {
    const w = await world();
    await as(w, MAKER, () => w.t.api.call('tasks.delete', { id: w.taskId }));
    const deleted = Object.values(w.t.store.state.events).find((e) => e.verb === 'task.deleted')!;
    // The Undo of the delete brings the task back; its comment changes kept the office task all along.
    await as(w, MAKER, () => w.t.api.call('events.undo', { eventId: deleted.id }));
    expect(Object.values(w.t.store.state.events).filter((e) => e.targetType === 'comment').every((e) => e.officeTaskId === w.taskId)).toBe(true);
  });
});

describe('finding 3: a comment of an office task reads as missing for the outsider', () => {
  it('answers comments.update, comments.delete and reactions.toggle exactly as for a missing comment', async () => {
    const w = await world();
    for (const [name, input, missing] of [
      ['comments.update', { id: w.commentId, body: 'x' }, { id: 'cmt_999', body: 'x' }],
      ['comments.delete', { id: w.commentId }, { id: 'cmt_999' }],
      ['reactions.toggle', { commentId: w.commentId, emoji: '👍' }, { commentId: 'cmt_999', emoji: '👍' }],
    ] as const) {
      const hidden = await as(w, OUTSIDER, () => error(() => w.t.api.call(name as 'comments.update', input as never)));
      const gone = await as(w, OUTSIDER, () => error(() => w.t.api.call(name as 'comments.update', missing as never)));
      expect(hidden, name).toEqual({ ...gone, message: gone!.message.replace('cmt_999', w.commentId) });
      expect(hidden, name).toMatchObject({ code: 'not_found', message: `Comment ${w.commentId} does not exist.` });
    }
  });
});

describe('finding 4: a file of an office task reads as missing to a person who does not see the task', () => {
  it('gives file_missing to comments.create, tracker.log and chats.send, as for a file that does not exist', async () => {
    const w = await world();
    const projectTask = (await as(w, OUTSIDER, () => w.t.api.call('tasks.create', { projectId: 'prj_001', title: 'Plan' }))).task.id;
    const room = Object.values(w.t.store.state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001');
    const writes: [string, (fileId: string) => Promise<unknown>][] = [
      ['comments.create', (fileId) => w.t.api.call('comments.create', { targetType: 'task', targetId: projectTask, body: 'x', fileIds: [fileId] })],
      ['tracker.log', (fileId) => w.t.api.call('tracker.log', { projectId: 'prj_001', type: 'other', direction: 'none', title: 't', fileIds: [fileId] })],
      ...(room ? [['chats.send', (fileId: string) => w.t.api.call('chats.send', { conversationId: room.id, body: 'x', fileIds: [fileId] })] as [string, (fileId: string) => Promise<unknown>]] : []),
    ];
    for (const [name, write] of writes) {
      const hidden = await as(w, OUTSIDER, () => error(() => write(w.fileId)));
      const gone = await as(w, OUTSIDER, () => error(() => write('fil_999')));
      expect(hidden, name).toEqual(gone);
      expect(hidden, name).toMatchObject({ code: 'invalid_input', reason: 'file_missing' });
    }
    // A person who sees the task still hears why the file cannot go there.
    const lead = await as(w, ADMIN, () => error(() => w.t.api.call('comments.create', { targetType: 'task', targetId: projectTask, body: 'x', fileIds: [w.fileId] })));
    expect(lead).toMatchObject({ reason: 'file_office_task' });
  });
});

describe('finding 5: files.link of a hidden office file reads as missing', () => {
  it('answers not_found File, as for a file that does not exist', async () => {
    const w = await world();
    const hidden = await as(w, OUTSIDER, () => error(() => w.t.api.call('files.link', { id: w.fileId, variant: 'full', disposition: 'inline' })));
    expect(hidden).toMatchObject({ code: 'not_found', message: `File ${w.fileId} does not exist.` });
    const gone = await as(w, OUTSIDER, () => error(() => w.t.api.call('files.link', { id: 'fil_999', variant: 'full', disposition: 'inline' })));
    expect(gone).toMatchObject({ code: 'not_found' });
  });
});

describe('items A and B of the recheck: a story with a hidden change undoes only what the person sees', () => {
  /** Sara comments on a project task of Faisal, and in the same story changes her office task. Returns both stories. */
  async function stories(w: World) {
    const projectTask = (await as(w, OUTSIDER, () => w.t.api.call('tasks.create', { projectId: 'prj_001', title: 'Plan', ownerId: LEAD }))).task.id;
    await as(w, LEAD, async () => {
      await w.t.api.call('comments.create', { targetType: 'task', targetId: projectTask, body: 'Done on site' }, { correlationId: 'cor_mixed' });
      await w.t.api.call('tasks.update', { id: w.taskId, patch: { title: 'Renew the licence' } }, { correlationId: 'cor_mixed' });
      await w.t.api.call('comments.create', { targetType: 'task', targetId: projectTask, body: 'Done on site' }, { correlationId: 'cor_project' });
    });
    return projectTask;
  }

  it('A: the project leader gets the answer of the project part alone, never "Story does not exist"', async () => {
    const w = await world();
    await stories(w);
    const mixed = await as(w, OUTSIDER, () => error(() => w.t.api.call('events.undoStory', { correlationId: 'cor_mixed' })));
    const project = await as(w, OUTSIDER, () => error(() => w.t.api.call('events.undoStory', { correlationId: 'cor_project' })));
    expect(mixed).toEqual(project);
    expect(mixed?.message).not.toContain('does not exist');
  });

  it('A: the person who sees the whole story takes it all back', async () => {
    const w = await world();
    await stories(w);
    const undone = await as(w, LEAD, () => w.t.api.call('events.undoStory', { correlationId: 'cor_mixed' }));
    expect(undone.undone).toHaveLength(2);
  });

  it('B: a change undone alone, then hidden, does not stop the Undo of the rest of the story', async () => {
    const w = await world();
    await stories(w);
    const edit = Object.values(w.t.store.state.events).find((e) => e.correlationId === 'cor_mixed' && e.verb === 'task.updated')!;
    await as(w, LEAD, () => w.t.api.call('events.undo', { eventId: edit.id }));
    // The maker takes Sara off the office task: she no longer sees the change she undid.
    await as(w, MAKER, () => w.t.api.call('tasks.update', { id: w.taskId, patch: { ownerId: 'usr_006' } }));
    const undone = await as(w, LEAD, () => w.t.api.call('events.undoStory', { correlationId: 'cor_mixed' }));
    expect(undone.undone.map((view) => view.event.verb)).toEqual(['undo']);
    expect(Object.values(w.t.store.state.comments).filter((c) => c.body === 'Done on site')).toHaveLength(1);
  });
});

describe('final check 1: an Undo drops a notice by the changes its owner sees', () => {
  /** Sara's agent (usr_005) finishes Sara's project task (Faisal gets a review notice) and, when asked, makes an office task too. */
  async function agentStory(withOffice: boolean) {
    const t = testApi(calls);
    t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
    t.store.state.counters.usr = 6;
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: LEAD, needsReview: true });
    t.store.state.counters.tsk = 1;
    t.as('usr_005');
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_agent' });
    if (withOffice) await t.api.call('tasks.create', { title: 'Order paper', ownerId: 'usr_006' }, { correlationId: 'cor_agent' });
    t.as(OUTSIDER);
    expect((await t.api.call('notifications.count', {})).badge).toBe(1);
    await t.api.call('events.undoStory', { correlationId: 'cor_agent' });
    return { count: await t.api.call('notifications.count', {}), notices: Object.values(t.store.state.notifications).filter((n) => n.userId === OUTSIDER).length };
  }

  it('takes back the notice of the project leader as for the same story with no office task', async () => {
    const plain = await agentStory(false);
    const mixed = await agentStory(true);
    expect(plain).toEqual({ count: { unread: 0, badge: 0 }, notices: 0 });
    expect(mixed).toEqual(plain);
  });
});

describe('finding 6: events.undoStory of an office story reads as a missing story', () => {
  it('answers not_found Story before any other rule, also for a story that is wholly undone', async () => {
    const w = await world();
    const story = Object.values(w.t.store.state.events).find((e) => e.officeTaskId === w.taskId && e.verb === 'comment.created')!.correlationId;
    const missing = await as(w, OUTSIDER, () => error(() => w.t.api.call('events.undoStory', { correlationId: 'cor_none' })));
    const hidden = await as(w, OUTSIDER, () => error(() => w.t.api.call('events.undoStory', { correlationId: story })));
    expect(hidden).toEqual({ ...missing, message: missing!.message.replace('cor_none', story) });
    await as(w, LEAD, () => w.t.api.call('events.undoStory', { correlationId: story }));
    const undone = await as(w, OUTSIDER, () => error(() => w.t.api.call('events.undoStory', { correlationId: story })));
    expect(undone).toEqual({ ...missing, message: missing!.message.replace('cor_none', story) });
  });
});

describe('final check 3: a person taken off an office task keeps an old notice through a later Undo', () => {
  it('never deletes the notice of a person who no longer sees its office task, so her list and count do not change', async () => {
    const t = testApi(calls);
    t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
    t.store.state.counters.usr = 6;
    t.as(MAKER);
    const taskId = (await t.api.call('tasks.create', { title: 'Renew the office licence', ownerId: LEAD, helperIds: ['usr_006'] })).task.id;
    await t.api.call('comments.create', { targetType: 'task', targetId: taskId, body: `Ask ${mentionMarkup('Nour Member', 'usr_006')} for the receipt.` });
    const made = Object.values(t.store.state.events).filter((e) => e.verb === 'comment.created').at(-1)!;
    const mention = Object.values(t.store.state.notifications).find((n) => n.userId === 'usr_006' && n.correlationId === made.correlationId)!;
    expect(mention).toBeDefined();
    await t.api.call('tasks.update', { id: taskId, patch: { helperIds: [] } });
    t.as('usr_006');
    const before = await t.api.call('notifications.count', {});
    t.as(MAKER);
    await t.api.call('events.undo', { eventId: made.id });
    // The old rule deleted it, so Nour learned that a comment on a task she can no longer see was taken back, and when.
    expect(t.store.state.notifications[mention.id]).toBeDefined();
    t.as('usr_006');
    expect(await t.api.call('notifications.count', {})).toEqual(before);
  });
});
