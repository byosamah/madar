import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { mentionMarkup } from '../../lib/text';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The privacy rule of office tasks (owner, 2026-10-06), one read path at a time. Omar (usr_004) makes an office task that Sara
 * (usr_003) leads and Nour (usr_006) helps on. It is past due, it has a comment and a file, and it waits for Omar's review.
 * Faisal (usr_002) is on no office task: he must never see it, its comments, its files, its events, its notices or its count.
 * Hala (usr_001) is the Admin and sees it. usr_005 is Sara's agent and sees what Sara sees; usr_008 is Faisal's agent.
 */
const TITLE = 'Renew the office licence';
const ADMIN = 'usr_001';
const OUTSIDER = 'usr_002';
const LEAD = 'usr_003';
const MAKER = 'usr_004';
const HELPER = 'usr_006';
const LEAD_AGENT = 'usr_005';
const OUTSIDER_AGENT = 'usr_008';

async function world() {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  t.store.state.users.usr_008 = makeUser('usr_008', { name: 'Faisal Agent', kind: 'agent', discipline: 'Agent', ownerId: OUTSIDER });
  t.store.state.counters.usr = 8;
  t.as(MAKER);
  const made = await t.api.call('tasks.create', { title: TITLE, ownerId: LEAD, helperIds: [HELPER], dueDate: '2026-09-28' });
  const taskId = made.task.id;
  t.as(LEAD);
  // A mention of a person who is not on the task tells nobody.
  await t.api.call('comments.create', { targetType: 'task', targetId: taskId, body: `Ask ${mentionMarkup('Faisal Leader', OUTSIDER)} about the fee.` });
  const file = await t.api.call('files.upload', { name: 'Licence.pdf', taskId, blob: new Blob(['licence'], { type: 'application/pdf' }) });
  await t.api.call('tasks.complete', { id: taskId });
  // A second office task stays open and past due.
  t.as(MAKER);
  const bill = await t.api.call('tasks.create', { title: 'Pay the internet bill', ownerId: LEAD, dueDate: '2026-09-28' });
  return { t, taskId, fileId: file.file.id, billId: bill.task.id };
}

type World = Awaited<ReturnType<typeof world>>;
const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};

describe('an office task is private to its people and the Admin', () => {
  it('tasks.get: the outsider and the outsider agent get not_found; the Admin, the people and the agent of the lead get it', async () => {
    const w = await world();
    for (const id of [OUTSIDER, OUTSIDER_AGENT]) {
      await expect(as(w, id, () => w.t.api.call('tasks.get', { id: w.taskId })), id).rejects.toMatchObject({ code: 'not_found' });
    }
    for (const id of [ADMIN, MAKER, LEAD, HELPER, LEAD_AGENT]) {
      await expect(as(w, id, () => w.t.api.call('tasks.get', { id: w.taskId })), id).resolves.toMatchObject({ task: { title: TITLE }, project: null });
    }
  });

  it('tasks.list: every filter leaves it out for the outsider, and a project filter leaves it out for everyone', async () => {
    const w = await world();
    const inputs = [
      {}, { filter: 'mine' }, { filter: 'overdue' }, { filter: 'review_for_me' }, { workOf: MAKER }, { workOf: LEAD }, { ownerId: LEAD },
      { includeDone: false, activeProjectsOnly: false },
    ] as const;
    for (const input of inputs) {
      for (const id of [OUTSIDER, OUTSIDER_AGENT]) {
        const rows = (await as(w, id, () => w.t.api.call('tasks.list', input))).map((row) => row.task.id);
        expect(rows, `${id} ${JSON.stringify(input)}`).not.toContain(w.taskId);
        expect(rows, `${id} ${JSON.stringify(input)}`).not.toContain(w.billId);
      }
    }
    const admin = await as(w, ADMIN, () => w.t.api.call('tasks.list', {}));
    expect(admin.find((row) => row.task.id === w.taskId)).toMatchObject({ project: null, stage: null });
    expect(admin.find((row) => row.task.id === w.billId)).toMatchObject({ project: null, stage: null, overdue: true });
    for (const filter of [{ projectId: 'prj_001' }, { leaderId: OUTSIDER }, { teamId: 'tm_001' }] as const) {
      const rows = (await as(w, ADMIN, () => w.t.api.call('tasks.list', filter))).map((row) => row.task.id);
      expect(rows, JSON.stringify(filter)).not.toContain(w.taskId);
      expect(rows, JSON.stringify(filter)).not.toContain(w.billId);
    }
  });

  it('tasks.list: it is in the lists of its people and of the agent of its lead', async () => {
    const w = await world();
    const ids = async (id: string, input: object) => (await as(w, id, () => w.t.api.call('tasks.list', input))).map((row) => row.task.id);
    expect(await ids(LEAD, { filter: 'mine' })).toContain(w.taskId);
    expect(await ids(HELPER, { filter: 'mine' })).toContain(w.taskId);
    expect(await ids(LEAD_AGENT, { filter: 'mine' })).toContain(w.taskId);
    expect(await ids(MAKER, { filter: 'review_for_me' })).toContain(w.taskId);
    expect(await ids(MAKER, { workOf: MAKER })).toContain(w.taskId);
    expect(await ids(LEAD, { filter: 'mine' })).toEqual(await ids(LEAD_AGENT, { filter: 'mine' }));
  });

  it('search.query: the outsider finds neither the task nor its file', async () => {
    const w = await world();
    const outsider = await as(w, OUTSIDER, () => w.t.api.call('search.query', { text: 'licence' }));
    expect(outsider.tasks).toEqual([]);
    expect(outsider.files).toEqual([]);
    for (const id of [ADMIN, LEAD, LEAD_AGENT]) {
      const found = await as(w, id, () => w.t.api.call('search.query', { text: 'licence' }));
      expect(found.tasks, id).toEqual([{ id: w.taskId, title: TITLE, projectId: null, projectCode: '' }]);
      expect(found.files.map((file) => file.id), id).toEqual([w.fileId]);
    }
  });

  it('dashboard.get: the past-due count, the workload and the reviews leave it out for the outsider, and each number equals its list', async () => {
    const w = await world();
    for (const id of [OUTSIDER, ADMIN, LEAD]) {
      const view = await as(w, id, () => w.t.api.call('dashboard.get', {}));
      const overdue = await as(w, id, () => w.t.api.call('tasks.list', { filter: 'overdue' }));
      expect(view.tiles.overdueTasks, id).toBe(overdue.length);
      const makerRow = view.workload.rows.find((row) => row.user.id === MAKER)!;
      const makerWork = await as(w, id, () => w.t.api.call('tasks.list', { workOf: MAKER, includeDone: false, dueFrom: '2026-09-30', dueTo: '2026-10-03' }));
      expect(makerRow.counts[0], id).toBe(makerWork.length);
      const seen = id !== OUTSIDER;
      expect(view.tiles.overdueTasks, id).toBe(seen ? 1 : 0);
      expect(view.inReview.flatMap((row) => row.tasks.map((task) => task.id)), id).toEqual(seen ? [w.taskId] : []);
    }
    // A people filter leaves office tasks out, as the lists it opens do.
    const filtered = await as(w, ADMIN, () => w.t.api.call('dashboard.get', { leaderId: OUTSIDER }));
    expect(filtered.tiles.overdueTasks).toBe(0);
  });

  it('dashboard.get: it never changes a project number', async () => {
    const empty = testApi(calls);
    empty.as(ADMIN);
    const project = await empty.api.call('projects.get', { id: 'prj_001' });
    const office = await empty.api.call('dashboard.get', {});
    const w = await world();
    const after = await as(w, ADMIN, () => w.t.api.call('projects.get', { id: 'prj_001' }));
    expect(after.openTasks).toBe(0);
    expect(after.health).toEqual(project.health);
    expect(after.currentStage).toEqual(project.currentStage);
    expect(after.project.updatedAt).toBe(project.project.updatedAt);
    const view = await as(w, ADMIN, () => w.t.api.call('dashboard.get', {}));
    expect(view.charts).toEqual(office.charts);
    expect(view.schedule).toEqual(office.schedule);
    expect({ ...view.tiles, overdueTasks: 0 }).toEqual({ ...office.tiles, overdueTasks: 0 });
  });

  it('comments: the outsider cannot read, write or react, and a mention of the outsider sends no notice', async () => {
    const w = await world();
    await expect(as(w, OUTSIDER, () => w.t.api.call('comments.list', { targetType: 'task', targetId: w.taskId }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, OUTSIDER, () => w.t.api.call('comments.create', { targetType: 'task', targetId: w.taskId, body: 'Hi' }))).rejects.toMatchObject({ code: 'not_found' });
    const comments = await as(w, ADMIN, () => w.t.api.call('comments.list', { targetType: 'task', targetId: w.taskId }));
    expect(comments.length).toBeGreaterThan(0);
    await expect(as(w, OUTSIDER, () => w.t.api.call('reactions.toggle', { commentId: comments[0].comment.id, emoji: '👍' }))).rejects.toMatchObject({ code: 'not_found' });
    expect(Object.values(w.t.store.state.notifications).filter((n) => n.userId === OUTSIDER)).toEqual([]);
  });

  it('notifications: the outsider has none; a lead taken off sees the old notice as gone, with no title', async () => {
    const w = await world();
    expect(await as(w, OUTSIDER, () => w.t.api.call('notifications.list', {}))).toEqual([]);
    expect(await as(w, OUTSIDER, () => w.t.api.call('notifications.count', {}))).toEqual({ unread: 0, badge: 0 });
    const lead = await as(w, LEAD, () => w.t.api.call('notifications.list', {}));
    expect(lead.find((view) => view.notification.targetId === w.taskId)).toMatchObject({ target: TITLE, gone: false, link: `/work?task=${w.taskId}` });
    await as(w, MAKER, () => w.t.api.call('tasks.sendBack', { id: w.taskId, note: 'Add the stamp' }));
    await as(w, MAKER, () => w.t.api.call('tasks.update', { id: w.taskId, patch: { ownerId: HELPER, helperIds: [] } }));
    const after = await as(w, LEAD, () => w.t.api.call('notifications.list', {}));
    const old = after.filter((view) => view.notification.targetId === w.taskId);
    expect(old.length).toBeGreaterThan(0);
    for (const view of old) expect(view).toMatchObject({ target: '', gone: true, link: '/notifications', canApprove: false, dueDate: null });
    // The badge counts only what the list shows as live: the notice of the other office task, which Sara still leads.
    const count = await as(w, LEAD, () => w.t.api.call('notifications.count', {}));
    expect(count.badge).toBe(after.filter((view) => !view.notification.read && view.needsAction && !view.gone).length);
    expect(after.filter((view) => !view.gone).map((view) => view.notification.targetId)).toEqual([w.billId]);
  });

  it('the Inbox: the thread shows to its lead, its maker and the Admin who commented, never to the outsider', async () => {
    const w = await world();
    const threads = async (id: string) => (await as(w, id, () => w.t.api.call('chats.list', {}))).filter((row) => row.kind === 'task').map((row) => row.id);
    expect(await threads(OUTSIDER)).toEqual([]);
    expect(await threads(OUTSIDER_AGENT)).toEqual([]);
    expect(await threads(LEAD)).toEqual([w.taskId]);
    expect(await threads(MAKER)).toEqual([w.taskId]);
    expect(await threads(ADMIN)).toEqual([]);
    expect(await as(w, OUTSIDER, () => w.t.api.call('chats.unreadCount', {}))).toEqual({ unread: 0 });
    await expect(as(w, OUTSIDER, () => w.t.api.call('chats.markRead', { conversationId: w.taskId }))).rejects.toMatchObject({ code: 'not_found' });
    const row = (await as(w, LEAD, () => w.t.api.call('chats.list', {}))).find((r) => r.id === w.taskId)!;
    expect(row.project).toBeNull();
  });

  it('files: the outsider cannot list, open, upload, share or delete them', async () => {
    const w = await world();
    await expect(as(w, OUTSIDER, () => w.t.api.call('files.list', { taskId: w.taskId }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, OUTSIDER, () => w.t.api.call('files.get', { id: w.fileId }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, OUTSIDER, () => w.t.api.call('files.link', { id: w.fileId, variant: 'full', disposition: 'inline' }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, OUTSIDER, () => w.t.api.call('files.upload', { name: 'x.pdf', taskId: w.taskId, blob: new Blob(['x']) }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, OUTSIDER, () => w.t.api.call('files.uploadStart', { name: 'x.pdf', taskId: w.taskId, size: 1, mimeType: 'application/pdf' }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, OUTSIDER, () => w.t.api.call('files.share', { fileId: w.fileId, target: { kind: 'project_chat' } }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, OUTSIDER, () => w.t.api.call('files.delete', { id: w.fileId }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, OUTSIDER, () => w.t.api.call('files.list', { projectId: 'prj_001' }))).resolves.toEqual([]);
    for (const id of [ADMIN, LEAD, HELPER, LEAD_AGENT]) {
      const files = await as(w, id, () => w.t.api.call('files.list', { taskId: w.taskId }));
      expect(files.map((view) => view.file.id), id).toEqual([w.fileId]);
    }
    const detail = await as(w, LEAD, () => w.t.api.call('tasks.get', { id: w.taskId }));
    expect(detail.fileCount).toBe(1);
  });

  it('files: a file of an office task stays on its task', async () => {
    const w = await world();
    await expect(as(w, LEAD, () => w.t.api.call('files.share', { fileId: w.fileId, target: { kind: 'project_chat' } }))).rejects.toMatchObject({ details: { reason: 'file_office_task' } });
    await expect(as(w, LEAD, () => w.t.api.call('files.share', { fileId: w.fileId, target: { kind: 'person', userId: HELPER } }))).rejects.toMatchObject({ details: { reason: 'file_office_task' } });
    await expect(as(w, LEAD, () => w.t.api.call('files.markDelivered', { id: w.fileId }))).rejects.toMatchObject({ details: { reason: 'file_office_task' } });
    await expect(as(w, LEAD, () => w.t.api.call('files.upload', { name: 'Cover.png', taskId: w.taskId, asCover: true, blob: new Blob(['x'], { type: 'image/png' }) }))).rejects.toMatchObject({ details: { reason: 'file_office_task' } });
    await expect(as(w, LEAD, () => w.t.api.call('files.share', { fileId: w.fileId, target: { kind: 'task', taskId: w.taskId } }))).resolves.toEqual({ kind: 'task', id: w.taskId });
    // A comment on a project task cannot carry it.
    await expect(as(w, ADMIN, async () => {
      const project = await w.t.api.call('tasks.create', { projectId: 'prj_001', title: 'Plan' });
      return w.t.api.call('comments.create', { targetType: 'task', targetId: project.task.id, body: 'See', fileIds: [w.fileId] });
    })).rejects.toMatchObject({ details: { reason: 'file_office_task' } });
  });

  it('events.list and the History: the outsider sees no change of the task, its comments or its files', async () => {
    const w = await world();
    const ofTask = (views: { event: { officeTaskId?: string } }[]) => views.filter((view) => view.event.officeTaskId === w.taskId).length;
    expect(ofTask(await as(w, OUTSIDER, () => w.t.api.call('events.list', { limit: 500 })))).toBe(0);
    expect(ofTask(await as(w, OUTSIDER_AGENT, () => w.t.api.call('events.list', { limit: 500 })))).toBe(0);
    expect(await as(w, OUTSIDER, () => w.t.api.call('events.list', { targetId: w.taskId }))).toEqual([]);
    const admin = await as(w, ADMIN, () => w.t.api.call('events.list', { limit: 500 }));
    expect(new Set(admin.filter((view) => view.event.officeTaskId === w.taskId).map((view) => view.event.targetType))).toEqual(new Set(['task', 'comment', 'file']));
    expect(ofTask(await as(w, LEAD_AGENT, () => w.t.api.call('events.list', { limit: 500 })))).toBe(ofTask(admin));
    // A limit counts only the changes the person sees.
    const limited = await as(w, OUTSIDER, () => w.t.api.call('events.list', { limit: 1 }));
    expect(ofTask(limited)).toBe(0);
    const history = await as(w, ADMIN, () => w.t.api.call('tasks.get', { id: w.taskId }));
    expect(history.history.length).toBeGreaterThan(0);
  });

  it('events.undo and events.undoStory: the outsider cannot take back a change of the task', async () => {
    const w = await world();
    const admin = await as(w, ADMIN, () => w.t.api.call('events.list', { limit: 500 }));
    const change = admin.find((view) => view.event.officeTaskId === w.taskId)!.event;
    await expect(as(w, OUTSIDER, () => w.t.api.call('events.undo', { eventId: change.id }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, OUTSIDER, () => w.t.api.call('events.undoStory', { correlationId: change.correlationId }))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('events.undo: the maker takes back the delete of the task', async () => {
    const w = await world();
    const removed = await as(w, MAKER, async () => {
      await w.t.api.call('tasks.delete', { id: w.taskId });
      return Object.values(w.t.store.state.events).find((e) => e.verb === 'task.deleted' && e.targetId === w.taskId)!;
    });
    await expect(as(w, OUTSIDER, () => w.t.api.call('events.undo', { eventId: removed.id }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, MAKER, () => w.t.api.call('events.undo', { eventId: removed.id }))).resolves.toMatchObject({ event: { verb: 'undo' } });
    await expect(as(w, LEAD, () => w.t.api.call('tasks.get', { id: w.taskId }))).resolves.toMatchObject({ task: { id: w.taskId } });
  });
});
