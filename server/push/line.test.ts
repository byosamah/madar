import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { mentionMarkup } from '../../src/lib/text';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import { chatLine, chatLineOutcome, GONE, noticeLine, noticeLineOutcome } from './line';
import { pushWords } from './words';

/**
 * The push line (owner, 2026-10-21, "Like WhatsApp"): the server reads as the person who gets the push, so the line shows only what
 * that person may see. A chat gives its name and "Name: first words"; a direct chat gives the name of the sender and the words; a
 * notice gives the sentence of the bell. The tests run the real calls on the sample office, in memory.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

function world(edit: (office: State) => void = () => undefined) {
  const office = structuredClone(seed);
  edit(office);
  const mem = memoryData(office);
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: () => mem.data() });
  const call = async <T>(userId: string, name: string, input: unknown): Promise<T> => {
    const result = await run(deps, { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
    if (!result.ok) throw new Error(`${name} failed: ${result.error.message}`);
    return result.output as T;
  };
  return { office, deps, run, call };
}

const nameOf = (office: State, id: string) => office.users[id].name;

describe('chatLine', () => {
  it('gives a direct chat the name of the sender as the title and the words as the body, with the link of the chat', async () => {
    const w = world();
    const { id } = await w.call<{ id: string }>('usr_001', 'chats.openDirect', { userId: 'usr_002' });
    await w.call('usr_001', 'chats.send', { conversationId: id, body: 'Can you send the drawings before 3?' });
    expect(await chatLine(w.deps, 'usr_002', id, { run: w.run })).toEqual({
      title: nameOf(w.office, 'usr_001'), body: 'Can you send the drawings before 3?', url: `/inbox/${id}`, tag: `madar-chat-${id}`, lang: 'en',
    });
  });

  it('gives a group its name as the title and "Name: words" as the body, with each mention as "@Name"', async () => {
    const w = world();
    const group = await w.call<{ id: string }>('usr_001', 'chats.createGroup', { name: 'Site team', memberIds: ['usr_002', 'usr_003'] });
    const faisal = nameOf(w.office, 'usr_002');
    await w.call('usr_001', 'chats.send', { conversationId: group.id, body: `${mentionMarkup(faisal, 'usr_002')} please check the stairs.` });
    expect(await chatLine(w.deps, 'usr_002', group.id, { run: w.run })).toMatchObject({
      title: 'Site team', body: `${nameOf(w.office, 'usr_001')}: @${faisal} please check the stairs.`,
    });
  });

  it('gives nothing to a person who may not open the chat (the push then has no words)', async () => {
    const w = world();
    const group = await w.call<{ id: string }>('usr_001', 'chats.createGroup', { name: 'Private group', memberIds: ['usr_002', 'usr_003'] });
    await w.call('usr_001', 'chats.send', { conversationId: group.id, body: 'The fee is 40,000.' });
    expect(await chatLine(w.deps, 'usr_004', group.id, { run: w.run })).toBeNull();
  });

  it('gives nothing when the newest message is the person\'s own', async () => {
    const w = world();
    const { id } = await w.call<{ id: string }>('usr_001', 'chats.openDirect', { userId: 'usr_002' });
    await w.call('usr_001', 'chats.send', { conversationId: id, body: 'Hello' });
    await w.call('usr_002', 'chats.send', { conversationId: id, body: 'Hi' });
    expect(await chatLine(w.deps, 'usr_002', id, { run: w.run })).toBeNull();
  });

  it('cuts a long message at 180 characters', async () => {
    const w = world();
    const { id } = await w.call<{ id: string }>('usr_001', 'chats.openDirect', { userId: 'usr_002' });
    await w.call('usr_001', 'chats.send', { conversationId: id, body: 'word '.repeat(100) });
    const line = await chatLine(w.deps, 'usr_002', id, { run: w.run });
    expect(line!.body.length).toBeLessThanOrEqual(180);
  });

  it('writes in Arabic, with the Arabic name, for a person who reads Madar in Arabic', async () => {
    const w = world((office) => {
      office.users.usr_002.preferences = { ...office.users.usr_002.preferences, language: 'ar' };
      office.users.usr_001.nameAr = 'هالة ناصر';
    });
    const group = await w.call<{ id: string }>('usr_001', 'chats.createGroup', { name: 'Site team', memberIds: ['usr_002', 'usr_003'] });
    await w.call('usr_001', 'chats.send', { conversationId: group.id, body: 'جاهز؟' });
    expect(await chatLine(w.deps, 'usr_002', group.id, { run: w.run })).toMatchObject({ body: 'هالة ناصر: جاهز؟', lang: 'ar' });
  });

  it('gives a task comment the task title and "Name: words", also for a person with no thread row (a helper)', async () => {
    const w = world();
    const task = Object.values(w.office.tasks).find((one) => one.projectId !== null && one.ownerId !== null && one.ownerId !== 'usr_001')!;
    await w.call('usr_001', 'comments.create', { targetType: 'task', targetId: task.id, body: 'The client asked for one more door.' });
    const line = await chatLine(w.deps, task.ownerId!, task.id, { run: w.run });
    expect(line).toEqual({
      title: task.title, body: `${nameOf(w.office, 'usr_001')}: The client asked for one more door.`, url: `/inbox/${task.id}`, tag: `madar-chat-${task.id}`, lang: 'en',
    });
  });

  it('gives nothing of an office task to a person outside it', async () => {
    const w = world();
    const made = await w.call<{ task: { id: string } }>('usr_001', 'tasks.create', { title: 'Salary review', ownerId: 'usr_002' });
    await w.call('usr_001', 'comments.create', { targetType: 'task', targetId: made.task.id, body: 'The new numbers are in.' });
    expect(await chatLine(w.deps, 'usr_002', made.task.id, { run: w.run })).toMatchObject({ title: 'Salary review' });
    expect(await chatLine(w.deps, 'usr_004', made.task.id, { run: w.run })).toBeNull();
  });
});

describe('noticeLine', () => {
  it('gives the sentence of the bell, the project as the title and the link of the notice', async () => {
    const w = world();
    const task = Object.values(w.office.tasks).find((one) => one.projectId !== null && one.ownerId !== 'usr_002' && one.status !== 'done')!;
    await w.call('usr_001', 'tasks.update', { id: task.id, patch: { ownerId: 'usr_002' } });
    const [view] = await w.call<Array<{ notification: { id: string }; link: string; project: { name: string } | null }>>('usr_002', 'notifications.list', { unreadOnly: true });
    const line = await noticeLine(w.deps, 'usr_002', { run: w.run });
    expect(line).toMatchObject({ title: view.project!.name, url: view.link, lang: 'en' });
    expect(line!.body).toContain(task.title);
    expect(line!.body).toContain(nameOf(w.office, 'usr_001'));
  });

  it('titles the push of a notice with the Arabic name of the project for a person on Arabic screens (owner, 2026-10-26, fbk_062)', async () => {
    const w = world((office) => {
      office.users.usr_002.preferences.language = 'ar';
    });
    const task = Object.values(w.office.tasks).find((one) => one.projectId !== null && one.ownerId !== 'usr_002' && one.status !== 'done')!;
    await w.call('usr_001', 'projects.update', { id: task.projectId, patch: { nameAr: 'برج الكورنيش' } });
    await w.call('usr_001', 'tasks.update', { id: task.id, patch: { ownerId: 'usr_002' } });
    const line = await noticeLine(w.deps, 'usr_002', { run: w.run });
    expect(line).toMatchObject({ title: 'برج الكورنيش', lang: 'ar' });
  });

  it('keeps the English title for a person on English screens, also when the project has an Arabic name', async () => {
    const w = world();
    const task = Object.values(w.office.tasks).find((one) => one.projectId !== null && one.ownerId !== 'usr_002' && one.status !== 'done')!;
    await w.call('usr_001', 'projects.update', { id: task.projectId, patch: { nameAr: 'برج الكورنيش' } });
    await w.call('usr_001', 'tasks.update', { id: task.id, patch: { ownerId: 'usr_002' } });
    const [view] = await w.call<Array<{ project: { name: string } | null }>>('usr_002', 'notifications.list', { unreadOnly: true });
    expect(await noticeLine(w.deps, 'usr_002', { run: w.run })).toMatchObject({ title: view.project!.name, lang: 'en' });
  });

  it('titles the push of a project chat with the project name in the language of the person', async () => {
    const w = world((office) => {
      office.users.usr_002.preferences.language = 'ar';
    });
    await w.call('usr_001', 'projects.update', { id: 'prj_001', patch: { nameAr: 'برج الكورنيش' } });
    const chat = Object.values(w.office.conversations).find((one) => one.kind === 'project' && one.projectId === 'prj_001')!;
    await w.call('usr_001', 'chats.send', { conversationId: chat.id, body: 'A note for the team.' });
    expect(await chatLine(w.deps, 'usr_002', chat.id, { run: w.run })).toMatchObject({ title: 'برج الكورنيش', lang: 'ar' });
  });

  it('gives nothing when the person has no unread notice', async () => {
    const w = world((office) => {
      for (const notice of Object.values(office.notifications)) notice.read = true;
    });
    expect(await noticeLine(w.deps, 'usr_002', { run: w.run })).toBeNull();
  });

  it('falls back to the word Madar as the title of a notice with no project', () => {
    expect(pushWords('en')('push.notificationTitle')).toBe('Madar');
  });
});

// GONE (tsk_439): the person may not open the item any more. It is not "no line": no line sends the empty push, GONE sends nothing.
describe('the outcome of a line: GONE or no line', () => {
  it('chatLineOutcome says GONE for a chat that the person may not open, and null for a chat with no line to show', async () => {
    const w = world();
    const group = await w.call<{ id: string }>('usr_001', 'chats.createGroup', { name: 'Private group', memberIds: ['usr_002', 'usr_003'] });
    await w.call('usr_001', 'chats.send', { conversationId: group.id, body: 'The fee is 40,000.' });
    expect(await chatLineOutcome(w.deps, 'usr_004', group.id, { run: w.run })).toBe(GONE);
    const { id } = await w.call<{ id: string }>('usr_001', 'chats.openDirect', { userId: 'usr_002' });
    await w.call('usr_001', 'chats.send', { conversationId: id, body: 'Hello' });
    await w.call('usr_002', 'chats.send', { conversationId: id, body: 'Hi' });
    expect(await chatLineOutcome(w.deps, 'usr_002', id, { run: w.run })).toBeNull();
  });

  it('chatLineOutcome says GONE for the thread of a to-do that the person may not open, and null when a read fails for another reason', async () => {
    const w = world((office) => {
      office.projects.prj_001.access = { hidden: true, viewerIds: [] };
    });
    const task = Object.values(w.office.tasks).find((one) => one.projectId === 'prj_001')!;
    expect(await chatLineOutcome(w.deps, 'usr_004', task.id, { run: w.run })).toBe(GONE);
    const broken: typeof w.run = async () => ({ ok: false, error: { code: 'failed', message: 'Broken.' } }) as never;
    expect(await chatLineOutcome(w.deps, 'usr_004', task.id, { run: broken })).toBeNull();
    expect(await chatLineOutcome(w.deps, 'usr_004', 'cnv_001', { run: broken })).toBeNull();
  });

  it('noticeLineOutcome says GONE when every unread notice reads as gone, and null when no notice is unread', async () => {
    const w = world((office) => {
      for (const notice of Object.values(office.notifications)) notice.read = true;
      office.projects.prj_001.access = { hidden: true, viewerIds: [] };
      office.notifications.ntf_901 = {
        id: 'ntf_901', userId: 'usr_004', trigger: 'task_assigned', actorId: 'usr_001', targetType: 'task', targetId: 'tsk_009', read: false,
        createdAt: '2026-10-04T08:00:00.000+03:00', dedupeKey: null,
      };
    });
    expect(await noticeLineOutcome(w.deps, 'usr_004', { run: w.run })).toBe(GONE);
    expect(await noticeLineOutcome(w.deps, 'usr_003', { run: w.run })).toBeNull();
    // The old function keeps its answer: null for both.
    expect(await noticeLine(w.deps, 'usr_004', { run: w.run })).toBeNull();
  });
});
