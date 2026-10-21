import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { mentionMarkup } from '../../lib/text';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * task.officeAll (role rights version 2, design 5.2): the switch gives what the Admin has today on office to-dos. Omar (usr_004) makes
 * an office to-do that Sara (usr_003) leads and Nour (usr_006) helps on. Reader (usr_007) holds task.officeAll through a role.
 * Faisal (usr_002) and Dina (usr_008) hold nothing of it: they must never see the to-do, its comments, files, events, notices or count.
 * Hala (usr_001) is the Admin.
 */
const TITLE = 'Renew the office licence';
const ADMIN = 'usr_001';
const OUTSIDER = 'usr_002';
const OTHER = 'usr_008';
const LEAD = 'usr_003';
const MAKER = 'usr_004';
const HELPER = 'usr_006';
const READER = 'usr_007';
const READER_AGENT = 'usr_009';
const OUTSIDER_AGENT = 'usr_010';

async function world() {
  const t = testApi(calls);
  const { state } = t.store;
  state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Rana Reader', roleId: 'rol_001' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Dina Plain' });
  state.users.usr_009 = makeUser('usr_009', { name: 'Reader Agent', kind: 'agent', discipline: 'Agent', ownerId: READER });
  state.users.usr_010 = makeUser('usr_010', { name: 'Faisal Agent', kind: 'agent', discipline: 'Agent', ownerId: OUTSIDER });
  state.counters.usr = 10;
  state.settings.roles = { custom: [{ id: 'rol_001', name: 'Office reader', nameAr: 'قارئ المكتب', rights: ['task.officeAll'] }] };
  t.as(MAKER);
  const made = await t.api.call('tasks.create', { title: TITLE, ownerId: LEAD, helperIds: [HELPER], dueDate: '2026-09-28' });
  const taskId = made.task.id;
  t.as(LEAD);
  await t.api.call('comments.create', { targetType: 'task', targetId: taskId, body: `Ask ${mentionMarkup('Rana Reader', READER)} and ${mentionMarkup('Faisal Leader', OUTSIDER)} about the fee.` });
  const file = await t.api.call('files.upload', { name: 'Licence.pdf', taskId, blob: new Blob(['licence'], { type: 'application/pdf' }) });
  await t.api.call('tasks.complete', { id: taskId });
  return { t, taskId, fileId: file.file.id };
}

type World = Awaited<ReturnType<typeof world>>;
const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};

describe('task.officeAll: the holder reads every office to-do, a person without it reads none', () => {
  it('tasks.get: the holder, the agent of the holder and the Admin get it; a person without the switch gets not_found', async () => {
    const w = await world();
    for (const id of [READER, READER_AGENT, ADMIN]) {
      await expect(as(w, id, () => w.t.api.call('tasks.get', { id: w.taskId })), id).resolves.toMatchObject({ task: { title: TITLE }, project: null });
    }
    for (const id of [OUTSIDER, OTHER, OUTSIDER_AGENT]) {
      await expect(as(w, id, () => w.t.api.call('tasks.get', { id: w.taskId })), id).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('answers the person without the switch exactly as for a to-do that does not exist', async () => {
    const w = await world();
    const hidden = await as(w, OTHER, () => w.t.api.call('tasks.get', { id: w.taskId }).catch((e) => e));
    const never = await as(w, OTHER, () => w.t.api.call('tasks.get', { id: 'tsk_999' }).catch((e) => e));
    expect(hidden.message.replace(w.taskId, 'X')).toBe(never.message.replace('tsk_999', 'X'));
    expect(JSON.stringify(hidden)).not.toContain('licence');
  });

  it('tasks.list: the holder finds it in every filter that the Admin finds it in; the person without the switch finds it in none', async () => {
    const w = await world();
    for (const input of [{}, { filter: 'overdue' }, { filter: 'review_for_me' }, { workOf: MAKER }, { ownerId: LEAD }] as const) {
      const seen = (await as(w, READER, () => w.t.api.call('tasks.list', input))).map((row) => row.task.id);
      const adminSeen = (await as(w, ADMIN, () => w.t.api.call('tasks.list', input))).map((row) => row.task.id);
      expect(seen.includes(w.taskId), JSON.stringify(input)).toBe(adminSeen.includes(w.taskId));
      for (const id of [OUTSIDER, OTHER, OUTSIDER_AGENT]) {
        expect((await as(w, id, () => w.t.api.call('tasks.list', input))).map((row) => row.task.id), `${id} ${JSON.stringify(input)}`).not.toContain(w.taskId);
      }
    }
    expect((await as(w, READER, () => w.t.api.call('tasks.list', {}))).map((row) => row.task.id)).toContain(w.taskId);
  });

  it('search.query: the holder finds the to-do and its file; the person without the switch finds neither', async () => {
    const w = await world();
    const found = await as(w, READER, () => w.t.api.call('search.query', { text: 'licence' }));
    expect(found.tasks.map((task) => task.id)).toEqual([w.taskId]);
    expect(found.files.map((file) => file.id)).toEqual([w.fileId]);
    for (const id of [OUTSIDER, OTHER]) {
      const none = await as(w, id, () => w.t.api.call('search.query', { text: 'licence' }));
      expect([none.tasks, none.files]).toEqual([[], []]);
    }
  });

  it('events.list: the holder reads the History of the to-do; the person without the switch reads none of it', async () => {
    const w = await world();
    const mine = await as(w, READER, () => w.t.api.call('events.list', { targetType: 'task', targetId: w.taskId }));
    expect(mine.length).toBeGreaterThan(0);
    for (const id of [OUTSIDER, OTHER]) expect(await as(w, id, () => w.t.api.call('events.list', { targetType: 'task', targetId: w.taskId })), id).toEqual([]);
    expect(await as(w, OTHER, () => w.t.api.call('events.list', {}))).toEqual((await as(w, OUTSIDER, () => w.t.api.call('events.list', {}))));
    const feed = await as(w, OTHER, () => w.t.api.call('events.list', {}));
    expect(JSON.stringify(feed)).not.toContain(TITLE);
  });

  it('comments: the holder reads and writes; the person without the switch cannot read, write or react', async () => {
    const w = await world();
    const comments = await as(w, READER, () => w.t.api.call('comments.list', { targetType: 'task', targetId: w.taskId }));
    expect(comments.length).toBeGreaterThan(0);
    await as(w, READER, () => w.t.api.call('comments.create', { targetType: 'task', targetId: w.taskId, body: 'I read this.' }));
    for (const id of [OUTSIDER, OTHER]) {
      await expect(as(w, id, () => w.t.api.call('comments.list', { targetType: 'task', targetId: w.taskId })), id).rejects.toMatchObject({ code: 'not_found' });
      await expect(as(w, id, () => w.t.api.call('comments.create', { targetType: 'task', targetId: w.taskId, body: 'Hi' })), id).rejects.toMatchObject({ code: 'not_found' });
      await expect(as(w, id, () => w.t.api.call('reactions.toggle', { commentId: comments[0].comment.id, emoji: '👍' })), id).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('files: the holder lists and opens the file; the person without the switch cannot list, open, upload, share or delete it', async () => {
    const w = await world();
    expect((await as(w, READER, () => w.t.api.call('files.list', { taskId: w.taskId }))).map((view) => view.file.id)).toEqual([w.fileId]);
    await as(w, READER, () => w.t.api.call('files.link', { id: w.fileId, variant: 'full', disposition: 'inline' }));
    for (const id of [OUTSIDER, OTHER]) {
      await expect(as(w, id, () => w.t.api.call('files.list', { taskId: w.taskId })), id).rejects.toMatchObject({ code: 'not_found' });
      await expect(as(w, id, () => w.t.api.call('files.get', { id: w.fileId })), id).rejects.toMatchObject({ code: 'not_found' });
      await expect(as(w, id, () => w.t.api.call('files.link', { id: w.fileId, variant: 'full', disposition: 'inline' })), id).rejects.toMatchObject({ code: 'not_found' });
      await expect(as(w, id, () => w.t.api.call('files.upload', { name: 'x.pdf', taskId: w.taskId, blob: new Blob(['x']) })), id).rejects.toMatchObject({ code: 'not_found' });
      await expect(as(w, id, () => w.t.api.call('files.delete', { id: w.fileId })), id).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('notices: a mention reaches the holder, and never the person without the switch', async () => {
    const w = await world();
    const mine = await as(w, READER, () => w.t.api.call('notifications.list', {}));
    expect(mine.filter((view) => view.notification.targetId === w.taskId && view.notification.trigger === 'mention')).toHaveLength(1);
    expect(mine.find((view) => view.notification.targetId === w.taskId)).toMatchObject({ target: TITLE, gone: false });
    for (const id of [OUTSIDER, OTHER]) {
      expect(await as(w, id, () => w.t.api.call('notifications.list', {})), id).toEqual([]);
      expect(await as(w, id, () => w.t.api.call('notifications.count', {})), id).toEqual({ unread: 0, badge: 0 });
    }
  });

  it('dashboard.get: the past-due count and the review rows count the to-do for the holder, and not for the person without the switch', async () => {
    const w = await world();
    const reader = await as(w, READER, () => w.t.api.call('dashboard.get', {}));
    expect(reader.inReview.flatMap((row) => row.tasks.map((task) => task.id))).toEqual([w.taskId]);
    const other = await as(w, OTHER, () => w.t.api.call('dashboard.get', {}));
    expect(other.inReview.flatMap((row) => row.tasks.map((task) => task.id))).toEqual([]);
    const overdue = await as(w, READER, () => w.t.api.call('tasks.list', { filter: 'overdue' }));
    expect(reader.tiles.overdueTasks).toBe(overdue.length);
  });

  it('removing the switch takes the to-do away again, with no other change', async () => {
    const w = await world();
    await as(w, READER, () => w.t.api.call('tasks.get', { id: w.taskId }));
    w.t.store.state.settings.roles = { custom: [{ id: 'rol_001', name: 'Office reader', nameAr: 'قارئ المكتب', rights: [] }] };
    await expect(as(w, READER, () => w.t.api.call('tasks.get', { id: w.taskId }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, READER_AGENT, () => w.t.api.call('tasks.get', { id: w.taskId }))).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('task.officeAll: the holder holds the place of the maker', () => {
  it('lets the holder name the lead and the helpers, send the finished to-do back, approve it and delete it', async () => {
    const w = await world();
    await as(w, READER, () => w.t.api.call('tasks.update', { id: w.taskId, patch: { helperIds: [] } }));
    await as(w, READER, () => w.t.api.call('tasks.sendBack', { id: w.taskId, note: 'Add the stamp' }));
    await as(w, LEAD, () => w.t.api.call('tasks.complete', { id: w.taskId }));
    await as(w, READER, () => w.t.api.call('tasks.approve', { id: w.taskId }));
    await as(w, READER, () => w.t.api.call('tasks.delete', { id: w.taskId }));
    expect(w.t.store.state.tasks[w.taskId]).toBeUndefined();
  });

  it('refuses the same changes to a person without the switch, as for a missing to-do', async () => {
    const w = await world();
    for (const id of [OUTSIDER, OTHER, OUTSIDER_AGENT]) {
      await expect(as(w, id, () => w.t.api.call('tasks.update', { id: w.taskId, patch: { helperIds: [] } })), id).rejects.toMatchObject({ code: 'not_found' });
      await expect(as(w, id, () => w.t.api.call('tasks.approve', { id: w.taskId })), id).rejects.toMatchObject({ code: 'not_found' });
      await expect(as(w, id, () => w.t.api.call('tasks.delete', { id: w.taskId })), id).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('keeps the holder out of a project to-do change that task.any would give: officeAll opens no project', async () => {
    const w = await world();
    const { state } = w.t.store;
    state.tasks.tsk_900 = { ...Object.values(state.tasks)[0], id: 'tsk_900', projectId: 'prj_001', stageId: 'stg_002', ownerId: LEAD, createdBy: 'usr_002' };
    await expect(as(w, READER, () => w.t.api.call('tasks.update', { id: 'tsk_900', patch: { title: 'Mine now' } }))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
